# Glyph Network - ERC20 Migration Summary

## Overview

This document summarizes the complete migration of Glyph Network from Bitcoin Runes to ERC20 token rewards, plus the addition of messaging bot interfaces (Telegram, Signal, WhatsApp).

## What Changed

### 1. Smart Contract (NEW)

**Location**: `contracts/`

- **GlyphToken.sol**: ERC20 token contract with:
  - 21 million token max supply
  - Batch minting for gas efficiency (up to 100 recipients per tx)
  - Pausable functionality
  - Owner-controlled minting
  - Event logging for transparency

- **Deployment infrastructure**:
  - Hardhat configuration for multiple networks
  - Deployment scripts
  - Verification support
  - Network configs (Polygon, Base, Arbitrum, Ethereum)

### 2. Backend Modifications

#### `ledger.py`
- ✅ Changed `btc_address` → `eth_address`
- ✅ Added Ethereum address validation
- ✅ Replaced `set_rune_id()` → `set_token_address()`
- ✅ Added `set_token_network()` for blockchain selection
- ✅ Added `set_rpc_url()` for custom RPC endpoints
- ✅ Updated database schema migration

#### `reward_minter.py`
- ✅ Complete rewrite using Web3.py
- ✅ Lazy initialization of Web3 connection
- ✅ Support for multiple networks (Polygon, Base, Arbitrum, Ethereum)
- ✅ Batch minting with automatic splitting for large payouts
- ✅ Gas estimation and dynamic gas pricing
- ✅ Transaction confirmation waiting
- ✅ Dry-run mode for testing
- ✅ Token supply tracking

#### `gateway.py`
- ✅ Updated `/set_btc_address` → `/set_eth_address`
- ✅ Updated `/config/rune` → `/config/token`
- ✅ Added `/mint/execute` for automated minting
- ✅ Added `/token/supply` endpoint
- ✅ Changed `rune_ticker` → `token_ticker` in epochs
- ✅ Updated error handling for ERC20 operations

#### `__main__.py`
- ✅ Added `configure-token` command
- ✅ Updated `minter` command for ERC20
- ✅ Added `bot-telegram` command
- ✅ Added `bot-signal` command
- ✅ Added `bot-whatsapp` command
- ✅ Improved CLI help text

### 3. Messaging Bots (NEW)

#### Telegram Bot (`bot_telegram.py`)
- Full Telegram integration via python-telegram-bot
- Commands: `/start`, `/help`, `/register`, `/stats`, `/balance`
- User session management
- Conversation context tracking
- Message splitting for long responses
- Error handling and user feedback

#### Signal Bot (`bot_signal.py`)
- Integration via signal-cli-rest-api
- Polling-based message retrieval
- Command parsing
- Multi-user support
- Session persistence

#### WhatsApp Bot (`bot_whatsapp.py`)
- Integration via whatsapp-web.js wrapper
- Message polling
- Command handling
- Chat management
- De-duplication of processed messages

### 4. Dependencies (`pyproject.toml`)

**Added**:
- `web3>=6.0.0` - Ethereum blockchain interaction
- `eth-account>=0.10.0` - Account/signing utilities
- `python-telegram-bot>=20.0` - Telegram bot framework

**New optional dependencies**:
- `[bots]` - Install bot dependencies
- `[all]` - Install everything

### 5. Documentation (NEW)

- **DEPLOYMENT_ERC20.md**: Comprehensive deployment guide
- **QUICKSTART.md**: 10-minute quick start guide
- **MIGRATION_SUMMARY.md**: This document
- **.env.example**: Environment variable template

## File Structure

```
Glyph/
├── contracts/                      # NEW: Smart contracts
│   ├── GlyphToken.sol             # ERC20 token contract
│   ├── hardhat.config.js          # Hardhat configuration
│   ├── package.json               # Node.js dependencies
│   ├── scripts/deploy.js          # Deployment script
│   └── .env.example               # Contract env template
│
├── src/glyph/
│   ├── __main__.py                # UPDATED: New CLI commands
│   ├── gateway.py                 # UPDATED: ERC20 endpoints
│   ├── ledger.py                  # UPDATED: ETH addresses
│   ├── reward_minter.py           # UPDATED: Web3 integration
│   ├── node.py                    # No changes
│   ├── client.py                  # No changes
│   ├── crypto.py                  # No changes
│   ├── receipt.py                 # No changes
│   ├── dht_sync.py                # No changes
│   ├── bot_telegram.py            # NEW: Telegram bot
│   ├── bot_signal.py              # NEW: Signal bot
│   └── bot_whatsapp.py            # NEW: WhatsApp bot
│
├── pyproject.toml                 # UPDATED: Dependencies
├── .env.example                   # NEW: Environment template
├── DEPLOYMENT_ERC20.md            # NEW: Deployment guide
├── QUICKSTART.md                  # NEW: Quick start
├── MIGRATION_SUMMARY.md           # NEW: This file
└── README.md                      # Update recommended

```

## API Changes

### Deprecated Endpoints

| Old Endpoint | New Endpoint | Notes |
|-------------|-------------|--------|
| `POST /set_btc_address` | `POST /set_eth_address` | Now validates Ethereum addresses |
| `GET /config/rune` | `GET /config/token` | Returns token config |
| `POST /config/rune` | `POST /config/token` | Sets token contract address |

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mint/execute` | POST | Execute reward minting for an epoch |
| `/token/supply` | GET | Get current and max token supply |

### Updated Request/Response Formats

**Epoch Settlement** (`POST /epoch/settle`):
```json
{
  "token_ticker": "GLYPH",  // was "rune_ticker"
  "total_amount": 1000000000000000000,
  "start_time": 1704067200,
  "end_time": 1704153600
}
```

**Node Registration** (`POST /set_eth_address`):
```json
{
  "node_pubkey": "abc123...",
  "eth_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"  // was "btc_address"
}
```

## Migration Checklist for Existing Deployments

If you have an existing Glyph deployment using Bitcoin Runes:

### Step 1: Backup Data
```bash
cp glyph_ledger.sqlite glyph_ledger.sqlite.backup
```

### Step 2: Update Code
```bash
git pull origin main
pip install -e .  # Installs web3 dependencies
```

### Step 3: Deploy Smart Contract
```bash
cd contracts
npm install
npm run deploy:polygon  # or your chosen network
```

### Step 4: Migrate Node Addresses

You'll need to ask node operators to provide Ethereum addresses:

```python
# Migration script example
from glyph.ledger import Ledger

ledger = Ledger()

# Old: ledger.set_node_address(pubkey, btc_address)
# New: ledger.set_node_address(pubkey, eth_address)

# Nodes must re-register with ETH addresses
```

### Step 5: Configure Token
```bash
glyph configure-token \
  --address 0xYOUR_DEPLOYED_CONTRACT \
  --network polygon
```

### Step 6: Test Minting
```bash
export GLYPH_MINTER_PRIVATE_KEY="0x..."
glyph minter --epoch-id "test" --dry-run
```

### Step 7: Update Documentation

Update any internal docs, user guides, or scripts that reference:
- Bitcoin addresses → Ethereum addresses
- Rune minting → ERC20 minting
- `btc_address` → `eth_address`

## Network Comparison

| Network | Gas Cost (100 recipients) | Confirmation Time | Recommendation |
|---------|---------------------------|-------------------|----------------|
| Polygon | ~$0.15 | 2-3 seconds | ⭐ Best for high frequency |
| Base | ~$0.50 | 2-3 seconds | Good for user-facing apps |
| Arbitrum | ~$0.30 | 2-3 seconds | Good balance |
| Ethereum | ~$15-50 | 15-30 seconds | Not recommended |

## Bot Comparison

| Platform | Setup Difficulty | Official API | Cost | Notes |
|----------|-----------------|--------------|------|-------|
| **Telegram** | ⭐ Easy | ✅ Yes | Free | Recommended, best UX |
| **Signal** | ⭐⭐ Medium | ❌ No | Free | Requires signal-cli wrapper |
| **WhatsApp** | ⭐⭐⭐ Hard | ⚠️ Unofficial | Free | Against ToS, use Business API in prod |

## Testing Strategy

### Unit Tests (Recommended to Add)

```python
# test_reward_minter.py
def test_mint_rewards_dry_run():
    minter = RewardMinter()
    result = minter.mint_rewards("test-epoch", dry_run=True)
    assert "DRY_RUN" in result

# test_ledger.py
def test_eth_address_validation():
    ledger = Ledger()
    with pytest.raises(ValueError):
        ledger.set_node_address("pubkey", "invalid_address")
```

### Integration Tests

1. Deploy contract to testnet
2. Configure Glyph with testnet contract
3. Run inference
4. Settle epoch
5. Execute mint (dry run)
6. Verify on block explorer

### Bot Testing

1. Create test bot accounts
2. Send test messages
3. Verify responses
4. Test command parsing
5. Test error handling

## Performance Optimizations

### Gas Optimization
- Use batch minting (saves ~50% gas vs individual mints)
- Aggregate epochs (mint once per day vs per hour)
- Monitor gas prices, mint during low-traffic periods

### Bot Optimization
- Cache user sessions (Redis recommended)
- Use connection pooling for HTTP clients
- Implement rate limiting per user
- Queue long-running inference requests

### Database Optimization
- Add indexes on frequently queried columns:
  ```sql
  CREATE INDEX idx_receipts_node ON receipts(node_pubkey);
  CREATE INDEX idx_receipts_created ON receipts(created_at);
  ```
- Consider PostgreSQL for production (>10k receipts/day)

## Security Considerations

### Critical Secrets

1. **GLYPH_MINTER_PRIVATE_KEY**
   - Wallet that can mint unlimited tokens
   - Use hardware wallet or KMS in production
   - Never log or expose

2. **DEPLOYER_PRIVATE_KEY**
   - Can upgrade/pause contract
   - Keep offline after deployment

3. **Bot Tokens**
   - Rotate periodically
   - Use separate bots for dev/prod

### Access Control

- Gateway: Add authentication middleware
- API: Rate limiting, CORS headers
- Nodes: Whitelist allowed gateways
- Database: File permissions 0600

### Monitoring

```bash
# Watch for suspicious activity
tail -f gateway.log | grep "402\|500\|register"

# Monitor token supply
watch -n 60 'curl -s http://localhost:8080/token/supply | jq'

# Check pending transactions
# (Add to your monitoring dashboard)
```

## Rollback Plan

If you need to rollback to Bitcoin Runes:

1. Stop all services
2. Restore database backup: `cp glyph_ledger.sqlite.backup glyph_ledger.sqlite`
3. Checkout previous git commit
4. Restart services
5. Nodes re-register with Bitcoin addresses

**Note**: Any epochs settled on ERC20 cannot be reverted.

## Future Enhancements

### Planned Features

- [ ] Multi-signature minting for security
- [ ] Automated epoch settlement (cron job)
- [ ] Token staking for priority access
- [ ] Cross-chain bridge (Polygon ↔ Ethereum)
- [ ] Enhanced bot analytics dashboard
- [ ] Mobile app integration

### Community Requests

- [ ] Discord bot support
- [ ] Slack integration
- [ ] Web3 wallet connection (MetaMask)
- [ ] NFT-based node identities
- [ ] DAO governance for epoch parameters

## Support & Resources

- **Smart Contract**: Audited by [TODO]
- **Token Address**: [Set after deployment]
- **Block Explorer**: [Network-specific]
- **Documentation**: See all `.md` files in root
- **Community**: [Discord/Telegram link]

## Changelog

### Version 0.2.0 (Current)
- ✅ Migrated from Bitcoin Runes to ERC20
- ✅ Added Telegram bot
- ✅ Added Signal bot
- ✅ Added WhatsApp bot
- ✅ Updated all APIs
- ✅ Comprehensive documentation

### Version 0.1.0 (Previous)
- Bitcoin Runes rewards
- Basic gateway/node architecture
- Cryptographic receipts
- DHT replication

---

**Migration completed successfully!** 🎉

For questions or issues, please open a GitHub issue or contact the development team.
