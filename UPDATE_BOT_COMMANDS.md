# Update Telegram Bot Commands

To update the bot commands in Telegram, run:

```bash
# Set your BOT_TOKEN environment variable first
export BOT_TOKEN="your_bot_token_here"

# Then run the script
./scripts/set-bot-commands.sh $BOT_TOKEN
```

Or manually via curl:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setMyCommands" \
  -H 'Content-Type: application/json' \
  -d '{
    "commands": [
      {"command":"start","description":"Start bot"},
      {"command":"invoice","description":"Create crypto invoice: /invoice <amount> <asset>"},
      {"command":"send","description":"Send crypto: /send <user> <amount> <asset>"},
      {"command":"check","description":"Create voucher: /check <amount> <asset>"},
      {"command":"balance","description":"View wallet balance"},
      {"command":"request","description":"Create payment request (legacy)"},
      {"command":"startparty","description":"Create a party room"},
      {"command":"listparty","description":"List open party rooms"},
      {"command":"findparty","description":"Search for party rooms by keyword"}
    ]
  }'
```

## New Commands Available

### Crypto Payments
- `/invoice <amount> <asset> [description]` - Create a crypto invoice
- `/send <user> <amount> <asset> [comment]` - Send crypto to a user
- `/check <amount> <asset> [pin_to_user]` - Create a crypto voucher/check
- `/balance` - View your wallet balance

### Party Lines
- `/startparty [wallet_address]` - Create a party room
- `/listparty` - List all open party rooms
- `/findparty <keyword>` - Search for party rooms by name, code, or address

### Supported Assets
USDT, USDC, ETH, BTC, TON, BNB, SOL, TRX, LTC

### Examples
```
/invoice 10 USDC Payment for service
/send @john 5 USDT Thanks for lunch!
/check 20 ETH @alice
/findparty music
```
