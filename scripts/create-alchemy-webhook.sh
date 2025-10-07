#!/usr/bin/env bash
set -euo pipefail

# Create a single Alchemy Address Activity webhook and optionally save its ID to .env.local
# Usage:
#   scripts/create-alchemy-webhook.sh [ETH_MAINNET|BASE_MAINNET|...] [address1 address2 ...]
#
# Requires env (either one):
#   ALCHEMY_WEBHOOK_AUTH_ACCESS_KEY - Alchemy Webhooks/Notify auth token (preferred)
#   ALCHEMY_API_KEY                 - fallback token if the above is not set
#   PUBLIC_BASE_URL     - your public domain (e.g. https://dial.ngrok.app)
# Optional env:
#   ALCHEMY_NETWORK     - defaults to ETH_MAINNET if not provided
#   WEBHOOK_SECRET      - if set, will be required by our /api/webhooks/alchemy handler
#   ENV_FILE            - file to write ALCHEMY_WEBHOOK_ID into (defaults to .env.local)

# Auto-load env from project .env.local/.env when run via pnpm scripts
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
load_env_file() {
  local file="$1"
  while IFS= read -r line || [[ -n "$line" ]]; do
    # skip blanks and comments
    [[ -z "$line" || "$line" =~ ^\s*# ]] && continue
    # strip leading 'export '
    line="${line#export }"
    # only accept KEY=VALUE
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "$line"
    fi
  done < "$file"
}
for f in "$ROOT_DIR/.env.local" "$ROOT_DIR/.env"; do
  if [[ -f "$f" ]]; then
    load_env_file "$f"
  fi
done

ALC_KEY=${ALCHEMY_WEBHOOK_AUTH_ACCESS_KEY:-${ALCHEMY_API_KEY:-}}
if [[ -z "${ALC_KEY}" ]]; then
  echo "[ERR] Missing ALCHEMY_WEBHOOK_AUTH_ACCESS_KEY (or ALCHEMY_API_KEY)" >&2
  exit 1
fi

BASE_URL=${PUBLIC_BASE_URL:-}
if [[ -z "${BASE_URL}" ]]; then
  echo "[ERR] Missing PUBLIC_BASE_URL" >&2
  exit 1
fi

NETWORK_ARG=${1:-}
NETWORK=${ALCHEMY_NETWORK:-${NETWORK_ARG:-ETH_MAINNET}}

shift || true
ADDRESSES=("$@")

WEBHOOK_URL="${BASE_URL%/}/api/webhooks/alchemy"

echo "[i] Creating Alchemy webhook"
echo "    network      = ${NETWORK}"
echo "    webhook_url  = ${WEBHOOK_URL}"
if [[ ${#ADDRESSES[@]} -gt 0 ]]; then
  echo "    addresses    = ${ADDRESSES[*]}"
fi

# Build JSON payload
ADDR_JSON=$(printf '"%s",' "${ADDRESSES[@]}" | sed 's/,$//')
PAYLOAD=$(cat <<JSON
{
  "network": "${NETWORK}",
  "webhook_type": "ADDRESS_ACTIVITY",
  "webhook_url": "${WEBHOOK_URL}",
  "addresses": [${ADDR_JSON}]
}
JSON
)

RESP=$(curl -sS -X POST \
  -H "X-Alchemy-Token: ${ALC_KEY}" \
  -H "Content-Type: application/json" \
  --data "${PAYLOAD}" \
  https://dashboard.alchemy.com/api/create-webhook)

echo "[i] Response: ${RESP}"

# Extract id with jq if available, else try a sed fallback
WEBHOOK_ID=""
if command -v jq >/dev/null 2>&1; then
  WEBHOOK_ID=$(echo "${RESP}" | jq -r '.data.id // .id // empty')
else
  WEBHOOK_ID=$(echo "${RESP}" | sed -n 's/.*"id"\s*:\s*"\([^"]\+\)".*/\1/p' | head -n1)
fi

if [[ -n "${WEBHOOK_ID}" ]]; then
  echo "[i] Created webhook id: ${WEBHOOK_ID}"
  ENV_FILE_PATH=${ENV_FILE:-.env.local}
  if [[ -f "${ENV_FILE_PATH}" ]]; then
    if grep -q '^ALCHEMY_WEBHOOK_ID=' "${ENV_FILE_PATH}"; then
      echo "[i] ALCHEMY_WEBHOOK_ID already present in ${ENV_FILE_PATH}, not modifying."
    else
      echo "ALCHEMY_WEBHOOK_ID=${WEBHOOK_ID}" >> "${ENV_FILE_PATH}"
      echo "[i] Wrote ALCHEMY_WEBHOOK_ID to ${ENV_FILE_PATH}"
    fi
  else
    echo "ALCHEMY_WEBHOOK_ID=${WEBHOOK_ID}" > "${ENV_FILE_PATH}"
    echo "[i] Created ${ENV_FILE_PATH} with ALCHEMY_WEBHOOK_ID"
  fi
else
  echo "[warn] Could not parse webhook id from response." >&2
fi

echo "[done]"


