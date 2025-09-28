#!/usr/bin/env bash
set -euo pipefail

# Usage:
#  scripts/set-bot-webhook.sh <BOT_TOKEN> <PUBLIC_BASE_URL>
# Example:
#  scripts/set-bot-webhook.sh 123456:ABCDEF https://dial.ngrok.app

BOT_TOKEN=${1:-}
PUBLIC_BASE_URL=${2:-}

if [[ -z "$BOT_TOKEN" || -z "$PUBLIC_BASE_URL" ]]; then
  echo "Usage: $0 <BOT_TOKEN> <PUBLIC_BASE_URL>" >&2
  exit 1
fi

WEBHOOK_URL="${PUBLIC_BASE_URL%/}/api/bot"

echo "Setting webhook to $WEBHOOK_URL ..."
curl -fsS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=${WEBHOOK_URL}" -d "drop_pending_updates=true" | cat

sleep 1

echo
echo "Webhook info:"
curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | cat
