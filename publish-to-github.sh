#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: ./publish-to-github.sh https://github.com/YOUR_USERNAME/medica.git"
  exit 1
fi

REPO_URL="$1"

echo "Publishing Medica to: $REPO_URL"

if ! command -v git >/dev/null 2>&1; then
  echo "git is not installed or not available in PATH."
  exit 1
fi

if [[ ! -d .git ]]; then
  git init
fi

git add .

if git diff --cached --quiet; then
  echo "No staged changes found. Continuing anyway."
else
  git commit -m "Initial commit"
fi

git branch -M main

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

git push -u origin main

echo
echo "Done. Your project is now connected to:"
echo "$REPO_URL"
