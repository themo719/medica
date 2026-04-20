# Medical AI Training Data — README
## Pregnancy & Maternal Medicine Diagnostic Assistant
## Compiled: April 2026 | Sources: NIH, ACOG, ADA, ATA, NICE, WHO, ASH

---

## WHAT IS THIS?

This folder contains structured, verified medical training data for an AI diagnostic chatbot specializing in pregnancy and maternal medicine. Every piece of information is sourced from:

- **NIH NCBI StatPearls** — peer-reviewed, continuously updated clinical articles
- **PubMed Central (PMC)** — open-access peer-reviewed research
- **ACOG** (American College of Obstetricians and Gynecologists)
- **ADA** (American Diabetes Association) Standards of Care 2025
- **ATA** (American Thyroid Association) 2017 Guidelines
- **NICE** (UK National Institute for Health and Care Excellence)
- **WHO** (World Health Organization)
- **ASH** (American Society of Hematology)
- **AAFP** (American Academy of Family Physicians)

**All free. All official. All verified.**

---

## FOLDER STRUCTURE

```
medical-training-data/
│
├── SYSTEM_PROMPT.md              ← Feed this to your AI as the system prompt
├── README.md                     ← This file
│
├── pregnancy_conditions/         ← Core clinical knowledge files
│   ├── 01_pemphigoid_gestationis.md        ← PG (rare autoimmune blistering)
│   ├── 02_dermatoses_overview.md           ← All 5 pregnancy dermatoses + comparison table
│   ├── 03_PUPPP_PEP.md                     ← Polymorphic Eruption / PUPPP
│   ├── 04_intrahepatic_cholestasis.md      ← ICP (liver disease of pregnancy)
│   ├── 05_preeclampsia_HELLP_eclampsia.md  ← Hypertensive disorders (full spectrum)
│   ├── 06_hyperemesis_gravidarum.md        ← HG (severe nausea/vomiting)
│   ├── 07_gestational_diabetes.md          ← GDM (screening, diagnosis, treatment)
│   ├── 08_obstetric_emergencies_placenta.md← Abruption, previa, preterm labor, PPROM
│   ├── 09_ectopic_and_miscarriage.md       ← Ectopic pregnancy + all miscarriage types
│   ├── 10_thyroid_disease_pregnancy.md     ← Hypo/hyperthyroidism, Graves', GTT, PPT
│   └── 11_anemia_VTE_pregnancy.md          ← Iron deficiency anemia + DVT/PE
│
├── lab_reference/
│   └── 01_lab_reference_values_pregnancy.md ← CBC, LFTs, renal, β-hCG, hormones
│
├── pharmacology/
│   └── 01_drug_safety_pregnancy.md         ← FDA categories, teratogens, safe meds
│
└── guidelines/                   ← (Placeholder for any additional downloaded PDFs/guidelines)
```

---

## HOW TO USE THIS WITH CODEX / YOUR AI APP

### Option A: Direct context injection (smaller models)
Feed each `.md` file as context to your AI. Start with `SYSTEM_PROMPT.md`, then append the condition files most relevant to the expected queries.

### Option B: Retrieval-Augmented Generation (RAG) — RECOMMENDED for production
1. Chunk each `.md` file into sections (split by `##` headers)
2. Embed each chunk using an embedding model (e.g., text-embedding-3-small)
3. Store in a vector database (e.g., Pinecone, Weaviate, Supabase pgvector)
4. At query time: retrieve top-k relevant chunks → inject as context
5. Use `SYSTEM_PROMPT.md` as the persistent system message

### Option C: Fine-tuning
Convert each `.md` file into Q&A pairs for fine-tuning a base model. The structured format (definitions, clinical features, diagnosis, treatment) makes this straightforward.

---

## CONTENT COVERAGE BY FILE

| File | Conditions Covered | Clinical Depth |
|---|---|---|
| 01_pemphigoid_gestationis | PG pathophysiology, DIF diagnosis, treatment ladder, fetal risks | ⭐⭐⭐⭐⭐ |
| 02_dermatoses_overview | All 5 pregnancy dermatoses, comparison table, DX approach | ⭐⭐⭐⭐⭐ |
| 03_PUPPP_PEP | PEP/PUPPP vs PG differential, histology, management | ⭐⭐⭐⭐ |
| 04_intrahepatic_cholestasis | ICP epidemiology, bile acid thresholds, UDCA, delivery timing | ⭐⭐⭐⭐⭐ |
| 05_preeclampsia_HELLP | Full spectrum from gestational HTN → HELLP, diagnostic criteria, treatment | ⭐⭐⭐⭐⭐ |
| 06_hyperemesis_gravidarum | HG Windsor definition, antiemetics, nutritional support, Wernicke risk | ⭐⭐⭐⭐⭐ |
| 07_gestational_diabetes | 1-step vs 2-step screening, insulin vs metformin, delivery timing | ⭐⭐⭐⭐⭐ |
| 08_obstetric_emergencies | Abruption, previa, PTL, PPROM — all diagnosis + management | ⭐⭐⭐⭐⭐ |
| 09_ectopic_and_miscarriage | β-hCG interpretation, all miscarriage types, MTX, surgery | ⭐⭐⭐⭐⭐ |
| 10_thyroid_disease | GTT vs Graves, PTU vs MMZ, PPT, TSH targets, fetal risks | ⭐⭐⭐⭐⭐ |
| 11_anemia_VTE | IDA treatment, VTE risk, LMWH, YEARS algorithm, imaging | ⭐⭐⭐⭐⭐ |
| lab_reference/01 | β-hCG ranges, CBC, LFTs, renal, coagulation in pregnancy | ⭐⭐⭐⭐⭐ |
| pharmacology/01 | FDA categories, 20+ teratogens, safe alternatives | ⭐⭐⭐⭐⭐ |

---

## WHAT TO ADD NEXT (SUGGESTED EXPANSIONS)

1. **Infections in Pregnancy:** GBS, UTI, listeria, toxoplasmosis, rubella, CMV, HSV, HIV, COVID-19
2. **Cardiac Disease in Pregnancy:** Peripartum cardiomyopathy, valvular disease
3. **Acute Fatty Liver of Pregnancy (AFLP):** Overlap with HELLP; diagnostic criteria
4. **Lupus (SLE) in Pregnancy:** Flares, neonatal lupus
5. **Antiphospholipid Syndrome (APS) in Pregnancy**
6. **Gestational Trophoblastic Disease:** Molar pregnancy, choriocarcinoma
7. **Group B Streptococcus (GBS) Screening and Prophylaxis**
8. **Postpartum Depression and Psychiatric Disorders in Pregnancy**
9. **Asthma in Pregnancy**
10. **Prenatal Screening:** First-trimester combined screening, NIPT, anatomy scan

---

## IMPORTANT NOTES FOR YOUR CODEX BUILD

1. **Always include the disclaimer** — The AI must never present itself as a replacement for a physician
2. **Red flag detection is critical** — Build logic to detect emergency symptoms (hemorrhage, seizures, hemodynamic instability) and prioritize emergency referral
3. **Trimester context matters** — Always collect gestational age before generating differentials; many conditions are trimester-specific
4. **Lab values need pregnancy context** — Standard lab ranges are wrong in pregnancy; the AI must use pregnancy-specific norms
5. **Differential diagnosis, not diagnosis** — The AI provides differentials and educational information, not a formal diagnosis
6. **Source attribution** — Ideally cite the underlying guideline/StatPearls article for key facts

---

## LICENSE / USAGE NOTE

All clinical content is sourced from:
- **StatPearls** (CC BY-NC-ND 4.0 license — free for non-commercial educational use)
- **PubMed Central open-access articles** (various open access licenses)
- **WHO/NICE/ACOG/ADA public guidance** (public domain / freely available)

This compiled dataset is intended for **educational and non-commercial AI development purposes**. For commercial deployment, verify licensing requirements with each source.

---

## CONTACT / COMPILATION CREDIT
Data compiled and structured by Claude (Anthropic) using verified public medical sources.
Compilation date: April 18, 2026.
