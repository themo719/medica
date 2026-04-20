import { getRelevantSectionExcerpts } from "@/lib/knowledge";
import type { ChatTurn, KnowledgeDoc, PatientContext } from "@/lib/types";

const EMERGENCY_PATTERNS = [
  "heavy bleeding",
  "soaking pads",
  "chest pain",
  "shortness of breath",
  "trouble breathing",
  "seizure",
  "fainting",
  "passed out",
  "vision changes",
  "severe headache",
  "one sided leg swelling",
  "one-sided leg swelling",
  "shoulder pain",
  "confusion",
  "reduced fetal movement",
  "decreased fetal movement",
];

function parseBloodPressure(bp?: string) {
  if (!bp) {
    return null;
  }

  const match = bp.match(/(\d{2,3})\D+(\d{2,3})/);

  if (!match) {
    return null;
  }

  return {
    systolic: Number(match[1]),
    diastolic: Number(match[2]),
  };
}

function collectRedFlags(query: string, patientContext?: PatientContext) {
  const normalizedQuery = query.toLowerCase();
  const redFlags = EMERGENCY_PATTERNS.filter((pattern) => normalizedQuery.includes(pattern));
  const temperature = patientContext?.temperatureC;
  const bloodPressure = parseBloodPressure(patientContext?.bloodPressure);

  if (typeof temperature === "number" && temperature >= 38) {
    redFlags.push(`fever ${temperature.toFixed(1)} C`);
  }

  if (bloodPressure && (bloodPressure.systolic >= 160 || bloodPressure.diastolic >= 110)) {
    redFlags.push(`severely elevated blood pressure ${bloodPressure.systolic}/${bloodPressure.diastolic}`);
  }

  return Array.from(new Set(redFlags));
}

function formatBulletList(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function formatEmojiBulletList(emoji: string, items: string[]) {
  return items.map((item) => `${emoji} ${item}`).join("\n");
}

function docMatches(doc: KnowledgeDoc, ...needles: string[]) {
  const haystack = [doc.id, doc.title, doc.summary, ...doc.keywords].join(" ").toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function bestClarifyingQuestions(matches: KnowledgeDoc[]) {
  const questionBank = new Set<string>();

  for (const doc of matches) {
    if (docMatches(doc, "preeclampsia", "hellp", "eclampsia")) {
      questionBank.add("What is the current blood pressure, and are there headaches, visual changes, or right upper abdominal pain?");
    }

    if (docMatches(doc, "pemphigoid gestationis", "puppp", "polymorphic eruption")) {
      questionBank.add("Did the rash start around the belly button, and are there actual blisters or mainly itchy bumps in stretch marks?");
    }

    if (docMatches(doc, "cholestasis", "icp")) {
      questionBank.add("Is the main symptom itching without a primary rash, especially on the palms or soles and worse at night?");
    }

    if (docMatches(doc, "hyperemesis", "severe vomiting")) {
      questionBank.add("Can fluids stay down, how often are you vomiting, and is there reduced urination or weight loss?");
    }

    if (docMatches(doc, "ectopic", "miscarriage", "pregnancy loss")) {
      questionBank.add("Is there vaginal bleeding, one-sided pelvic pain, shoulder pain, dizziness, or fainting?");
    }

    if (docMatches(doc, "urinary tract", "pyelonephritis", "uti")) {
      questionBank.add("Are there urinary symptoms, fever, back pain, or shaking chills?");
    }

    if (docMatches(doc, "vte", "dvt", "pulmonary embolism")) {
      questionBank.add("Is any leg swelling one-sided, and is there chest pain or sudden shortness of breath?");
    }
  }

  return Array.from(questionBank).slice(0, 5);
}

export function generateFallbackResponse({
  messages,
  patientContext,
  matches,
  fallbackReason,
  providerLabel,
}: {
  messages: ChatTurn[];
  patientContext?: PatientContext;
  matches: KnowledgeDoc[];
  fallbackReason?: "not-configured" | "provider-failed";
  providerLabel?: string;
}) {
  const latestUserMessage = messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
  const combinedQuery = [latestUserMessage, patientContext?.symptoms, patientContext?.notes].filter(Boolean).join(" ");
  const redFlags = collectRedFlags(combinedQuery, patientContext);
  const topMatches = matches.slice(0, 3);
  const clarifyingQuestions = bestClarifyingQuestions(topMatches);
  const evidenceHighlights = topMatches.flatMap((doc) =>
    getRelevantSectionExcerpts(doc, combinedQuery, 2).map((excerpt) => `${doc.title}: ${excerpt}`),
  );
  const patientSnapshot = [
    typeof patientContext?.age === "number" ? `Age: ${patientContext.age}` : "",
    typeof patientContext?.gestationalAgeWeeks === "number" ? `Gestational age: ${patientContext.gestationalAgeWeeks} weeks` : "",
    patientContext?.trimester ? `Trimester: ${patientContext.trimester}` : "",
    patientContext?.duration ? `Duration: ${patientContext.duration}` : "",
    patientContext?.bloodPressure ? `Blood pressure: ${patientContext.bloodPressure}` : "",
    typeof patientContext?.temperatureC === "number" ? `Temperature: ${patientContext.temperatureC.toFixed(1)} C` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  const sections = [
    "# Medica support",
    patientSnapshot ? `🧾 Patient details: ${patientSnapshot}` : "🧾 Patient details: only a few details were provided.",
    "",
    "## 🚨 Safety check",
    redFlags.length
      ? `There are warning signs here: ${redFlags.join(", ")}. This means you should get urgent pregnancy care now rather than watch and wait at home.`
      : "I cannot diagnose the cause, but I do not see the strongest emergency pattern from the local knowledge base based on what you shared. If symptoms are getting worse or you feel something is seriously wrong, get urgent care anyway.",
    "",
    "## 🤔 What this could be",
    topMatches.length
      ? formatEmojiBulletList(
          "•",
          topMatches.map(
            (doc) =>
              `${doc.title}: ${doc.summary} Clues: ${doc.symptomPatterns.slice(0, 2).join("; ") || "a clinician would need to narrow this down."}`,
          ),
        )
      : "• I did not find one strong match, so a clinician should review the full story directly.",
    "",
    "## 🔎 Why these fit",
    evidenceHighlights.length
      ? formatEmojiBulletList("•", evidenceHighlights.slice(0, 4))
      : "• I did not find a short matching excerpt from the retrieved references.",
    "",
    "## ❓ Helpful questions or checks",
    clarifyingQuestions.length
      ? formatEmojiBulletList("•", clarifyingQuestions)
      : "• Helpful details include pregnancy stage, bleeding, fever, vomiting severity, blood pressure, rash details, and fetal movement.",
    "",
    formatEmojiBulletList(
      "•",
      topMatches.flatMap((doc) => doc.suggestedWorkup.slice(0, 2)).slice(0, 6).length
        ? topMatches.flatMap((doc) => doc.suggestedWorkup.slice(0, 2)).slice(0, 6)
        : ["A clinician may need vitals, focused exam, labs, urine testing, and pregnancy-safe imaging depending on the symptom pattern."],
    ),
    "",
    "## ✅ What to do now",
    redFlags.length
      ? formatEmojiBulletList("👉", [
          "Get urgent evaluation now instead of monitoring this at home.",
          "Bring your pregnancy week, medication list, allergies, and any blood pressure or temperature readings.",
          "If there is severe bleeding, fainting, chest pain, seizure, or major trouble breathing, use emergency services.",
        ])
      : formatEmojiBulletList("👉", [
          "Use this as support, not as a final diagnosis.",
          "Arrange prompt obstetric or clinical review if symptoms are ongoing, worsening, or unusual for your pregnancy stage.",
          "Share timing, vitals, rash photos if relevant, and any bleeding, itching, vomiting, urinary symptoms, or fetal movement changes.",
        ]),
    "",
    "## 💡 About this answer",
    fallbackReason === "provider-failed"
      ? `The app tried to use ${providerLabel || "the configured live provider"}, but that request failed, so this reply came from the local pregnancy knowledge base instead.`
      : "This reply came from the local pregnancy knowledge base because no live AI key is active right now.",
  ];

  return sections.join("\n");
}
