export type ChatRole = "assistant" | "user";

export type { LanguageCode } from "@/lib/i18n";

export type DocSourceType = "seed" | "uploaded";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface PatientContext {
  age?: number;
  gestationalAgeWeeks?: number;
  trimester?: string;
  symptoms?: string;
  duration?: string;
  bloodPressure?: string;
  temperatureC?: number;
  meds?: string;
  knownConditions?: string;
  notes?: string;
}

export interface KnowledgeCitation {
  title: string;
  url: string;
  publisher?: string;
}

export interface KnowledgeSection {
  heading: string;
  content: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  category: string;
  summary: string;
  keywords: string[];
  symptomPatterns: string[];
  typicalTiming: string[];
  dangerSignals: string[];
  differentiators: string[];
  suggestedWorkup: string[];
  carePath: string[];
  pregnancyImpact: string[];
  citations: KnowledgeCitation[];
  sections: KnowledgeSection[];
  sourceType: DocSourceType;
  sourcePath?: string;
  rawContent: string;
  score?: number;
}

export interface KnowledgeStats {
  totalDocs: number;
  uploadedDocs: number;
  categories: string[];
  totalCitations: number;
}

export interface ChatResponsePayload {
  reply: string;
  replyLanguage: import("@/lib/i18n").LanguageCode;
  matchedDocs: Array<Pick<KnowledgeDoc, "id" | "title" | "category" | "score">>;
  citations: KnowledgeCitation[];
  mode: "fallback" | "live-model";
  provider: string;
  warning?: string;
}
