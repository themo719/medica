# Publish Medica To GitHub

Use this if you want to push the project manually and then connect it to Vercel.

## 1. Open Terminal in this folder

```bash
cd /Users/moniquetheisen/Documents/Codex/2026-04-18-build-an-ai-chat-webapp-specialized
```

## 2. If macOS blocks `git`, accept the Xcode license once

```bash
sudo xcodebuild -license
```

## 3. Run the publish script

Replace the URL with your own empty GitHub repo:

```bash
chmod +x ./publish-to-github.sh
./publish-to-github.sh https://github.com/YOUR_USERNAME/medica.git
```

## 4. Connect the repo to Vercel

In Vercel:

1. Create a new project
2. Import the `medica` GitHub repository
3. Add these environment variables before deploying:

```bash
AI_API_KEY=your_gemini_key
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL=gemini-2.5-flash
AI_PROVIDER_NAME=Google Gemini
APP_BASE_URL=https://your-project-domain.vercel.app
```

## Notes

- `.env.local` is already ignored and should not be committed.
- `.env.example` is the safe template to keep in the repo.
- If `origin` already exists, the script updates it to the new GitHub URL.
