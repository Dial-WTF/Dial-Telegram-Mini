#!/usr/bin/env bash
set -euo pipefail

# Usage:
#  scripts/set-bot-commands.sh <BOT_TOKEN> [scope]
# scope: default to all_private_chats; valid: default, all_private_chats, all_group_chats

BOT_TOKEN=${1:-}
SCOPE=${2:-all_private_chats}

if [[ -z "$BOT_TOKEN" ]]; then
  echo "Usage: $0 <BOT_TOKEN> [scope]" >&2
  exit 1
fi

case "$SCOPE" in
  default|all_private_chats|all_group_chats) ;;
  *) echo "Invalid scope: $SCOPE" >&2; exit 1;;
esac

COMMANDS='[
  {"command":"start","description":"Start bot"},
  {"command":"invoice","description":"Create crypto invoice: /invoice <amount> <asset>"},
  {"command":"send","description":"Send crypto: /send <user> <amount> <asset>"},
  {"command":"check","description":"Create voucher: /check <amount> <asset>"},
  {"command":"balance","description":"View wallet balance"},
  {"command":"request","description":"Create payment request (legacy)"},
  {"command":"startparty","description":"Create a party room"},
  {"command":"listparty","description":"List open party rooms"},
  {"command":"findparty","description":"Search for party rooms by keyword"}
]'

DATA="{\"commands\":$COMMANDS,\"scope\":{\"type\":\"${SCOPE}\"}}"

echo "Setting commands on scope=$SCOPE ..."
curl -fsS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands" \
  -H 'Content-Type: application/json' -d "$DATA" | cat