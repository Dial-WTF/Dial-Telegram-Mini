# Dial Pay Referral System

A complete multi-level referral system for the Dial Telegram Mini App, based on the smart contract architecture in `smartcontracts/evm/contracts/growth/`.

## 🌟 Features

- **Unique Referral Codes**: Automatically generated for each wallet (format: `DIAL-XXXXXX`)
- **Multi-Level Rewards**: Up to 5 levels of referral tracking
- **Tier System**: Bronze → Silver → Gold → Platinum → Diamond with bonus multipliers
- **Activity Tracking**: Automatic reward distribution for payments, subscriptions, and more
- **Leaderboard**: Competitive rankings of top referrers
- **Telegram Integration**: Bot commands for referral management
- **Smart Contract Compatible**: Designed to work with the on-chain referral system

## 📁 File Structure

```
src/
├── lib/
│   ├── referral-utils.ts          # Core utility functions
│   ├── referral-storage.ts        # In-memory storage (replace with DB)
│   ├── referral-integration.ts    # Integration helpers
│   └── hooks/
│       └── useReferral.ts         # React hook for referral functionality
│   └── bot/
│       └── referral-commands.ts   # Telegram bot command handlers
├── types/
│   └── referral.ts                # TypeScript types
├── app/
│   ├── api/
│   │   └── referral/
│   │       ├── route.ts           # Create/get referral codes
│   │       ├── list/route.ts      # List referrals
│   │       ├── leaderboard/route.ts # Get leaderboard
│   │       ├── activity/route.ts  # Track activities
│   │       └── verify/route.ts    # Verify codes
│   └── referrals/
│       └── page.tsx               # Referral dashboard page
└── components/
    ├── ReferralCard.tsx           # User stats & code display
    └── ReferralLeaderboard.tsx    # Top referrers
```

## 🚀 Quick Start

### 1. Navigate to Referrals Page

Users can access the referral program at `/referrals` or through the app navigation.

### 2. Automatic Registration

When a user connects their wallet, they automatically receive a unique referral code.

### 3. Share & Earn

Users share their referral link (`https://yourapp.com?ref=DIAL-XXXXXX`) and earn rewards when their referrals complete activities.

## 💰 Reward Structure

### Commission Rates by Level

- **Level 1 (Direct)**: 5%
- **Level 2**: 3%
- **Level 3**: 2%
- **Level 4**: 1%
- **Level 5**: 0.5%

### Tier System & Multipliers

| Tier | Referrals Required | Bonus Multiplier |
|------|-------------------|------------------|
| 🥉 Bronze | 0-9 | 1.0x |
| 🥈 Silver | 10-24 | 1.1x |
| 🥇 Gold | 25-49 | 1.2x |
| ⚪ Platinum | 50-99 | 1.3x |
| 💎 Diamond | 100+ | 1.5x |

### Tracked Activities

- `payment_completed`: 5% / 3% / 2% for levels 1-3
- `wallet_connected`: 1% for level 1
- `invoice_paid`: 4% / 2% for levels 1-2
- `subscription_purchased`: 10% / 5% / 2.5% for levels 1-3

## 🔌 Integration Guide

### Track Payment Completion

```typescript
import { trackPaymentCompleted } from '@/lib/referral-integration';

// After successful payment
await trackPaymentCompleted(
  walletAddress,
  amountInCents,
  {
    invoiceId: 'inv_123',
    currency: 'USDC',
    network: 'BASE'
  }
);
```

### Track Wallet Connection

```typescript
import { trackWalletConnected, getReferralCodeFromUrl } from '@/lib/referral-integration';

// When user connects wallet
const refCode = getReferralCodeFromUrl();
await trackWalletConnected(walletAddress, refCode);
```

### Use the React Hook

```typescript
import { useReferral } from '@/lib/hooks/useReferral';
import { usePrivy } from '@privy-io/react-auth';

function MyComponent() {
  const { user } = usePrivy();
  const {
    stats,
    referralCode,
    referralLink,
    trackActivity,
    shareReferral
  } = useReferral({
    walletAddress: user?.wallet?.address,
    autoRegister: true
  });

  // Track activity
  await trackActivity('payment_completed', 1000); // $10.00

  // Share
  await shareReferral();
}
```

## 🤖 Telegram Bot Integration

### Deep Links with Referral Codes

Users can share referral links that automatically open the mini app:

```
https://t.me/YourBot?start=ref_DIAL-ABC123
```

When users click this link and type `/start`, the bot detects the referral code and includes it in the mini app URL.

### Bot Commands (Optional)

You can add these commands to your bot for additional functionality:

- `/referral` or `/ref` - View referral stats and code
- `/myref` or `/mycode` - Get your referral code
- `/checkref <code>` - Verify a referral code

### Implementation Example

```typescript
import {
  handleReferralCommand,
  handleMyCodeCommand,
  handleCheckRefCommand,
  getReferralKeyboard
} from '@/lib/bot/referral-commands';

// In your bot route handler
if (text === '/referral') {
  const message = await handleReferralCommand(userId, walletAddress);
  const keyboard = getReferralKeyboard(baseUrl, referralCode);

  await tgCall('sendMessage', {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}
```

## 📊 API Endpoints

### POST /api/referral
Create/register a referral code for a wallet address.

**Request:**
```json
{
  "walletAddress": "0x...",
  "telegramUserId": 123456,
  "referredBy": "DIAL-ABC123"
}
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "referralCode": "DIAL-XYZ789",
    "referralLink": "https://yourapp.com?ref=DIAL-XYZ789",
    "walletAddress": "0x..."
  }
}
```

### GET /api/referral?wallet=0x...
Get referral stats for a wallet.

**Response:**
```json
{
  "ok": true,
  "result": {
    "walletAddress": "0x...",
    "referralCode": "DIAL-XYZ789",
    "totalReferrals": 15,
    "directReferrals": 10,
    "indirectReferrals": 5,
    "totalEarned": 5000,
    "totalPaid": 3000,
    "pendingRewards": 2000,
    "tier": "silver",
    "bonusMultiplier": 1.1
  }
}
```

### POST /api/referral/activity
Track a user activity and distribute rewards.

**Request:**
```json
{
  "walletAddress": "0x...",
  "activityType": "payment_completed",
  "amount": 10000,
  "metadata": {
    "invoiceId": "inv_123"
  }
}
```

### GET /api/referral/leaderboard?limit=10
Get top referrers.

### GET /api/referral/verify?code=DIAL-ABC123
Verify a referral code.

## 🔄 Smart Contract Integration

This system is designed to work alongside the smart contracts in `smartcontracts/evm/contracts/growth/`:

- **AffiliateTracker.sol**: Manages on-chain referral relationships
- **ReferralRewardsTracker.sol**: Handles multi-level reward distribution

### Syncing with Smart Contracts

To sync the off-chain system with on-chain data:

1. Listen to `AffiliateRegistered` events
2. Track `ReferralRewardDistributed` events
3. Update local storage accordingly
4. Process reward payouts on-chain

## 🗄️ Data Migration

The current implementation uses in-memory storage. For production:

### Replace with Database

```typescript
// Instead of Map
export const referralUsers = new Map<string, ReferralUser>();

// Use database
import { db } from '@/lib/db';

export async function getReferralUser(walletAddress: string) {
  return await db.referralUser.findUnique({
    where: { walletAddress: walletAddress.toLowerCase() }
  });
}
```

### Recommended Schema (Prisma example)

```prisma
model ReferralUser {
  id              String   @id @default(cuid())
  walletAddress   String   @unique
  telegramUserId  Int?
  referralCode    String   @unique
  referredBy      String?
  referrerAddress String?
  registeredAt    DateTime @default(now())
  isAffiliate     Boolean  @default(true)

  referrals       Referral[]  @relation("Referrer")
  referredAs      Referral?   @relation("Referred")
  rewards         ReferralReward[]
}

model Referral {
  id            String   @id @default(cuid())
  referrer      ReferralUser @relation("Referrer", fields: [referrerAddress], references: [walletAddress])
  referrerAddress String
  referred      ReferralUser @relation("Referred", fields: [referredAddress], references: [walletAddress])
  referredAddress String @unique
  referralCode  String
  registeredAt  DateTime @default(now())
  status        String   @default("active")
  telegramUserId Int?
}

model ReferralReward {
  id            String   @id @default(cuid())
  referrer      ReferralUser @relation(fields: [referrerAddress], references: [walletAddress])
  referrerAddress String
  referredAddress String
  activityType  String
  baseAmount    Int
  rewardAmount  Int
  level         Int
  status        String   @default("pending")
  createdAt     DateTime @default(now())
  paidAt        DateTime?
  txHash        String?
}
```

## 🧪 Testing

### Test the API

```bash
# Register a user
curl -X POST http://localhost:3000/api/referral \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "0x1234567890123456789012345678901234567890",
    "referredBy": "DIAL-ABC123"
  }'

# Get stats
curl "http://localhost:3000/api/referral?wallet=0x1234567890123456789012345678901234567890"

# Track activity
curl -X POST http://localhost:3000/api/referral/activity \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "0x1234567890123456789012345678901234567890",
    "activityType": "payment_completed",
    "amount": 10000
  }'

# Get leaderboard
curl "http://localhost:3000/api/referral/leaderboard?limit=10"
```

## 🔐 Security Considerations

1. **Circular Reference Prevention**: The system validates referral chains to prevent circular references
2. **Self-Referral Protection**: Users cannot refer themselves
3. **Code Validation**: Referral codes are validated for format and existence
4. **Rate Limiting**: Consider adding rate limits to API endpoints (not implemented)
5. **Wallet Verification**: Ensure wallet ownership before creating referral codes

## 📈 Future Enhancements

- [ ] Database integration (PostgreSQL, MongoDB, etc.)
- [ ] Smart contract event listeners for on-chain sync
- [ ] Automated reward payouts to wallets
- [ ] Email notifications for referral milestones
- [ ] Referral analytics dashboard
- [ ] Custom referral codes (allow users to choose)
- [ ] Referral contest & campaigns
- [ ] NFT badges for top referrers
- [ ] Social media sharing integrations

## 🤝 Support

For questions or issues with the referral system, please create an issue in the repository.

## 📄 License

Same as the main project license.
