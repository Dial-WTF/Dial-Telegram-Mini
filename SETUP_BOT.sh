#!/usr/bin/env bash
set -euo pipefail

# Quick setup script to update Telegram bot commands
# Usage: ./SETUP_BOT.sh

echo "🤖 Updating Telegram Bot Commands..."
echo ""

# Check if BOT_TOKEN is set
if [ -z "${BOT_TOKEN:-}" ]; then
  echo "❌ BOT_TOKEN environment variable not set"
  echo ""
  echo "Please set your bot token:"
  echo "  export BOT_TOKEN='your_bot_token_here'"
  echo ""
  echo "Or run:"
  echo "  ./scripts/set-bot-commands.sh YOUR_BOT_TOKEN"
  exit 1
fi

# Update bot commands
./scripts/set-bot-commands.sh "$BOT_TOKEN"

echo ""
echo "✅ Bot commands updated successfully!"
echo ""
echo "📱 Available commands in Telegram:"
echo "  /invoice - Create crypto invoice"
echo "  /send - Send crypto to users"
echo "  /check - Create crypto voucher"
echo "  /balance - View wallet balance"
echo "  /startparty - Create party room"
echo "  /listparty - List party rooms"
echo "  /findparty - Search party rooms"
echo ""
echo "💎 Supported assets: USDT, USDC, ETH, BTC, TON, BNB, SOL"
