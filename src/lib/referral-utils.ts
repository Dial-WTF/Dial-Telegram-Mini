import { createHash, randomBytes } from 'crypto';

/**
 * Generate a unique referral code from a wallet address
 * Format: DIAL-XXXXXX (6 characters, alphanumeric)
 */
export function generateReferralCode(walletAddress: string): string {
  const hash = createHash('sha256')
    .update(walletAddress.toLowerCase())
    .digest('hex');

  // Take first 6 chars and convert to alphanumeric (no confusing chars like 0, O, I, l)
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';

  for (let i = 0; i < 6; i++) {
    const index = parseInt(hash.substring(i * 2, i * 2 + 2), 16) % chars.length;
    code += chars[index];
  }

  return `DIAL-${code}`;
}

/**
 * Generate a random shareable referral code (for users without wallet)
 * Format: DIAL-XXXXXX (6 random characters)
 */
export function generateRandomReferralCode(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  const bytes = randomBytes(6);

  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }

  return `DIAL-${code}`;
}

/**
 * Validate referral code format
 */
export function isValidReferralCode(code: string): boolean {
  const pattern = /^DIAL-[123456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
  return pattern.test(code);
}

/**
 * Generate shareable referral link
 */
export function generateReferralLink(code: string, baseUrl?: string): string {
  const base = baseUrl || process.env.PUBLIC_BASE_URL || '';
  return `${base}?ref=${code}`;
}

/**
 * Extract referral code from URL or string
 */
export function extractReferralCode(input: string): string | null {
  // Try to match DIAL-XXXXXX pattern
  const match = input.match(/DIAL-[123456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}/);
  return match ? match[0] : null;
}

/**
 * Calculate referral reward based on activity type
 * Returns amount in basis points (10000 = 100%)
 */
export function calculateReferralReward(
  baseAmount: number,
  activityType: string,
  referralLevel: number = 1
): number {
  // Default reward percentages (in basis points)
  const defaultRewards: Record<number, number> = {
    1: 500,  // 5% for direct referrals
    2: 300,  // 3% for level 2
    3: 200,  // 2% for level 3
    4: 100,  // 1% for level 4
    5: 50,   // 0.5% for level 5
  };

  // Custom rewards for specific activities
  const activityRewards: Record<string, Record<number, number>> = {
    'payment_completed': {
      1: 500,  // 5%
      2: 300,  // 3%
      3: 200,  // 2%
    },
    'wallet_connected': {
      1: 100,  // 1%
    },
    'invoice_paid': {
      1: 400,  // 4%
      2: 200,  // 2%
    },
    'subscription_purchased': {
      1: 1000, // 10%
      2: 500,  // 5%
      3: 250,  // 2.5%
    },
  };

  // Get reward percentage
  const rewardBps = activityRewards[activityType]?.[referralLevel]
    || defaultRewards[referralLevel]
    || 0;

  // Calculate reward amount
  return Math.floor((baseAmount * rewardBps) / 10000);
}

/**
 * Format referral stats for display
 */
export function formatReferralStats(stats: {
  totalReferrals: number;
  totalEarned: number;
  pendingRewards: number;
  level?: number;
}) {
  return {
    referrals: stats.totalReferrals.toLocaleString(),
    earned: `$${(stats.totalEarned / 100).toFixed(2)}`,
    pending: `$${(stats.pendingRewards / 100).toFixed(2)}`,
    level: stats.level || 1,
  };
}

/**
 * Get referral tier based on number of referrals
 */
export function getReferralTier(referralCount: number): {
  tier: string;
  name: string;
  bonusMultiplier: number;
} {
  if (referralCount >= 100) {
    return { tier: 'diamond', name: 'Diamond', bonusMultiplier: 1.5 };
  } else if (referralCount >= 50) {
    return { tier: 'platinum', name: 'Platinum', bonusMultiplier: 1.3 };
  } else if (referralCount >= 25) {
    return { tier: 'gold', name: 'Gold', bonusMultiplier: 1.2 };
  } else if (referralCount >= 10) {
    return { tier: 'silver', name: 'Silver', bonusMultiplier: 1.1 };
  } else {
    return { tier: 'bronze', name: 'Bronze', bonusMultiplier: 1.0 };
  }
}

/**
 * Validate referral chain to prevent circular references
 */
export function validateReferralChain(
  newUser: string,
  referrer: string,
  getReferrerFn: (address: string) => string | null,
  maxDepth: number = 100
): boolean {
  let current = referrer;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (current.toLowerCase() === newUser.toLowerCase()) {
      return false; // Circular reference detected
    }
    current = getReferrerFn(current) || '';
    depth++;
  }

  return true;
}
