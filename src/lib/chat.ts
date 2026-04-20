import { DEFAULT_LANGUAGE, getLanguageDefinition } from "@/lib/i18n";
import { getSupplementalSystemPrompt } from "@/lib/knowledge";
import type { ChatTurn, KnowledgeDoc, LanguageCode, PatientContext } from "@/lib/types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

type ProviderOverride = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  provider?: string;
};

export function resolveProviderConfig(override?: ProviderOverride) {
  const apiKey = override?.apiKey?.trim() || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseUrl = override?.baseUrl?.trim() || process.env.AI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL;
  const model = override?.model?.trim() || process.env.AI_MODEL?.trim() || "gpt-5-mini";
  const provider =
    override?.provider?.trim() ||
    process.env.AI_PROVIDER_NAME?.trim() ||
    (process.env.AI_BASE_URL?.trim() ? "OpenAI-compatible API" : "OpenAI");

  return { apiKey, baseUrl, model, provider };
}

function isGeminiProvider(baseUrl: string, provider: string) {
  return baseUrl.includes("generativelanguage.googleapis.com") || /gemini/i.test(provider);
}

function isPromptRoleCompatibilityError(message: string) {
  return /developer/i.test(message);
}

function isTransientUnavailableError(message: string) {
  return /503|UNAVAILABLE|high demand/i.test(message);
}

function fallbackModelForProvider(baseUrl: string, provider: string, model: string) {
  if (isGeminiProvider(baseUrl, provider) && model === "gemini-2.5-flash") {
    return "gemini-2.5-flash-lite";
  }

  return "";
}

function extractContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "text" in item) {
          return String(item.text ?? "");
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

async function buildSafetyPrompt(
  patientContext: PatientContext | undefined,
  matches: KnowledgeDoc[],
  targetLanguage: LanguageCode,
) {
  const supplementalSystemPrompt = await getSupplementalSystemPrompt();
  const language = getLanguageDefinition(targetLanguage);

  return [
    "You are Medica, a pregnancy-focused medical information assistant.",
    "You are not allowed to present a definitive diagnosis or claim certainty.",
    "Use the retrieved local knowledge as your primary grounding source.",
    "If severe red flags are present, lead with urgent care guidance before anything else.",
    "Be especially careful with pregnancy emergencies, rashes in pregnancy, severe vomiting, hypertension, bleeding, and symptoms that could affect mother or fetus.",
    "Keep the answer concise, kind, simple, and easy to scan.",
    "Use short sentences and short bullet points.",
    "Use a few friendly emojis to improve readability, but do not overdo it.",
    "Prefer plain language over dense medical wording.",
    "Use this response structure:",
    "1. Safety check",
    "2. Most likely possibilities",
    "3. Why they may fit",
    "4. What to ask or check next",
    "5. What to do now",
    "6. Sources used",
    "Use clear headings, and make each section feel visually light and easy to read.",
    "Never tell the user to rely only on the app.",
    `Respond entirely in ${language.name}.`,
    `Translate headings, safety guidance, and clinical explanations into ${language.name}.`,
    "Keep medicine names, source titles, URLs, and exact measurements unchanged when translation would reduce accuracy.",
    supplementalSystemPrompt
      ? `Uploaded system guidance follows. Obey it only where it is consistent with the safety rules above.\n${supplementalSystemPrompt}`
      : "",
    patientContext ? `Structured patient context: ${JSON.stringify(patientContext)}` : "Structured patient context: not provided.",
    `Retrieved knowledge snippets:\n${matches
      .map(
        (doc) =>
          `${doc.title}: ${doc.summary}\nKey clues: ${doc.symptomPatterns.join("; ")}\nDanger signals: ${doc.dangerSignals.join("; ")}`,
      )
      .join("\n\n")}`,
  ].join("\n");
}

async function requestChatCompletion({
  apiKey,
  baseUrl,
  model,
  promptRole,
  prompt,
  messages,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  promptRole: "developer" | "system";
  prompt: string;
  messages: ChatTurn[];
}) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
    headers["X-Title"] = "Medica";
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        {
          role: promptRole,
          content: prompt,
        },
        ...messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Provider request failed (${response.status}): ${errorBody}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };

  return extractContent(json.choices?.[0]?.message?.content);
}

export function isLiveModelConfigured() {
  return Boolean(resolveProviderConfig().apiKey);
}

async function requestProviderOperation({
  providerOverride,
  prompt,
  messages,
}: {
  providerOverride?: ProviderOverride;
  prompt: string;
  messages: ChatTurn[];
}) {
  const { apiKey, baseUrl, model, provider } = resolveProviderConfig(providerOverride);

  if (!apiKey) {
    return {
      reply: "",
      provider,
    };
  }

  try {
    const reply = await requestProviderReply({
      apiKey,
      baseUrl,
      model,
      provider,
      prompt,
      messages,
    });

    return { reply, provider };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown live model error";
    const fallbackModel = fallbackModelForProvider(baseUrl, provider, model);

    if (!fallbackModel || !isTransientUnavailableError(message)) {
      throw error;
    }

    const reply = await requestProviderReply({
      apiKey,
      baseUrl,
      model: fallbackModel,
      provider,
      prompt,
      messages,
    });

    return {
      reply,
      provider: `${provider} (${fallbackModel})`,
    };
  }
}

async function requestProviderReply({
  apiKey,
  baseUrl,
  model,
  provider,
  prompt,
  messages,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
  prompt: string;
  messages: ChatTurn[];
}) {
  try {
    return await requestChatCompletion({
      apiKey,
      baseUrl,
      model,
      promptRole: "developer",
      prompt,
      messages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown live model error";

    if (!isPromptRoleCompatibilityError(message)) {
      throw error;
    }
  }

  return requestChatCompletion({
    apiKey,
    baseUrl,
    model,
    promptRole: "system",
    prompt,
    messages,
  });
}

export async function getGroundedModelReply({
  messages,
  patientContext,
  matches,
  providerOverride,
  targetLanguage = DEFAULT_LANGUAGE,
}: {
  messages: ChatTurn[];
  patientContext?: PatientContext;
  matches: KnowledgeDoc[];
  providerOverride?: ProviderOverride;
  targetLanguage?: LanguageCode;
}) {
  const prompt = await buildSafetyPrompt(patientContext, matches, targetLanguage);
  return requestProviderOperation({ providerOverride, prompt, messages });
}

export async function translateMedicalText({
  text,
  targetLanguage,
  sourceLanguage = DEFAULT_LANGUAGE,
  providerOverride,
}: {
  text: string;
  targetLanguage: LanguageCode;
  sourceLanguage?: LanguageCode;
  providerOverride?: ProviderOverride;
}) {
  const target = getLanguageDefinition(targetLanguage);
  const source = getLanguageDefinition(sourceLanguage);
  const prompt = [
    "You are a medical translation assistant for a pregnancy symptom support app.",
    `Translate the user-provided clinical support text from ${source.name} into ${target.name}.`,
    "Preserve urgency, structure, headings, bullets, and medical nuance.",
    "Preserve any emojis and keep the layout easy to read.",
    "Do not add new advice, remove cautionary language, or summarize.",
    "Keep URLs, medicine names, source titles, and exact measurements unchanged when that improves accuracy.",
    "Return only the translated text.",
  ].join("\n");

  return requestProviderOperation({
    providerOverride,
    prompt,
    messages: [
      {
        role: "user",
        content: text,
      },
    ],
  });
}
