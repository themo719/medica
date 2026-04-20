import { z } from "zod";

import { translateMedicalText } from "@/lib/chat";
import { DEFAULT_LANGUAGE, LANGUAGE_CODES } from "@/lib/i18n";

const requestSchema = z.object({
  text: z.string().min(1).max(20000),
  targetLanguage: z.enum(LANGUAGE_CODES),
  sourceLanguage: z.enum(LANGUAGE_CODES).default(DEFAULT_LANGUAGE),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const providerOverride = {
      apiKey: request.headers.get("x-ai-api-key")?.trim() || undefined,
      baseUrl: request.headers.get("x-ai-base-url")?.trim() || undefined,
      model: request.headers.get("x-ai-model")?.trim() || undefined,
      provider: request.headers.get("x-ai-provider-name")?.trim() || undefined,
    };
    const body = requestSchema.parse(await request.json());
    const translated = await translateMedicalText({
      text: body.text,
      targetLanguage: body.targetLanguage,
      sourceLanguage: body.sourceLanguage,
      providerOverride,
    });

    if (!translated.reply) {
      return Response.json(
        {
          error: "No live translation provider is configured.",
        },
        {
          status: 503,
        },
      );
    }

    return Response.json({
      translatedText: translated.reply,
      language: body.targetLanguage,
      provider: translated.provider,
    });
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
