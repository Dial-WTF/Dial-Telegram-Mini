# Glyph Network - Quick Start Guide

Get started with Glyph in 10 minutes!

## What is Glyph?

Glyph is a decentralized AI network that:
- ✅ Runs AI models across distributed compute nodes
- ✅ Rewards contributors with ERC20 tokens (GLYPH)
- ✅ Provides chat interfaces via Telegram, Signal, and WhatsApp
- ✅ Tracks contributions with cryptographic receipts

## Quick Demo (Local Testing)

### 1. Install Glyph

```bash
cd Glyph
python -m venv .venv
source .venv/bin/activate

pip install -e .
```

### 2. Start the Gateway

```bash
glyph gateway --host 0.0.0.0 --port 8080
```

Keep this terminal open. The gateway is now running at `http://localhost:8080`.

### 3. Start a Compute Node

Open a new terminal:

```bash
source .venv/bin/activate

# Download a small model (first time only, ~3GB)
pip install huggingface_hub
python -c "from huggingface_hub import snapshot_download; snapshot_download('deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', local_dir='./model', local_dir_use_symlinks=False)"

# Start the node
glyph node \
  --model ./model \
  --gateway http://127.0.0.1:8080 \
  --public-name "local-node"
```

### 4. Test Inference

```bash
glyph client \
  --gateway http://localhost:8080 \
  --prompt "Explain quantum computing in one sentence"
```

You should see an AI-generated response!

## Set Up a Messaging Bot (Optional)

### Telegram Bot (Easiest)

1. **Create a bot on Telegram:**
   - Open Telegram, search for `@BotFather`
   - Send `/newbot` and follow instructions
   - Copy your bot token

2. **Install bot dependencies:**
   ```bash
   pip install -e .[bots]
   ```

3. **Run the bot:**
   ```bash
   export TELEGRAM_BOT_TOKEN="your_token_here"
   glyph bot-telegram --gateway http://localhost:8080
   ```

4. **Chat with your bot on Telegram!**

## Deploy with ERC20 Rewards

For full production deployment with blockchain rewards:

### 1. Deploy Smart Contract

```bash
cd contracts
npm install
cp .env.example .env
# Edit .env with your private key

# Deploy to Polygon testnet
npm run deploy:mumbai
```

Save the contract address from the output.

### 2. Configure Token

```bash
cd ..
glyph configure-token \
  --address 0xYOUR_CONTRACT_ADDRESS \
  --network polygon
```

### 3. Register Your Address

```bash
curl -X POST http://localhost:8080/set_eth_address \
  -H "Content-Type: application/json" \
  -d '{
    "node_pubkey": "YOUR_NODE_PUBKEY",
    "eth_address": "0xYourEthereumAddress"
  }'
```

### 4. Run Inference & Earn Tokens!

Every time you contribute compute, you earn GLYPH tokens.

### 5. Distribute Rewards

```bash
# Set minter private key
export GLYPH_MINTER_PRIVATE_KEY="0x..."

# Settle an epoch
curl -X POST http://localhost:8080/epoch/settle \
  -H "Content-Type: application/json" \
  -d '{
    "token_ticker": "GLYPH",
    "total_amount": 1000000000000000000,
    "start_time": null,
    "end_time": null
  }'

# Mint tokens
glyph minter --epoch-id "EPOCH_ID_FROM_ABOVE"
```

## What's Next?

- 📖 **Full Documentation**: See `DEPLOYMENT_ERC20.md`
- 🤖 **Set up Signal/WhatsApp bots**: See bot sections in deployment guide
- 🏗️ **Production deployment**: Systemd services, Docker, Kubernetes
- 📊 **Monitor your network**: Gateway API endpoints
- 🔒 **Security hardening**: TLS, authentication, rate limiting

## Architecture Overview

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Telegram Bot │─────▶│   Gateway    │◀─────│ Compute Node │
│ Signal Bot   │      │  (FastAPI)   │      │  (AI Model)  │
│ WhatsApp Bot │      └──────┬───────┘      └──────────────┘
└──────────────┘             │
                             │
                    ┌────────▼────────┐
                    │  Ledger (DB)    │
                    │  Receipts       │
                    │  Addresses      │
                    │  Epochs         │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  ERC20 Minter   │
                    │  Web3.py        │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Blockchain     │
                    │  (Polygon/Base) │
                    │  GLYPH Token    │
                    └─────────────────┘
```

## CLI Commands Reference

```bash
# Gateway
glyph gateway [--host HOST] [--port PORT] [--identity PATH]

# Compute Node
glyph node --model PATH [--gateway URL] [--public-name NAME]

# Client
glyph client --gateway URL --prompt "Your prompt"

# Configure Token
glyph configure-token --address 0x... --network polygon

# Mint Rewards
glyph minter --epoch-id ID [--dry-run]

# Bots
glyph bot-telegram [--token TOKEN] [--gateway URL]
glyph bot-signal [--number +123...] [--gateway URL]
glyph bot-whatsapp [--gateway URL]
```

## Environment Variables

```bash
# Token minting
GLYPH_MINTER_PRIVATE_KEY=0x...

# Telegram bot
TELEGRAM_BOT_TOKEN=123456:ABC...
GLYPH_GATEWAY_URL=http://localhost:8080

# Signal bot
SIGNAL_NUMBER=+1234567890
SIGNAL_API_URL=http://localhost:8080

# WhatsApp bot
WHATSAPP_API_URL=http://localhost:3000
```

## Troubleshooting

**Gateway won't start:**
- Check if port 8080 is already in use: `lsof -i :8080`

**Node can't connect to gateway:**
- Verify gateway is running: `curl http://localhost:8080/health`
- Check firewall rules

**Model download fails:**
- Ensure you have enough disk space (~3GB)
- Try a different model mirror

**Bot won't respond:**
- Check bot token is correct
- Verify gateway URL is accessible
- Check bot logs for errors

**Minting fails:**
- Ensure GLYPH_MINTER_PRIVATE_KEY is set
- Verify wallet has native tokens (MATIC, ETH) for gas
- Check token contract is configured

## Community & Support

- **Documentation**: `README.md`, `DEPLOYMENT_ERC20.md`
- **Smart Contracts**: `contracts/GlyphToken.sol`
- **Issues**: GitHub Issues
- **Examples**: See deployment guide for full examples

---

Happy building! 🚀
