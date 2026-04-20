import { promises as fs } from "fs";
import path from "path";

import matter from "gray-matter";

import type { KnowledgeCitation, KnowledgeDoc, KnowledgeSection, KnowledgeStats } from "@/lib/types";

const KNOWLEDGE_ROOTS = [
  path.join(process.cwd(), "data", "knowledge", "base"),
  path.join(process.cwd(), "training-data"),
];

const NON_RETRIEVAL_FILENAMES = new Set(["readme.md", "system_prompt.md"]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "pregnant",
  "she",
  "so",
  "that",
  "the",
  "their",
  "there",
  "they",
  "this",
  "to",
  "we",
  "what",
  "when",
  "with",
  "weeks",
  "week",
]);

let knowledgeCache: Promise<KnowledgeDoc[]> | undefined;
let supplementalPromptCache: Promise<string> | undefined;

type LooseDoc = Partial<KnowledgeDoc> & {
  overview?: string;
  content?: string;
  sections?: KnowledgeSection[];
};

type ScoredSection = {
  section: KnowledgeSection;
  score: number;
};

function shouldIgnoreEntry(entryName: string) {
  return entryName.startsWith("._");
}

function uniqueStrings(values: string[], limit = values.length) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, limit);
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdownFormatting(value: string) {
  return value
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\|/g, " ")
    .trim();
}

function cleanListLine(value: string) {
  return stripMarkdownFormatting(value)
    .replace(/^[-*+]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^[-–—]\s*/, "")
    .trim();
}

function isContentLine(value: string) {
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed !== "---";
}

function asStringArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return uniqueStrings(
      input
        .map((value) => String(value).trim())
        .filter(Boolean),
    );
  }

  if (typeof input === "string") {
    return uniqueStrings(
      input
        .split(/\r?\n|,/)
        .map((value) => cleanListLine(value))
        .filter(Boolean),
    );
  }

  return [];
}

function asCitations(input: unknown): KnowledgeCitation[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const citations: KnowledgeCitation[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const title = "title" in item ? String(item.title ?? "").trim() : "";
    const url = "url" in item ? String(item.url ?? "").trim() : "";
    const publisher = "publisher" in item ? String(item.publisher ?? "").trim() : "";

    if (!title || !url) {
      continue;
    }

    citations.push({
      title,
      url,
      publisher: publisher || undefined,
    });
  }

  return citations;
}

function titleFromFilename(filePath: string) {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/^\d+_?/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstHeading(content: string) {
  const heading = content
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith("#"));

  return heading ? heading.replace(/^#+\s*/, "").trim() : "";
}

function categoryFromPath(filePath: string) {
  if (filePath.includes(`${path.sep}pregnancy_conditions${path.sep}`)) {
    return "Uploaded pregnancy conditions";
  }

  if (filePath.includes(`${path.sep}lab_reference${path.sep}`)) {
    return "Pregnancy lab reference";
  }

  if (filePath.includes(`${path.sep}pharmacology${path.sep}`)) {
    return "Pregnancy pharmacology";
  }

  if (filePath.includes(`${path.sep}guidelines${path.sep}`)) {
    return "Uploaded guidelines";
  }

  return "Uploaded reference";
}

function inferPublisherFromUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");

    if (hostname.includes("pubmed.ncbi.nlm.nih.gov")) {
      return "PubMed";
    }

    if (hostname.includes("ncbi.nlm.nih.gov")) {
      return "NCBI Bookshelf";
    }

    if (hostname.includes("medlineplus.gov")) {
      return "MedlinePlus";
    }

    if (hostname.includes("acog.org")) {
      return "ACOG";
    }

    if (hostname.includes("nhs.uk")) {
      return "NHS";
    }

    if (hostname.includes("nih.gov")) {
      return "NIH";
    }

    if (hostname.includes("who.int")) {
      return "WHO";
    }

    if (hostname.includes("nice.org.uk")) {
      return "NICE";
    }

    return hostname;
  } catch {
    return undefined;
  }
}

function dedupeCitationList(citations: KnowledgeCitation[]) {
  const citationMap = new Map<string, KnowledgeCitation>();

  for (const citation of citations) {
    citationMap.set(citation.url, citation);
  }

  return Array.from(citationMap.values());
}

function parseMarkdownSections(content: string): KnowledgeSection[] {
  const lines = content.split(/\r?\n/);
  const sections: KnowledgeSection[] = [];
  let currentHeading = "Overview";
  let currentLines: string[] = [];

  const pushSection = () => {
    const cleanedContent = currentLines
      .map((line) => line.trimEnd())
      .filter(isContentLine)
      .map((line) => stripMarkdownFormatting(line))
      .filter(Boolean)
      .join("\n")
      .trim();

    if (cleanedContent) {
      sections.push({
        heading: currentHeading,
        content: cleanedContent,
      });
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#\s+/.test(trimmed)) {
      continue;
    }

    const headingMatch = trimmed.match(/^##+\s+(.*)$/);

    if (headingMatch) {
      pushSection();
      currentHeading = stripMarkdownFormatting(headingMatch[1]) || "Section";
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  pushSection();

  return sections.length
    ? sections
    : [
        {
          heading: "Overview",
          content: stripMarkdownFormatting(content),
        },
      ];
}

function normalizeSections(input: unknown): KnowledgeSection[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const sections: KnowledgeSection[] = [];

  for (const section of input) {
    if (!section || typeof section !== "object") {
      continue;
    }

    const heading = "heading" in section ? normalizeWhitespace(String(section.heading ?? "")) : "";
    const content = "content" in section ? String(section.content ?? "").trim() : "";

    if (!heading || !content) {
      continue;
    }

    sections.push({ heading, content });
  }

  return sections;
}

function buildStructuredSections(raw: LooseDoc, extraContent?: string) {
  const sections: KnowledgeSection[] = [];

  const sectionEntries: Array<[string, string[]]> = [
    ["Overview", [String(raw.summary ?? raw.overview ?? "").trim()].filter(Boolean)],
    ["Symptom patterns", asStringArray(raw.symptomPatterns)],
    ["Typical timing", asStringArray(raw.typicalTiming)],
    ["Danger signals", asStringArray(raw.dangerSignals)],
    ["Differentiators", asStringArray(raw.differentiators)],
    ["Suggested workup", asStringArray(raw.suggestedWorkup)],
    ["Care path", asStringArray(raw.carePath)],
    ["Pregnancy impact", asStringArray(raw.pregnancyImpact)],
  ];

  for (const [heading, items] of sectionEntries) {
    if (!items.length) {
      continue;
    }

    sections.push({
      heading,
      content: items.join("\n"),
    });
  }

  if (extraContent?.trim()) {
    sections.push({
      heading: "Additional notes",
      content: stripMarkdownFormatting(extraContent),
    });
  }

  return sections;
}

function extractInlineCitations(content: string): KnowledgeCitation[] {
  const citations: KnowledgeCitation[] = [];

  for (const line of content.split(/\r?\n/)) {
    const urls = line.match(/https?:\/\/[^\s)]+/g);

    if (!urls) {
      continue;
    }

    for (const url of urls) {
      const title = normalizeWhitespace(
        cleanListLine(
          line
            .replace(url, "")
            .replace(/^#+\s*/, "")
            .replace(/^URL:\s*/i, ""),
        ),
      );

      citations.push({
        title: title || "Source",
        url,
        publisher: inferPublisherFromUrl(url),
      });
    }
  }

  return dedupeCitationList(citations);
}

function linesFromSections(sections: KnowledgeSection[], headingPatterns: RegExp[], limit = 8, lineMatcher?: RegExp) {
  const matches: string[] = [];

  for (const section of sections) {
    if (!headingPatterns.some((pattern) => pattern.test(section.heading))) {
      continue;
    }

    const lines = section.content
      .split(/\r?\n/)
      .map((line) => cleanListLine(line))
      .filter(Boolean);

    for (const line of lines) {
      if (lineMatcher && !lineMatcher.test(line)) {
        continue;
      }

      matches.push(line);
    }
  }

  return uniqueStrings(matches, limit);
}

function linesFromContent(content: string, matcher: RegExp, limit = 8) {
  return uniqueStrings(
    content
      .split(/\r?\n/)
      .map((line) => cleanListLine(line))
      .filter((line) => Boolean(line) && matcher.test(line)),
    limit,
  );
}

function deriveSummary(content: string, sections: KnowledgeSection[]) {
  const overviewSection = sections.find((section) => /overview|summary|what is this|spectrum/i.test(section.heading));
  const source = overviewSection?.content || sections[0]?.content || content;

  return normalizeWhitespace(
    source
      .split(/\r?\n/)
      .slice(0, 4)
      .join(" ")
      .slice(0, 360),
  );
}

function deriveKeywords(title: string, sections: KnowledgeSection[], content: string, explicitKeywords: unknown) {
  const boldTerms = Array.from(content.matchAll(/\*\*([^*]+)\*\*/g)).map((match) => normalizeWhitespace(match[1]));
  const sectionHeadings = sections.map((section) => section.heading);
  const titleKeywords = title
    .split(/[()/:,-]/)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 2);

  return uniqueStrings([...asStringArray(explicitKeywords), title, ...titleKeywords, ...sectionHeadings, ...boldTerms], 24);
}

function tokenize(input: string) {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .split(/[^a-z0-9.]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
    ),
  );
}

function sectionScore(section: KnowledgeSection, query: string) {
  const tokens = tokenize(query);
  const heading = section.heading.toLowerCase();
  const haystack = `${heading}\n${section.content}`.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (heading.includes(token)) {
      score += 8;
    }

    const occurrences = haystack.split(token).length - 1;
    score += Math.min(Math.max(occurrences, 0), 5);
  }

  if (/overview|clinical|diagnosis|treatment|management|references?/i.test(section.heading)) {
    score += 1;
  }

  return score;
}

function truncateSection(value: string, maxLength = 360) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
}

function buildRawContent(doc: Omit<KnowledgeDoc, "rawContent" | "score">, extraContent?: string) {
  return [
    doc.title,
    doc.category,
    doc.summary,
    ...doc.keywords,
    ...doc.symptomPatterns,
    ...doc.typicalTiming,
    ...doc.dangerSignals,
    ...doc.differentiators,
    ...doc.suggestedWorkup,
    ...doc.carePath,
    ...doc.pregnancyImpact,
    ...doc.sections.map((section) => `${section.heading}\n${section.content}`),
    extraContent ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

function normalizeDoc(raw: LooseDoc, filePath: string, index: number): KnowledgeDoc {
  const sourceType = filePath.includes(`${path.sep}training-data${path.sep}`) ? "uploaded" : "seed";
  const normalizedSections = normalizeSections(raw.sections);
  const sections = normalizedSections.length ? normalizedSections : buildStructuredSections(raw, raw.content);
  const id =
    String(raw.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || `${path.basename(filePath, path.extname(filePath))}-${index + 1}`;

  const normalized: Omit<KnowledgeDoc, "rawContent" | "score"> = {
    id,
    title: String(raw.title ?? "").trim() || titleFromFilename(filePath),
    category: String(raw.category ?? "").trim() || "General",
    summary: String(raw.summary ?? raw.overview ?? "").trim(),
    keywords: asStringArray(raw.keywords),
    symptomPatterns: asStringArray(raw.symptomPatterns),
    typicalTiming: asStringArray(raw.typicalTiming),
    dangerSignals: asStringArray(raw.dangerSignals),
    differentiators: asStringArray(raw.differentiators),
    suggestedWorkup: asStringArray(raw.suggestedWorkup),
    carePath: asStringArray(raw.carePath),
    pregnancyImpact: asStringArray(raw.pregnancyImpact),
    citations: dedupeCitationList(asCitations(raw.citations)),
    sections,
    sourceType,
    sourcePath: filePath,
  };

  return {
    ...normalized,
    rawContent: buildRawContent(normalized, raw.content),
  };
}

async function readDirectoryRecursive(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        if (shouldIgnoreEntry(entry.name)) {
          return [];
        }

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          return readDirectoryRecursive(fullPath);
        }

        return [fullPath];
      }),
    );

    return nested.flat();
  } catch (error) {
    const maybeNodeError = error as NodeJS.ErrnoException;

    if (maybeNodeError.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readJsonDocs(filePath: string): Promise<KnowledgeDoc[]> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;

  const docs = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { documents?: unknown[] }).documents)
      ? ((raw as { documents: unknown[] }).documents ?? [])
      : [raw];

  return docs.map((doc, index) => normalizeDoc((doc ?? {}) as LooseDoc, filePath, index));
}

async function readTextDoc(filePath: string): Promise<KnowledgeDoc[]> {
  const rawText = await fs.readFile(filePath, "utf8");
  const { data, content } = matter(rawText);
  const title = typeof data.title === "string" ? data.title : firstHeading(content) || titleFromFilename(filePath);
  const sections = parseMarkdownSections(content);
  const inlineCitations = extractInlineCitations(content);

  return [
    normalizeDoc(
      {
        id: typeof data.id === "string" ? data.id : undefined,
        title,
        category: typeof data.category === "string" ? data.category : categoryFromPath(filePath),
        summary: typeof data.summary === "string" ? data.summary : deriveSummary(content, sections),
        keywords: deriveKeywords(title, sections, content, data.keywords),
        symptomPatterns:
          asStringArray(data.symptomPatterns).length > 0
            ? data.symptomPatterns
            : [
                ...linesFromSections(sections, [/clinical features|symptoms|lesion|distribution|presentation|chief complaint/i], 10),
                ...linesFromContent(content, /(itch|prur|pain|bleed|vomit|nausea|headache|vision|fever|swelling|blister|rash|dyspnea|shortness of breath|urinary|jaundice|movement)/i, 6),
              ],
        typicalTiming:
          asStringArray(data.typicalTiming).length > 0
            ? data.typicalTiming
            : [
                ...linesFromSections(sections, [/timing|epidemiology|clinical course|onset|when/i], 8),
                ...linesFromContent(content, /(trimester|postpartum|weeks|week|delivery|parturition|later pregnancy|early pregnancy)/i, 6),
              ],
        dangerSignals:
          asStringArray(data.dangerSignals).length > 0
            ? data.dangerSignals
            : [
                ...linesFromSections(sections, [/red flags|emerg|warning|severe features|urgent/i], 10),
                ...linesFromContent(content, /(seiz|syncope|faint|heavy bleeding|dyspnea|shortness of breath|severe pain|jaundice|altered mental|confusion|reduced fetal movement|chest pain)/i, 8),
              ],
        differentiators:
          asStringArray(data.differentiators).length > 0
            ? data.differentiators
            : linesFromSections(sections, [/differential|distinction|comparison|distinguish/i], 10),
        suggestedWorkup:
          asStringArray(data.suggestedWorkup).length > 0
            ? data.suggestedWorkup
            : [
                ...linesFromSections(sections, [/diagnosis|evaluation|test|screening|criteria|lab/i], 12),
                ...linesFromContent(content, /(ultrasound|biopsy|immunofluorescence|bile acids|cbc|lfts?|creatinine|urinalysis|hcg|tsh|culture|doppler|ctg)/i, 8),
              ],
        carePath:
          asStringArray(data.carePath).length > 0
            ? data.carePath
            : linesFromSections(sections, [/treatment|management|therapy|monitoring|care|delivery timing|postpartum monitoring/i], 12),
        pregnancyImpact:
          asStringArray(data.pregnancyImpact).length > 0
            ? data.pregnancyImpact
            : linesFromSections(sections, [/fetal risk|maternal complication|prognosis|complication/i], 10),
        citations: [...asCitations(data.citations), ...inlineCitations],
        sections,
        content,
      },
      filePath,
      0,
    ),
  ];
}

async function loadKnowledge(): Promise<KnowledgeDoc[]> {
  const allFiles = (await Promise.all(KNOWLEDGE_ROOTS.map((root) => readDirectoryRecursive(root)))).flat();
  const supportedFiles = allFiles.filter((filePath) => {
    if (shouldIgnoreEntry(path.basename(filePath))) {
      return false;
    }

    if (!/\.(json|md|txt|csv)$/i.test(filePath)) {
      return false;
    }

    return !NON_RETRIEVAL_FILENAMES.has(path.basename(filePath).toLowerCase());
  });

  const docs = (
    await Promise.all(
      supportedFiles.map(async (filePath) => {
        if (filePath.endsWith(".json")) {
          return readJsonDocs(filePath);
        }

        return readTextDoc(filePath);
      }),
    )
  ).flat();

  return docs
    .filter((doc) => doc.title && doc.summary)
    .sort((left, right) => left.title.localeCompare(right.title));
}

function scoreDoc(doc: KnowledgeDoc, query: string) {
  const tokens = tokenize(query);
  const lowerQuery = query.toLowerCase();
  const title = doc.title.toLowerCase();
  const keywords = doc.keywords.join(" ").toLowerCase();
  const summary = doc.summary.toLowerCase();
  const symptoms = doc.symptomPatterns.join(" ").toLowerCase();
  const dangerSignals = doc.dangerSignals.join(" ").toLowerCase();
  const timing = doc.typicalTiming.join(" ").toLowerCase();
  let score = 0;

  if (!tokens.length) {
    return score;
  }

  for (const token of tokens) {
    if (title.includes(token)) {
      score += 8;
    }

    if (keywords.includes(token)) {
      score += 7;
    }

    if (summary.includes(token)) {
      score += 4;
    }

    if (symptoms.includes(token)) {
      score += 5;
    }

    if (dangerSignals.includes(token)) {
      score += 6;
    }

    if (timing.includes(token)) {
      score += 3;
    }

    const occurrenceCount = doc.rawContent.split(token).length - 1;
    score += Math.min(Math.max(occurrenceCount, 0), 4);
  }

  if (lowerQuery.length > 12 && doc.rawContent.includes(lowerQuery)) {
    score += 12;
  }

  if (doc.sourceType === "uploaded") {
    score += 2;
  }

  return score;
}

export async function getKnowledgeBase(forceRefresh = false) {
  if (!knowledgeCache || forceRefresh) {
    knowledgeCache = loadKnowledge();
  }

  return knowledgeCache;
}

export async function searchKnowledge(query: string, limit = 6) {
  const docs = await getKnowledgeBase();

  if (!query.trim()) {
    return docs.slice(0, limit).map((doc) => ({ ...doc, score: 0 }));
  }

  const scored = docs
    .map((doc) => ({ ...doc, score: scoreDoc(doc, query) }))
    .filter((doc) => (doc.score ?? 0) > 0)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.title.localeCompare(right.title));

  if (scored.length) {
    return scored.slice(0, limit);
  }

  return docs.slice(0, limit).map((doc) => ({ ...doc, score: 0 }));
}

export async function getFeaturedKnowledge(limit = 6) {
  const docs = await getKnowledgeBase();
  const preferredOrder = [
    "preeclampsia-hellp-spectrum",
    "hyperemesis-gravidarum",
    "intrahepatic-cholestasis-of-pregnancy",
    "pemphigoid-gestationis",
    "ectopic-pregnancy",
    "pregnancy-rash-pruritus-differential",
  ];

  const sorted = [...docs].sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(left.id);
    const rightIndex = preferredOrder.indexOf(right.id);

    if (leftIndex >= 0 || rightIndex >= 0) {
      return (leftIndex >= 0 ? leftIndex : Number.MAX_SAFE_INTEGER) - (rightIndex >= 0 ? rightIndex : Number.MAX_SAFE_INTEGER);
    }

    return left.title.localeCompare(right.title);
  });

  return sorted.slice(0, limit);
}

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  const docs = await getKnowledgeBase();
  const categories = Array.from(new Set(docs.map((doc) => doc.category))).sort((left, right) => left.localeCompare(right));
  const totalCitations = new Set(docs.flatMap((doc) => doc.citations.map((citation) => citation.url))).size;

  return {
    totalDocs: docs.length,
    uploadedDocs: docs.filter((doc) => doc.sourceType === "uploaded").length,
    categories,
    totalCitations,
  };
}

export function getRelevantSectionExcerpts(doc: KnowledgeDoc, query: string, limit = 2) {
  if (!doc.sections.length) {
    return [];
  }

  const scoredSections: ScoredSection[] = doc.sections
    .map((section) => ({
      section,
      score: query.trim() ? sectionScore(section, query) : 0,
    }))
    .sort((left, right) => right.score - left.score || left.section.heading.localeCompare(right.section.heading));

  const selected = query.trim()
    ? scoredSections.filter((item) => item.score > 0).slice(0, limit)
    : scoredSections.slice(0, limit);

  return selected.map(({ section }) => `${section.heading}: ${truncateSection(section.content)}`);
}

export async function getSupplementalSystemPrompt(forceRefresh = false) {
  if (!supplementalPromptCache || forceRefresh) {
    supplementalPromptCache = (async () => {
      const trainingRoot = path.join(process.cwd(), "training-data");
      const allFiles = await readDirectoryRecursive(trainingRoot);
      const promptFiles = allFiles.filter((filePath) => {
        const filename = path.basename(filePath);
        return !shouldIgnoreEntry(filename) && /system_prompt\.md$/i.test(filename);
      });

      if (!promptFiles.length) {
        return "";
      }

      const prompts = await Promise.all(
        promptFiles.map(async (filePath) => {
          const content = await fs.readFile(filePath, "utf8");
          return content.trim();
        }),
      );

      return prompts.filter(Boolean).join("\n\n---\n\n");
    })();
  }

  return supplementalPromptCache;
}

export function buildKnowledgePacket(docs: KnowledgeDoc[], query = "") {
  return docs
    .map((doc, index) => {
      const citations = doc.citations
        .map((citation) => `${citation.title} (${citation.publisher ?? "Source"}): ${citation.url}`)
        .join("\n");
      const excerpts = getRelevantSectionExcerpts(doc, query, 2).join("\n");

      return [
        `${index + 1}. ${doc.title} [${doc.category}] ${doc.sourceType === "uploaded" ? "(uploaded corpus)" : "(seed corpus)"}`,
        `Summary: ${doc.summary}`,
        `Symptom patterns: ${doc.symptomPatterns.join("; ") || "Not specified."}`,
        `Typical timing: ${doc.typicalTiming.join("; ") || "Not specified."}`,
        `Danger signals: ${doc.dangerSignals.join("; ") || "Not specified."}`,
        `Differentiators: ${doc.differentiators.join("; ") || "Not specified."}`,
        `Suggested workup: ${doc.suggestedWorkup.join("; ") || "Not specified."}`,
        `Care path: ${doc.carePath.join("; ") || "Not specified."}`,
        `Pregnancy impact: ${doc.pregnancyImpact.join("; ") || "Not specified."}`,
        `Relevant excerpts:\n${excerpts || "No excerpt selected."}`,
        `Citations:\n${citations || "No citations provided."}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function dedupeCitations(docs: KnowledgeDoc[]) {
  const citationMap = new Map<string, KnowledgeCitation>();

  for (const doc of docs) {
    for (const citation of doc.citations) {
      citationMap.set(citation.url, citation);
    }
  }

  return Array.from(citationMap.values());
}
