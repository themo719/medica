"use client";

import { useEffect, useState } from "react";

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, getUIStrings, type LanguageCode } from "@/lib/i18n";
import type { ChatResponsePayload, ChatRole, KnowledgeDoc } from "@/lib/types";

type ClientMessage = {
  id: string;
  role: ChatRole;
  content: string;
  sourceContent?: string;
  sourceLanguage?: LanguageCode;
  translations?: Partial<Record<LanguageCode, string>>;
  meta?: {
    citations: ChatResponsePayload["citations"];
    warning?: string;
  };
};

type FormState = {
  age: string;
  gestationalAgeWeeks: string;
  trimester: string;
  symptoms: string;
  duration: string;
  bloodPressure: string;
  temperatureC: string;
  meds: string;
  knownConditions: string;
  notes: string;
};

type BrowserProviderSettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
};

const EMPTY_FORM: FormState = {
  age: "",
  gestationalAgeWeeks: "",
  trimester: "",
  symptoms: "",
  duration: "",
  bloodPressure: "",
  temperatureC: "",
  meds: "",
  knownConditions: "",
  notes: "",
};

const BROWSER_SETTINGS_STORAGE_KEY = "medica.browser-provider-settings.v1";
const EMPTY_BROWSER_SETTINGS: BrowserProviderSettings = {
  apiKey: "",
  baseUrl: "",
  model: "",
  provider: "",
};

function createMessage(role: ChatRole, content: string, meta?: ClientMessage["meta"]): ClientMessage {
  return {
    id: `${role}-${crypto.randomUUID()}`,
    role,
    content,
    meta,
  };
}

export function ChatShell({
  featuredDocs,
  liveModelReady,
  knowledgeSnapshot,
}: {
  featuredDocs: KnowledgeDoc[];
  liveModelReady: boolean;
  knowledgeSnapshot: {
    totalDocs: number;
    uploadedDocs: number;
    categories: string[];
    totalCitations: number;
  };
}) {
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>(DEFAULT_LANGUAGE);
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [input, setInput] = useState("");
  const [formState, setFormState] = useState<FormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(false);
  const [isTranslatingReplies, setIsTranslatingReplies] = useState(false);
  const [translationFailed, setTranslationFailed] = useState(false);
  const [browserSettings, setBrowserSettings] = useState<BrowserProviderSettings>(EMPTY_BROWSER_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const ui = getUIStrings(selectedLanguage);
  const browserLiveReady = Boolean(browserSettings.apiKey.trim());
  const effectiveLiveReady = liveModelReady || browserLiveReady;
  const configuredProviderLabel = browserSettings.provider.trim() || "OpenAI";
  const browserSettingsNote = browserLiveReady
    ? `Browser live AI is enabled with ${configuredProviderLabel}${browserSettings.model.trim() ? ` using ${browserSettings.model.trim()}` : ""}.`
    : liveModelReady
      ? "A server-side live AI key is available for this workspace."
      : "Paste a live API key here to enable real model responses in this browser. These values stay in local browser storage only.";

  useEffect(() => {
    try {
      const rawSettings = window.localStorage.getItem(BROWSER_SETTINGS_STORAGE_KEY);

      if (rawSettings) {
        const parsed = JSON.parse(rawSettings) as Partial<BrowserProviderSettings>;

        setBrowserSettings({
          apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
          baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
          model: typeof parsed.model === "string" ? parsed.model : "",
          provider: typeof parsed.provider === "string" ? parsed.provider : "",
        });
      }
    } catch {
      window.localStorage.removeItem(BROWSER_SETTINGS_STORAGE_KEY);
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    window.localStorage.setItem(BROWSER_SETTINGS_STORAGE_KEY, JSON.stringify(browserSettings));
  }, [browserSettings, settingsLoaded]);

  function buildProviderHeaders() {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (browserSettings.apiKey.trim()) {
      headers["x-ai-api-key"] = browserSettings.apiKey.trim();
    }

    if (browserSettings.baseUrl.trim()) {
      headers["x-ai-base-url"] = browserSettings.baseUrl.trim();
    }

    if (browserSettings.model.trim()) {
      headers["x-ai-model"] = browserSettings.model.trim();
    }

    if (browserSettings.provider.trim()) {
      headers["x-ai-provider-name"] = browserSettings.provider.trim();
    }

    return headers;
  }

  useEffect(() => {
    let cancelled = false;

    setMessages((currentMessages) => {
      let changed = false;

      const nextMessages = currentMessages.map((message) => {
        if (message.role !== "assistant" || !message.sourceContent || !message.sourceLanguage) {
          return message;
        }

        if (selectedLanguage === message.sourceLanguage && message.content !== message.sourceContent) {
          changed = true;
          return {
            ...message,
            content: message.sourceContent,
          };
        }

        const cachedTranslation = message.translations?.[selectedLanguage];

        if (cachedTranslation && message.content !== cachedTranslation) {
          changed = true;
          return {
            ...message,
            content: cachedTranslation,
          };
        }

        return message;
      });

      return changed ? nextMessages : currentMessages;
    });

    const needsTranslation = messages.filter(
      (message) =>
        message.role === "assistant" &&
        message.sourceContent &&
        message.sourceLanguage &&
        selectedLanguage !== message.sourceLanguage &&
        !message.translations?.[selectedLanguage],
    );

    if (!needsTranslation.length) {
      setIsTranslatingReplies(false);
      setTranslationFailed(false);

      return () => {
        cancelled = true;
      };
    }

    setIsTranslatingReplies(true);
    setTranslationFailed(false);

    void Promise.allSettled(
      needsTranslation.map(async (message) => {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: buildProviderHeaders(),
          body: JSON.stringify({
            text: message.sourceContent,
            sourceLanguage: message.sourceLanguage,
            targetLanguage: selectedLanguage,
          }),
        });
        const data = (await response.json()) as { translatedText?: string; error?: string };

        if (!response.ok || !data.translatedText) {
          throw new Error(data.error || "Translation failed.");
        }

        return {
          id: message.id,
          translatedText: data.translatedText,
        };
      }),
    )
      .then((results) => {
        if (cancelled) {
          return;
        }

        const successfulTranslations = results
          .filter((result): result is PromiseFulfilledResult<{ id: string; translatedText: string }> => result.status === "fulfilled")
          .map((result) => result.value);
        const translationMap = new Map(
          successfulTranslations.map((translation) => [translation.id, translation.translatedText]),
        );

        if (translationMap.size) {
          setMessages((currentMessages) =>
            currentMessages.map((message) => {
              const translatedText = translationMap.get(message.id);

              if (!translatedText) {
                return message;
              }

              return {
                ...message,
                content: translatedText,
                translations: {
                  ...message.translations,
                  [selectedLanguage]: translatedText,
                },
              };
            }),
          );
        }

        setTranslationFailed(successfulTranslations.length !== needsTranslation.length);
      })
      .finally(() => {
        if (!cancelled) {
          setIsTranslatingReplies(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [messages, selectedLanguage]);

  const submit = async () => {
    const trimmedInput = input.trim();

    if (!trimmedInput || isLoading) {
      return;
    }

    const userMessage = createMessage("user", trimmedInput);
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: buildProviderHeaders(),
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.sourceContent || message.content,
          })),
          patientContext: {
            age: formState.age ? Number(formState.age) : undefined,
            gestationalAgeWeeks: formState.gestationalAgeWeeks ? Number(formState.gestationalAgeWeeks) : undefined,
            trimester: formState.trimester || undefined,
            symptoms: formState.symptoms || undefined,
            duration: formState.duration || undefined,
            bloodPressure: formState.bloodPressure || undefined,
            temperatureC: formState.temperatureC ? Number(formState.temperatureC) : undefined,
            meds: formState.meds || undefined,
            knownConditions: formState.knownConditions || undefined,
            notes: formState.notes || undefined,
          },
          responseLanguage: selectedLanguage,
        }),
      });

      const data = (await response.json()) as ChatResponsePayload & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Chat request failed.");
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          ...createMessage("assistant", data.reply, {
            citations: data.citations,
            warning: data.warning,
          }),
          sourceContent: data.reply,
          sourceLanguage: data.replyLanguage,
        },
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      setMessages((currentMessages) => [
        ...currentMessages,
        createMessage("assistant", `${ui.requestFailed}\n\nTechnical detail: ${errorMessage}`),
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-app-shell">
      <section className="top-banner">
        <div>
          <p className="eyebrow">{ui.appName}</p>
          <h1>{ui.title}</h1>
          <p className="lede">{ui.lede}</p>
        </div>
        <div className="banner-tools">
          <label className="language-panel">
            <span className="mini-label">{ui.responseLanguage}</span>
            <select className="language-select" onChange={(event) => setSelectedLanguage(event.target.value as LanguageCode)} value={selectedLanguage}>
              {SUPPORTED_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.nativeName}
                </option>
              ))}
            </select>
          </label>

          <div className="banner-badges">
            <span className="pill">
              {knowledgeSnapshot.uploadedDocs} {ui.specialistReferencesAdded}
            </span>
            <span className="pill">{ui.pregnancyFocusedGuidance}</span>
            <span className={`pill ${effectiveLiveReady ? "pill-active" : ""}`}>
              {effectiveLiveReady ? "Live AI ready" : "Local grounded mode"}
            </span>
          </div>
        </div>
      </section>

      <div className="chatbot-layout">
        <main className="chatbot-main">
          <section className="chat-surface">
            <header className="chat-surface-header">
              <div>
                <p className="eyebrow">{ui.clinicalChat}</p>
                <h2>{ui.describeSymptomPattern}</h2>
              </div>
              <div className="quick-prompt-row">
                {ui.starterPrompts.map((prompt) => (
                  <button className="quick-prompt" key={prompt} onClick={() => setInput(prompt)} type="button">
                    {prompt}
                  </button>
                ))}
              </div>
            </header>

            <div className="message-thread">
              <article className="message-card message-card-assistant">
                <div className="message-chip">{ui.assistantLabel}</div>
                <div className="message-copy">{ui.initialMessage}</div>
              </article>

              {messages.map((message) => (
                <article className={`message-card message-card-${message.role}`} key={message.id}>
                  <div className="message-chip">{message.role === "assistant" ? ui.assistantLabel : ui.youLabel}</div>
                  <div className="message-copy">{message.content}</div>

                  {message.meta ? (
                    <div className="message-supporting">
                      {message.meta.warning ? <p className="warning-text">{message.meta.warning}</p> : null}

                      {message.meta.citations.length ? (
                        <div className="support-block">
                          <h3>{ui.sources}</h3>
                          <ul className="plain-list">
                            {message.meta.citations.slice(0, 6).map((citation) => (
                              <li key={citation.url}>
                                <a href={citation.url} rel="noreferrer" target="_blank">
                                  {citation.title}
                                </a>
                                {citation.publisher ? <span className="muted"> • {citation.publisher}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}

              {isLoading ? (
                <article className="message-card message-card-assistant">
                  <div className="message-chip">{ui.assistantLabel}</div>
                  <div className="message-copy">{ui.reviewing}</div>
                </article>
              ) : null}
            </div>

            <div className="composer-panel">
              <div className="composer-header">
                <div>
                  <p className="eyebrow">{ui.message}</p>
                  <p className="muted">{ui.onlyNeedMessage}</p>
                </div>
                <span className="composer-hint">{ui.sendHint}</span>
              </div>

              <textarea
                className="composer-textarea"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    void submit();
                  }
                }}
                placeholder={ui.messagePlaceholder}
                rows={5}
                value={input}
              />

              <div className="composer-footer">
                <div className="composer-note">
                  {isTranslatingReplies ? ui.translatingReplies : translationFailed ? ui.translationFailed : ui.composerNote}
                </div>
                <button className="send-button" disabled={isLoading || !input.trim()} onClick={() => void submit()} type="button">
                  {isLoading ? ui.analyzing : ui.sendRequest}
                </button>
              </div>
            </div>
          </section>
        </main>

        <aside className="chatbot-sidebar">
          <section className="side-card">
            <p className="eyebrow">Browser settings</p>
            <h2>Live AI provider</h2>
            <p className="settings-note">{browserSettingsNote}</p>

            <div className="side-form-grid compact-side-grid">
              <label className="field-span-2">
                <span className="mini-label">API key</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setBrowserSettings((current) => ({ ...current, apiKey: event.target.value }))}
                  placeholder="sk-..."
                  type="password"
                  value={browserSettings.apiKey}
                />
              </label>
              <label className="field-span-2">
                <span className="mini-label">Base URL</span>
                <input
                  onChange={(event) => setBrowserSettings((current) => ({ ...current, baseUrl: event.target.value }))}
                  placeholder="https://api.openai.com/v1"
                  value={browserSettings.baseUrl}
                />
              </label>
              <label>
                <span className="mini-label">Model</span>
                <input
                  onChange={(event) => setBrowserSettings((current) => ({ ...current, model: event.target.value }))}
                  placeholder="gpt-5-mini"
                  value={browserSettings.model}
                />
              </label>
              <label>
                <span className="mini-label">Provider name</span>
                <input
                  onChange={(event) => setBrowserSettings((current) => ({ ...current, provider: event.target.value }))}
                  placeholder="OpenAI"
                  value={browserSettings.provider}
                />
              </label>
            </div>

            <div className="sidebar-action-row">
              <button className="secondary-button" onClick={() => setBrowserSettings(EMPTY_BROWSER_SETTINGS)} type="button">
                Clear live AI settings
              </button>
            </div>
          </section>

          <section className="side-card side-card-highlight">
            <p className="eyebrow">{ui.optionalIntake}</p>
            <h2>{ui.healthDetails}</h2>
            <p className="muted">{ui.optionalIntakeNote}</p>

            <div className="side-form-grid">
              <label>
                {ui.age}
                <input
                  onChange={(event) => setFormState((current) => ({ ...current, age: event.target.value }))}
                  placeholder="31"
                  value={formState.age}
                />
              </label>
              <label>
                {ui.gestationalWeeks}
                <input
                  onChange={(event) => setFormState((current) => ({ ...current, gestationalAgeWeeks: event.target.value }))}
                  placeholder="24"
                  value={formState.gestationalAgeWeeks}
                />
              </label>
              <label>
                {ui.trimester}
                <select
                  onChange={(event) => setFormState((current) => ({ ...current, trimester: event.target.value }))}
                  value={formState.trimester}
                >
                  <option value="">{ui.select}</option>
                  <option value="First trimester">{ui.firstTrimester}</option>
                  <option value="Second trimester">{ui.secondTrimester}</option>
                  <option value="Third trimester">{ui.thirdTrimester}</option>
                  <option value="Postpartum">{ui.postpartum}</option>
                </select>
              </label>
              <label>
                {ui.duration}
                <input
                  onChange={(event) => setFormState((current) => ({ ...current, duration: event.target.value }))}
                  placeholder="2 days"
                  value={formState.duration}
                />
              </label>
              <label>
                {ui.bloodPressure}
                <input
                  onChange={(event) => setFormState((current) => ({ ...current, bloodPressure: event.target.value }))}
                  placeholder="152/98"
                  value={formState.bloodPressure}
                />
              </label>
              <label>
                {ui.temperatureC}
                <input
                  onChange={(event) => setFormState((current) => ({ ...current, temperatureC: event.target.value }))}
                  placeholder="38.1"
                  value={formState.temperatureC}
                />
              </label>
              <label className="field-span-2">
                {ui.keySymptoms}
                <textarea
                  onChange={(event) => setFormState((current) => ({ ...current, symptoms: event.target.value }))}
                  placeholder="Itching, vomiting, blurred vision, urinary symptoms, bleeding, reduced fetal movement..."
                  rows={3}
                  value={formState.symptoms}
                />
              </label>
              <label className="field-span-2">
                {ui.medications}
                <textarea
                  onChange={(event) => setFormState((current) => ({ ...current, meds: event.target.value }))}
                  placeholder="Prenatal vitamins, insulin, aspirin, antihistamines..."
                  rows={2}
                  value={formState.meds}
                />
              </label>
              <label className="field-span-2">
                {ui.conditionsHistory}
                <textarea
                  onChange={(event) => setFormState((current) => ({ ...current, knownConditions: event.target.value }))}
                  placeholder="Prior cholestasis, hypertension, thyroid disease, twins..."
                  rows={2}
                  value={formState.knownConditions}
                />
              </label>
              <label className="field-span-2">
                {ui.extraNotes}
                <textarea
                  onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Fetal movement changes, recent labs, clinician advice, rash progression..."
                  rows={2}
                  value={formState.notes}
                />
              </label>
            </div>

            <div className="sidebar-action-row">
              <button className="secondary-button" onClick={() => setFormState(EMPTY_FORM)} type="button">
                {ui.clearOptionalDetails}
              </button>
            </div>
          </section>

          <section className="side-card">
            <p className="eyebrow">{ui.redFlags}</p>
            <h2>{ui.urgentCare}</h2>
            <ul className="plain-list">
              <li>{ui.redFlag1}</li>
              <li>{ui.redFlag2}</li>
              <li>{ui.redFlag3}</li>
            </ul>
          </section>

          <section className="side-card">
            <p className="eyebrow">{ui.topicIdeas}</p>
            <div className="topic-chip-grid">
              {featuredDocs.map((doc) => (
                <button className="topic-chip" key={doc.id} onClick={() => setInput(doc.title)} type="button">
                  {doc.title}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
