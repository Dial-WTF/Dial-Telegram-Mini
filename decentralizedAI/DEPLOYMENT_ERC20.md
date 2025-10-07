# Glyph Network - ERC20 Deployment Guide

This guide covers deploying the Glyph Network with ERC20 token rewards and messaging bot interfaces.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Smart Contract Deployment](#smart-contract-deployment)
3. [Backend Configuration](#backend-configuration)
4. [Running the Gateway](#running-the-gateway)
5. [Running Compute Nodes](#running-compute-nodes)
6. [Setting Up Messaging Bots](#setting-up-messaging-bots)
7. [Reward Distribution](#reward-distribution)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

- **Python**: 3.10 or higher
- **Node.js**: 18.x or higher (for smart contract deployment)
- **GPU**: Optional (CUDA or Metal for faster inference)

### Network Access

Choose one of these blockchain networks:
- **Polygon** (Recommended - low fees ~$0.01)
- **Base** (Coinbase L2 - good UX)
- **Arbitrum** (Ethereum L2)
- **Ethereum Mainnet** (High fees)

### Accounts Needed

1. **Deployer Wallet**: To deploy the ERC20 contract (needs native tokens for gas)
2. **Minter Wallet**: To mint rewards (contract owner, needs native tokens)
3. **RPC Provider**: Alchemy, Infura, or QuickNode account (optional, can use public RPCs)

---

## Smart Contract Deployment

### Step 1: Install Contract Dependencies

```bash
cd Glyph/contracts
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```bash
# Your deployer private key (DO NOT commit this file!)
DEPLOYER_PRIVATE_KEY=0xyour_private_key_here

# Optional: Custom RPC URLs
POLYGON_RPC=https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY
BASE_RPC=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Optional: Block explorer API keys for verification
POLYGONSCAN_API_KEY=your_api_key
BASESCAN_API_KEY=your_api_key
```

### Step 3: Deploy Contract

**Deploy to Polygon Mumbai Testnet (recommended for testing):**
```bash
npm run deploy:mumbai
```

**Deploy to Polygon Mainnet:**
```bash
npm run deploy:polygon
```

**Deploy to Base Sepolia Testnet:**
```bash
npm run deploy:base-sepolia
```

**Deploy to Base Mainnet:**
```bash
npm run deploy:base
```

The deployment script will output:
```
GlyphToken deployed to: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1
Save this address in your .env file as GLYPH_TOKEN_ADDRESS
```

**IMPORTANT:** Save this contract address! You'll need it for backend configuration.

### Step 4: Verify Contract (Optional but Recommended)

The deployment script automatically attempts verification. If it fails:

```bash
npx hardhat verify --network mumbai 0xYOUR_CONTRACT_ADDRESS
```

---

## Backend Configuration

### Step 1: Install Python Dependencies

```bash
cd Glyph
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install core dependencies with Web3 support
pip install -e .

# Optional: Install bot support
pip install -e .[bots]

# Optional: Install all features
pip install -e .[all]
```

### Step 2: Configure Token Contract

```bash
# Set the deployed token contract address
glyph configure-token \
  --address 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1 \
  --network polygon \
  --rpc-url https://polygon-rpc.com
```

This saves the configuration to the ledger database (`glyph_ledger.sqlite`).

### Step 3: Set Environment Variables

Create a `.env` file in the Glyph directory:

```bash
# Minter private key (wallet that deployed the contract - has OWNER role)
GLYPH_MINTER_PRIVATE_KEY=0xyour_minter_private_key_here

# Telegram Bot (optional)
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
GLYPH_GATEWAY_URL=http://localhost:8080

# Signal Bot (optional)
SIGNAL_NUMBER=+1234567890
SIGNAL_API_URL=http://localhost:8080

# WhatsApp Bot (optional)
WHATSAPP_API_URL=http://localhost:3000
```

---

## Running the Gateway

The gateway coordinates inference requests and tracks contributions.

```bash
# Basic gateway (local only)
glyph gateway --host 0.0.0.0 --port 8080

# With persistent identity
glyph gateway \
  --host 0.0.0.0 \
  --port 8080 \
  --identity ~/.glyph/gateway.key

# With DHT replication (optional)
glyph gateway \
  --host 0.0.0.0 \
  --port 8080 \
  --identity ~/.glyph/gateway.key \
  --dht-peer /ip4/203.0.113.1/tcp/31337/p2p/XXXX
```

The gateway will start and be accessible at `http://localhost:8080`.

### Gateway API Endpoints

- `POST /inference` - Run AI inference
- `POST /set_eth_address` - Register Ethereum address for rewards
- `GET /nodes` - List registered compute nodes
- `POST /epoch/settle` - Settle an epoch and calculate rewards
- `POST /mint/execute` - Mint ERC20 tokens for an epoch
- `GET /config/token` - Get token configuration
- `GET /token/supply` - Get current token supply

---

## Running Compute Nodes

Compute nodes run AI models and earn GLYPH tokens.

### Step 1: Download a Model

```bash
pip install huggingface_hub

python - << 'PY'
from huggingface_hub import snapshot_download
snapshot_download(
    'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
    local_dir='./DeepSeek-R1-Distill-Qwen-1.5B',
    local_dir_use_symlinks=False
)
PY
```

### Step 2: Start the Node

```bash
glyph node \
  --model ./DeepSeek-R1-Distill-Qwen-1.5B \
  --gateway http://127.0.0.1:8080 \
  --public-name "my-node" \
  --identity ~/.glyph/node.key \
  --host 0.0.0.0 \
  --port 8090
```

The node will automatically register with the gateway.

### Step 3: Register Ethereum Address

Each node needs an Ethereum address to receive rewards:

```bash
curl -X POST http://localhost:8080/set_eth_address \
  -H "Content-Type: application/json" \
  -d '{
    "node_pubkey": "your_node_pubkey_from_logs",
    "eth_address": "0xYourEthereumAddress"
  }'
```

Or use the messaging bot to register (see below).

---

## Setting Up Messaging Bots

### Telegram Bot

#### 1. Create Bot with BotFather

1. Open Telegram and search for `@BotFather`
2. Send `/newbot`
3. Follow prompts to get your bot token: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`

#### 2. Run the Bot

```bash
export TELEGRAM_BOT_TOKEN="your_bot_token_here"
export GLYPH_GATEWAY_URL="http://localhost:8080"

glyph bot-telegram
```

Or with arguments:
```bash
glyph bot-telegram \
  --token 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11 \
  --gateway http://localhost:8080
```

#### 3. Use the Bot

1. Find your bot on Telegram
2. Send `/start`
3. Register your address: `/register 0xYourEthereumAddress`
4. Start chatting!

---

### Signal Bot

#### Prerequisites

Signal bot requires `signal-cli-rest-api` running:

```bash
# Option 1: Docker (Recommended)
docker run -d \
  --name signal-api \
  -p 8080:8080 \
  -v signal-data:/home/.local/share/signal-cli \
  bbernhard/signal-cli-rest-api

# Link your Signal account (scan QR code)
# Visit http://localhost:8080/v1/qrcodelink?device_name=signal-api
```

#### Run the Bot

```bash
export SIGNAL_NUMBER="+1234567890"
export GLYPH_GATEWAY_URL="http://localhost:8080"
export SIGNAL_API_URL="http://localhost:8080"

glyph bot-signal
```

---

### WhatsApp Bot

#### Prerequisites

WhatsApp bot requires a whatsapp-web.js API wrapper.

**IMPORTANT:** Using unofficial WhatsApp APIs violates WhatsApp Terms of Service. For production, use official **WhatsApp Business API**.

```bash
# Clone a whatsapp-web.js REST API wrapper (example)
git clone https://github.com/chrishubert/whatsapp-web.js-rest.git
cd whatsapp-web.js-rest
npm install
npm start

# Scan QR code to authenticate
```

#### Run the Bot

```bash
export GLYPH_GATEWAY_URL="http://localhost:8080"
export WHATSAPP_API_URL="http://localhost:3000"

glyph bot-whatsapp
```

---

## Reward Distribution

### Epoch-Based Rewards

Glyph uses epochs to batch reward distributions and save on gas fees.

#### 1. Settle an Epoch

```bash
curl -X POST http://localhost:8080/epoch/settle \
  -H "Content-Type: application/json" \
  -d '{
    "token_ticker": "GLYPH",
    "total_amount": 1000000000000000000000,
    "start_time": 1704067200,
    "end_time": 1704153600
  }'
```

This creates an epoch snapshot with calculated payouts.

Response:
```json
{
  "epoch_id": "1704067200-1704153600-GLYPH",
  "payouts": [
    {"node_pubkey": "abc...", "eth_address": "0x123...", "amount": 500000000000000000000},
    {"node_pubkey": "def...", "eth_address": "0x456...", "amount": 500000000000000000000}
  ],
  "root": "0xabcdef...",
  "gateway_sig": "..."
}
```

#### 2. Preview Mint Transaction

```bash
curl -X POST http://localhost:8080/mint/preview \
  -H "Content-Type: application/json" \
  -d '{"epoch_id": "1704067200-1704153600-GLYPH"}'
```

#### 3. Execute Mint (Automated)

```bash
# Using the gateway API (requires GLYPH_MINTER_PRIVATE_KEY env var)
curl -X POST http://localhost:8080/mint/execute \
  -H "Content-Type: application/json" \
  -d '{
    "epoch_id": "1704067200-1704153600-GLYPH",
    "dry_run": false
  }'
```

Or use the CLI:

```bash
export GLYPH_MINTER_PRIVATE_KEY="0x..."

# Dry run (preview)
glyph minter --epoch-id "1704067200-1704153600-GLYPH" --dry-run

# Execute
glyph minter --epoch-id "1704067200-1704153600-GLYPH"
```

#### 4. Verify on Block Explorer

Check the transaction on:
- **Polygon**: https://polygonscan.com/tx/0xYOUR_TX_HASH
- **Base**: https://basescan.org/tx/0xYOUR_TX_HASH
- **Arbitrum**: https://arbiscan.io/tx/0xYOUR_TX_HASH

---

## Monitoring

### Check Token Supply

```bash
curl http://localhost:8080/token/supply
```

Response:
```json
{
  "total_supply": 5000000000000000000000,
  "total_supply_tokens": 5000.0,
  "max_supply": 21000000000000000000000000,
  "max_supply_tokens": 21000000.0,
  "remaining": 20999995000000000000000000,
  "remaining_tokens": 20999995000.0
}
```

### View Receipts

```bash
curl http://localhost:8080/receipts
```

### List Nodes

```bash
curl http://localhost:8080/nodes
```

---

## Troubleshooting

### Contract Deployment Issues

**Error: Insufficient funds**
- Ensure your deployer wallet has native tokens (MATIC, ETH, etc.) for gas

**Error: Nonce too low**
- Wait a few minutes and try again
- Clear transaction queue in MetaMask/wallet

### Minting Fails

**Error: "No private key configured"**
```bash
export GLYPH_MINTER_PRIVATE_KEY="0x..."
```

**Error: "Token contract address not configured"**
```bash
glyph configure-token --address 0xYOUR_CONTRACT_ADDRESS --network polygon
```

**Error: "Insufficient gas"**
- Increase gas limit in `reward_minter.py` (default: 300000 per recipient)
- Ensure minter wallet has native tokens

### Bot Connection Issues

**Telegram: "Unauthorized"**
- Check bot token is correct
- Regenerate token via @BotFather if needed

**Signal: "Connection refused"**
- Ensure signal-cli-rest-api is running: `docker ps`
- Check API URL is correct

**WhatsApp: "Not authenticated"**
- Scan QR code via whatsapp-web.js interface
- Session may expire - re-scan periodically

### Network Connection

**Error: "Failed to connect to blockchain network"**
- Check RPC URL is accessible
- Try a different RPC provider
- Verify network name matches (polygon, base, arbitrum, ethereum)

---

## Production Deployment

### Security Best Practices

1. **Private Keys**
   - Use environment variables, never commit to git
   - Consider AWS KMS, HashiCorp Vault, or hardware wallets
   - Separate deployer and minter keys

2. **Gateway**
   - Run behind reverse proxy (Nginx, Caddy) with TLS
   - Add authentication (API keys, JWT)
   - Rate limiting
   - Firewall rules

3. **Nodes**
   - Register with firewall-protected gateway
   - Monitor GPU/CPU usage
   - Auto-restart on failure (systemd, Docker)

4. **Bots**
   - Validate all user inputs
   - Rate limit per user
   - Log suspicious activity
   - For WhatsApp: migrate to official Business API

### Scaling

- **Multiple Gateways**: Use `/add_peer` to create gateway network
- **Load Balancing**: Nginx/HAProxy in front of gateways
- **Database**: Migrate from SQLite to PostgreSQL for high load
- **Batch Minting**: Automatically batch every N hours or M contributions

### Monitoring

```bash
# Gateway logs
tail -f gateway.log

# Node logs
tail -f node.log

# Check blockchain transaction status
curl https://api.polygonscan.com/api?module=transaction&action=gettxreceiptstatus&txhash=0xYOUR_TX
```

---

## Cost Estimation

### Gas Costs (Polygon)

- **Deploy Contract**: ~$0.05
- **Mint to 1 recipient**: ~$0.005
- **Mint to 10 recipients**: ~$0.02
- **Mint to 100 recipients**: ~$0.15

### Infrastructure (Monthly)

- **Gateway Server**: $5-20 (DigitalOcean, AWS t3.small)
- **Node Server with GPU**: $50-200 (RunPod, Vast.ai)
- **RPC Provider**: Free tier sufficient for small-medium scale
- **Bots**: Included in gateway server

---

## Support

For issues, questions, or contributions:
- GitHub Issues
- Documentation: See `README.md`
- Smart Contract: `contracts/GlyphToken.sol`
