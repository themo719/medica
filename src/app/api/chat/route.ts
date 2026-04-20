import { z } from "zod";

import { getGroundedModelReply, resolveProviderConfig } from "@/lib/chat";
import { DEFAULT_LANGUAGE, LANGUAGE_CODES } from "@/lib/i18n";
import { buildKnowledgePacket, dedupeCitations, searchKnowledge } from "@/lib/knowledge";
import { generateFallbackResponse } from "@/lib/mock-response";
import type { ChatResponsePayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["assistant", "user"]),
        content: z.string().min(1).max(5000),
      }),
    )
    .min(1)
    .max(18),
  patientContext: z
    .object({
      age: z.number().int().min(10).max(70).optional(),
      gestationalAgeWeeks: z.number().int().min(0).max(45).optional(),
      trimester: z.string().max(40).optional(),
      symptoms: z.string().max(1200).optional(),
      duration: z.string().max(120).optional(),
      bloodPressure: z.string().max(30).optional(),
      temperatureC: z.number().min(30).max(45).optional(),
      meds: z.string().max(800).optional(),
      knownConditions: z.string().max(800).optional(),
      notes: z.string().max(1200).optional(),
    })
    .optional(),
  responseLanguage: z.enum(LANGUAGE_CODES).default(DEFAULT_LANGUAGE),
});

export async function POST(request: Request) {
  try {
    const providerOverride = {
      apiKey: request.headers.get("x-ai-api-key")?.trim() || undefined,
      baseUrl: request.headers.get("x-ai-base-url")?.trim() || undefined,
      model: request.headers.get("x-ai-model")?.trim() || undefined,
      provider: request.headers.get("x-ai-provider-name")?.trim() || undefined,
    };
    const body = requestSchema.parse(await request.json());
    const responseLanguage = body.responseLanguage ?? DEFAULT_LANGUAGE;
    const latestUserMessage = body.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
    const combinedQuery = [
      latestUserMessage,
      body.patientContext?.symptoms,
      body.patientContext?.notes,
      body.patientContext?.trimester,
      typeof body.patientContext?.gestationalAgeWeeks === "number"
        ? `${body.patientContext.gestationalAgeWeeks} weeks pregnant`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    const matches = await searchKnowledge(combinedQuery, 6);
    const groundedHistory = [
      {
        role: "user" as const,
        content: `Knowledge context:\n${buildKnowledgePacket(matches, combinedQuery)}\n\nPatient message:\n${latestUserMessage}`,
      },
    ];
    const configuredProvider = resolveProviderConfig(providerOverride).provider;

    let liveReply = {
      reply: "",
      provider: configuredProvider,
    };
    let warning: string | undefined;

    try {
      liveReply = await getGroundedModelReply({
        messages: [...body.messages.slice(-8), ...groundedHistory],
        patientContext: body.patientContext,
        matches,
        providerOverride,
        targetLanguage: responseLanguage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown live model error";
      warning = `The live provider request failed, so the app fell back to the local grounded mode instead. Technical detail: ${message}`;
    }

    const citations = dedupeCitations(matches);
    const payload: ChatResponsePayload = {
      reply:
        liveReply.reply ||
        generateFallbackResponse({
          messages: body.messages,
          patientContext: body.patientContext,
          matches,
          fallbackReason: warning ? "provider-failed" : "not-configured",
          providerLabel: liveReply.provider,
        }),
      replyLanguage: liveReply.reply ? responseLanguage : DEFAULT_LANGUAGE,
      matchedDocs: matches.map((doc) => ({
        id: doc.id,
        title: doc.title,
        category: doc.category,
        score: doc.score,
      })),
      citations,
      mode: liveReply.reply ? "live-model" : "fallback",
      provider: liveReply.provider,
      warning:
        warning ||
        (liveReply.reply
          ? undefined
          : "No live API key is configured yet, so the response came from the local grounded fallback mode."),
    };

    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";

    return Response.json(
      {
        error: message,
      },
      {
        status: 400,
      },
    );
  }
}
