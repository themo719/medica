# Medica

A Vercel-friendly Next.js web app for pregnancy-focused symptom support, differential guidance, and knowledge-grounded AI chat.

## What this app does

- Builds a modern clinical UI around pregnancy symptom intake.
- Grounds every answer in a local knowledge base first.
- Supports pregnancy-specific emergencies and dermatology patterns such as hyperemesis gravidarum, cholestasis, preeclampsia, ectopic pregnancy, PUPPP, and pemphigoid gestationis.
- Works even without a live AI key by falling back to a structured local-response mode.
- Automatically ingests additional reference material you place inside `training-data/`.

## Medical safety position

This project is designed as differential and triage support, not as a definitive diagnostic engine. The prompts, UI copy, and fallback mode all push users toward urgent care when high-risk pregnancy symptoms appear.

## Local run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the env template:

   ```bash
   cp .env.example .env.local
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000`

## AI provider configuration

### Fast local testing from the browser

The app includes a "Browser settings" panel for live model configuration during local testing.

- Paste an API key into the running app
- Optionally change base URL, provider name, and model
- The values are stored only in your local browser storage, not committed to the repo

### Option A: OpenAI API

Set `OPENAI_API_KEY` in `.env.local`.

Optional:

- `AI_MODEL=gpt-5-mini`

### Option B: Any OpenAI-compatible provider

Set:

- `AI_API_KEY`
- `AI_BASE_URL`
- `AI_MODEL`
- `AI_PROVIDER_NAME`

This lets you plug in OpenRouter, Groq, or another OpenAI-compatible endpoint later without changing app code.

## Important note about ChatGPT subscriptions

As of April 18, 2026, ChatGPT subscriptions and API billing are separate systems according to OpenAI's Help Center, so having ChatGPT Plus/Pro does not automatically mean this app can call the API with no extra setup.

Sources:

- https://help.openai.com/en/articles/9039756
- https://help.openai.com/en/articles/8156019

## Training data folder

Drop files into `training-data/` and they will be read on the server at runtime.

Supported file types:

- `.json`
- `.md`
- `.txt`
- `.csv`

### Recommended JSON shape

You can provide either a single document object or an array of documents with fields like:

```json
{
  "id": "pemphigoid-reference-1",
  "title": "Pemphigoid gestationis staging notes",
  "category": "Uploaded reference",
  "summary": "Short summary of the document",
  "keywords": ["pemphigoid gestationis", "DIF", "BP180"],
  "symptomPatterns": ["Periumbilical plaques", "Blisters"],
  "typicalTiming": ["Second trimester", "Third trimester"],
  "dangerSignals": ["Rapid blistering", "Secondary infection"],
  "differentiators": ["Umbilicus involved", "Blistering present"],
  "suggestedWorkup": ["Skin biopsy with direct immunofluorescence"],
  "carePath": ["Urgent dermatology/obstetric review"],
  "pregnancyImpact": ["Possible preterm birth association"],
  "citations": [
    {
      "title": "Source title",
      "url": "https://example.com/source",
      "publisher": "Publisher"
    }
  ],
  "content": "Any extra raw text you want searchable."
}
```

Markdown files can also use frontmatter with the same keys.

## Deploying later on Vercel

- Import the repo into Vercel.
- Add the same env vars there.
- Keep `training-data/` in your project or connect a storage/database ingestion layer later if the corpus grows large.

## Current seeded knowledge sources

- NHS
- NICHD / NIH
- GARD / NIH
- MedlinePlus / NIH
- ACOG
- NCBI Bookshelf
