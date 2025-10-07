Glyph
=====

Glyph is a decentralized AI network that rewards compute contributors with ERC20 tokens (GLYPH) for serving, training, and fine-tuning open models. Access the network via Telegram, Signal, WhatsApp, or direct API.

## Features

- 🪙 **ERC20 Token Rewards**: GLYPH tokens on Polygon, Base, Arbitrum, or Ethereum
- 💬 **Multi-Platform Bots**: Telegram, Signal, and WhatsApp interfaces
- 🔐 **Cryptographic Receipts**: Tamper-evident, signed usage receipts (Ed25519)
- ⛓️ **Append-Only Chain**: Receipt chain with prev-hash and chain-hash integrity
- 🏛️ **Validator Quorum**: Epoch snapshots with multi-signature co-signing
- 🌐 **DHT Replication**: Optional Hivemind DHT for decentralized data sync
- 🔑 **Persistent Identities**: Secure node and gateway identity management
- ⚖️ **Load Balancing**: Round-robin scheduling across registered nodes

## Architecture

- **glyph-gateway**: Public API and scheduler. Tracks nodes, issues and verifies receipts, computes epoch snapshots, optional DHT publish, gossips receipts to peer gateways.
- **glyph-node**: Runs a model server on a single GPU/Metal. Generates text for prompts and countersigns receipts.
- **glyph-client**: Simple CLI to send prompts to a gateway.
- **Ledger (SQLite)**: Stores receipts, node payout addresses, epochs, validator set, quality reports.
- **DHT (optional)**: Publishes compact snapshots of receipts/epochs to a Hivemind DHT for discovery/replication.

Data flow (happy path): client → gateway → node → gateway → receipt signed by both → ledger → optional gossip/DHT publish.

## Requirements

- Python 3.10+
- PyTorch (CUDA, MPS, or CPU). Node moves model to CUDA if available, otherwise MPS on macOS, else CPU.
- For DHT replication: `hivemind` (optional extra).

## Quick Start

See **[QUICKSTART.md](QUICKSTART.md)** for a 10-minute getting started guide.

For full deployment with ERC20 rewards and bots, see **[DEPLOYMENT_ERC20.md](DEPLOYMENT_ERC20.md)**.

## Installation

```bash
python -m venv .venv
source .venv/bin/activate

# Install core dependencies
pip install -e .

# Optional: Install bot support (Telegram, Signal, WhatsApp)
pip install -e .[bots]

# Optional: Install all features (DHT + bots)
pip install -e .[all]
```

## Model setup (example)

```
pip install huggingface_hub
python - << 'PY'
from huggingface_hub import snapshot_download
snapshot_download('deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', local_dir='DeepSeek-R1-Distill-Qwen-1.5B', local_dir_use_symlinks=False)
PY
```

## Running locally (single gateway + one node)

1) Start gateway with a persistent identity (recommended):

```
python -m glyph gateway \
  --host 0.0.0.0 --port 8080 \
  --rune-ticker GLYPH \
  --identity ~/.glyph/gateway.key
```

2) Start a node and optionally auto-register to gateway:

```
python -m glyph node \
  --model ./DeepSeek-R1-Distill-Qwen-1.5B \
  --gateway http://127.0.0.1:8080 \
  --public-name my-node \
  --identity ~/.glyph/node.key
```

3) Generate from client:

```
python -m glyph client --gateway http://127.0.0.1:8080 --prompt "Explain quantum entanglement in simple terms."
```

## Optional: DHT replication

If you have access to Hivemind bootstrap peers, you can enable best-effort DHT publishing:

```
python -m glyph gateway --host 0.0.0.0 --port 8080 \
  --identity ~/.glyph/gateway.key \
  --dht-peer /ip4/203.0.113.1/tcp/31337/p2p/XXXX \
  --dht-peer /ip4/203.0.113.2/tcp/31337/p2p/YYYY

python -m glyph node --model ./DeepSeek-R1-Distill-Qwen-1.5B \
  --gateway http://127.0.0.1:8080 \
  --identity ~/.glyph/node.key \
  --dht-peer /ip4/203.0.113.1/tcp/31337/p2p/XXXX
```

To run a public or private DHT bootstrap, see `hivemind`'s `run_dht.py` or RuneNode's `run_dht.py`.

## Gateway API (HTTP)

- `POST /register` — register node with `{ public_name, node_url, node_pubkey }`
- `GET /nodes` — list seen nodes with BTC address flags
- `POST /inference` — run generation `{ prompt, max_new_tokens?, temperature? }`
- `GET /receipts` — list stored receipts
- `POST /set_eth_address` — set payout address `{ node_pubkey, eth_address }`
- `POST /config/token` — configure ERC20 token contract `{ token_address, network, rpc_url? }`
- `GET /config/token` — get token configuration
- `POST /mint/execute` — execute ERC20 reward minting `{ epoch_id, dry_run? }`
- `GET /token/supply` — get current token supply information
- `POST /epoch/settle` — compute payouts for an epoch `{ total_amount, start_time?, end_time?, rune_ticker? }`
- `POST /epoch/sign` — validators co-sign snapshot root `{ epoch_id, validator_pubkey, signature }`
- `GET /epoch/status/{epoch_id}` — snapshot + signatures + quorum
- `GET /pull/receipts?since=<ts>&limit=<n>` — pull receipts after timestamp
- `POST /validate/quality` — record quality score `{ receipt_id, node_pubkey, score }`
- `POST /add_peer` / `GET /peers` — manage gateway peer list (for HTTP gossip)
- `POST /gossip/receipts` — accept a list of signed receipts from peers
- `POST /validators/add` — add validator `{ pubkey, weight? }`
- `POST /validators/remove` — remove validator `{ pubkey }`
- `GET /config/rune` — get current rune config
- `POST /config/rune` — set rune config `{ rune_id, network }`
- `POST /mint/preview` — build mint PSBT spec for an epoch `{ epoch_id }`
- `POST /mint/anchor` — record broadcast txid for epoch `{ epoch_id, txid }`
- `POST /mint/propose_psbt` — propose a PSBT for decentralized minting `{ epoch_id, epoch_root, psbt_base64, proposer_pubkey }`
- `POST /mint/submit_signature` — submit partial signature for a proposal `{ proposal_id, signer_pubkey, signature }`
- `GET /mint/proposals` — list known mint proposals and their signature counts

Notes:
- Endpoints are unauthenticated for demo purposes; front with auth/TLS in production.
- Receipts are validated (both signatures) before being stored.

## Node API (HTTP)

- `POST /generate` — generate text
- `GET /health` — basic health and device info
- `POST /sign_receipt` — returns node signature for a given receipt payload

## Ledger details

- SQLite file: `glyph_ledger.sqlite` in the working directory
- Append-only chain columns: `prev_hash`, `payload_hash`, `chain_hash`
- Verify integrity:

```
python - << 'PY'
from glyph.ledger import Ledger
ok = Ledger().verify_chain()
print('chain OK' if ok else 'chain BROKEN')
PY
```

## Deployment guide (multi-node, optional DHT)

### Smart Contract Deployment

1. **Deploy GLYPH ERC20 token**:
   ```bash
   cd contracts
   npm install
   npm run deploy:polygon  # or deploy:base, deploy:arbitrum
   ```

2. **Configure backend**:
   ```bash
   glyph configure-token \
     --address 0xYOUR_CONTRACT_ADDRESS \
     --network polygon
   ```

### Gateway & Node Setup

- **Plan identities**: persist `--identity` files for gateways and nodes; back them up securely (0600 perms).
- **Bootstrap connectivity**:
  - Run or reuse Hivemind DHT bootstrap peers (optional) and pass `--dht-peer` to gateways/nodes.
  - Alternatively, skip DHT and use `POST /add_peer` between gateways to enable HTTP gossip.
- **Run gateways** behind TLS (e.g., Nginx/Caddy) and expose only the public API ports.
- **Run nodes** close to GPUs; pass `--gateway` so nodes auto-register.
- **Register payout addresses** via `POST /set_eth_address` for each node pubkey.

### Messaging Bots

```bash
# Telegram
glyph bot-telegram --token YOUR_BOT_TOKEN --gateway http://localhost:8080

# Signal (requires signal-cli-rest-api)
glyph bot-signal --number +1234567890 --gateway http://localhost:8080

# WhatsApp (requires whatsapp-web.js API)
glyph bot-whatsapp --gateway http://localhost:8080
```

### Reward Distribution

- **Epochs**: periodically call `POST /epoch/settle`, then collect validator signatures with `POST /epoch/sign`.
- **Minting**: execute via `POST /mint/execute` or use CLI:
  ```bash
  export GLYPH_MINTER_PRIVATE_KEY=0x...
  glyph minter --epoch-id "EPOCH_ID"
  ```

Example systemd (sketch):

```
[Unit]
Description=Glyph Gateway

[Service]
ExecStart=/path/to/venv/bin/python -m glyph gateway --host 0.0.0.0 --port 8080 --identity /srv/glyph/gateway.key --dht-peer /ip4/203.0.113.1/tcp/31337/p2p/XXXX
WorkingDirectory=/srv/glyph
Restart=always

[Install]
WantedBy=multi-user.target
```

## Security considerations

- Endpoints are unauthenticated in this prototype. Protect with TLS, mTLS/JWT, firewalls, and rate limits.
- Model loading uses `trust_remote_code=True` to support custom architectures. Use vetted repos or pin hashes and sandbox.
- DHT replication is best-effort, not consensus. Use validator quorums and external anchoring if stronger guarantees are needed.

## Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Get started in 10 minutes
- **[DEPLOYMENT_ERC20.md](DEPLOYMENT_ERC20.md)** - Full deployment guide with ERC20 and bots
- **[MIGRATION_SUMMARY.md](MIGRATION_SUMMARY.md)** - Summary of changes from Bitcoin Runes to ERC20
- **[.env.example](.env.example)** - Environment variable template

## Architecture

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
                    │  ETH Addresses  │
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
                    │  GLYPH Token    │
                    │  (Polygon/Base) │
                    └─────────────────┘
```

## Troubleshooting

- **Node fails to load model**: ensure the model directory exists or that internet access is available to fetch from HF Hub.
- **Slow generation**: ensure CUDA/MPS is detected; otherwise, the node runs on CPU.
- **No nodes available**: check that the node registered successfully (see gateway `/nodes`).
- **Minting fails**: ensure `GLYPH_MINTER_PRIVATE_KEY` is set and wallet has native tokens for gas.
- **Bot won't respond**: verify bot token/credentials and gateway URL accessibility.

## Contributing

Contributions are welcome! See the documentation files for architecture details and implementation patterns.

