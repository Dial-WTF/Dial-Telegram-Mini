#!/usr/bin/env bash
set -euo pipefail

# Sync .env file to Vercel envs for a target environment, then set Telegram webhook.
# Usage: scripts/sync-env-and-webhook.sh production [path-to-env-file]

ENV_TARGET=${1:-production}
ENV_FILE=${2:-.env.local}

if [[ "$ENV_TARGET" != "production" && "$ENV_TARGET" != "preview" && "$ENV_TARGET" != "development" ]]; then
  echo "Usage: $0 <production|preview|development> [env-file]" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

echo "Linking Vercel project (if needed)..."
vercel link --yes >/dev/null || true

echo "Syncing env vars from $ENV_FILE to Vercel ($ENV_TARGET)..."
while IFS='=' read -r KEY VAL || [[ -n "$KEY" ]]; do
  [[ -z "$KEY" || "$KEY" =~ ^# ]] && continue
  # Trim CR and export for later use (webhook)
  VAL=${VAL%$'\r'}
  if [[ -z "$VAL" ]]; then continue; fi
  # Try add; if exists, update
  if printf '%s' "$VAL" | vercel env add "$KEY" "$ENV_TARGET" >/dev/null 2>&1; then
    echo "  added  $KEY"
  elif printf '%s' "$VAL" | vercel env update "$KEY" "$ENV_TARGET" >/dev/null 2>&1; then
    echo "  updated $KEY"
  else
    echo "  failed  $KEY" >&2
  fi
done < "$ENV_FILE"

echo "Reading BOT_TOKEN and PUBLIC_BASE_URL from $ENV_FILE for webhook..."
BOT_TOKEN=$(grep -E '^BOT_TOKEN=' "$ENV_FILE" | sed 's/^BOT_TOKEN=//')
PUBLIC_BASE_URL=$(grep -E '^PUBLIC_BASE_URL=' "$ENV_FILE" | sed 's/^PUBLIC_BASE_URL=//')

if [[ -z "$BOT_TOKEN" || -z "$PUBLIC_BASE_URL" ]]; then
  echo "Missing BOT_TOKEN or PUBLIC_BASE_URL in $ENV_FILE; skipping webhook." >&2
  exit 0
fi

WEBHOOK_URL="${PUBLIC_BASE_URL%/}/api/bot"
echo "Setting Telegram webhook to $WEBHOOK_URL ..."
curl -fsS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=${WEBHOOK_URL}" -d "drop_pending_updates=true" >/dev/null

echo "Webhook info:"
curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | sed 's/.\{0\}//'

echo "Done."


