/**
 * In-memory storage for referral system
 * Replace with database in production
 */

import {
  ReferralUser,
  Referral,
  ReferralReward,
  ReferralActivity,
  ReferralStats,
} from '@/types/referral';
import { getReferralTier } from './referral-utils';

// Storage maps
export const referralUsers = new Map<string, ReferralUser>(); // key: walletAddress
export const referralCodeToAddress = new Map<string, string>(); // key: referralCode, value: walletAddress
export const referrals = new Map<string, Referral>(); // key: referral.id
export const referralsByReferrer = new Map<string, string[]>(); // key: referrer address, value: referral ids
export const referralsByReferred = new Map<string, string>(); // key: referred address, value: referral id
export const rewards = new Map<string, ReferralReward>(); // key: reward.id
export const rewardsByReferrer = new Map<string, string[]>(); // key: referrer address, value: reward ids
export const activities = new Map<string, ReferralActivity>(); // key: activity.id

/**
 * Register a new referral user
 */
export function createReferralUser(user: ReferralUser): ReferralUser {
  referralUsers.set(user.walletAddress.toLowerCase(), user);
  referralCodeToAddress.set(user.referralCode, user.walletAddress.toLowerCase());
  return user;
}

/**
 * Get referral user by wallet address
 */
export function getReferralUser(walletAddress: string): ReferralUser | undefined {
  return referralUsers.get(walletAddress.toLowerCase());
}

/**
 * Get referral user by referral code
 */
export function getReferralUserByCode(code: string): ReferralUser | undefined {
  const address = referralCodeToAddress.get(code);
  return address ? referralUsers.get(address) : undefined;
}

/**
 * Create a new referral relationship
 */
export function createReferral(referral: Referral): Referral {
  referrals.set(referral.id, referral);

  // Update indexes
  const referrerLower = referral.referrer.toLowerCase();
  if (!referralsByReferrer.has(referrerLower)) {
    referralsByReferrer.set(referrerLower, []);
  }
  referralsByReferrer.get(referrerLower)!.push(referral.id);
  referralsByReferred.set(referral.referred.toLowerCase(), referral.id);

  return referral;
}

/**
 * Get all referrals by a referrer
 */
export function getReferralsByReferrer(referrerAddress: string): Referral[] {
  const ids = referralsByReferrer.get(referrerAddress.toLowerCase()) || [];
  return ids.map(id => referrals.get(id)!).filter(Boolean);
}

/**
 * Get referral for a referred user
 */
export function getReferralForUser(referredAddress: string): Referral | undefined {
  const id = referralsByReferred.get(referredAddress.toLowerCase());
  return id ? referrals.get(id) : undefined;
}

/**
 * Get referrer address for a user
 */
export function getReferrerAddress(userAddress: string): string | null {
  const user = getReferralUser(userAddress);
  return user?.referrerAddress || null;
}

/**
 * Create a new reward
 */
export function createReward(reward: ReferralReward): ReferralReward {
  rewards.set(reward.id, reward);

  // Update index
  const referrerLower = reward.referrer.toLowerCase();
  if (!rewardsByReferrer.has(referrerLower)) {
    rewardsByReferrer.set(referrerLower, []);
  }
  rewardsByReferrer.get(referrerLower)!.push(reward.id);

  return reward;
}

/**
 * Get all rewards for a referrer
 */
export function getRewardsByReferrer(referrerAddress: string): ReferralReward[] {
  const ids = rewardsByReferrer.get(referrerAddress.toLowerCase()) || [];
  return ids.map(id => rewards.get(id)!).filter(Boolean);
}

/**
 * Create a new activity
 */
export function createActivity(activity: ReferralActivity): ReferralActivity {
  activities.set(activity.id, activity);
  return activity;
}

/**
 * Get comprehensive stats for a referrer
 */
export function getReferralStats(walletAddress: string): ReferralStats | null {
  const user = getReferralUser(walletAddress);
  if (!user) return null;

  const userReferrals = getReferralsByReferrer(walletAddress);
  const userRewards = getRewardsByReferrer(walletAddress);

  // Calculate totals
  const totalEarned = userRewards.reduce((sum, r) => sum + r.rewardAmount, 0);
  const totalPaid = userRewards
    .filter(r => r.status === 'paid')
    .reduce((sum, r) => sum + r.rewardAmount, 0);
  const pendingRewards = totalEarned - totalPaid;

  // Count referrals by level
  const levelCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  userRewards.forEach(reward => {
    if (reward.level >= 1 && reward.level <= 5) {
      levelCounts[reward.level as keyof typeof levelCounts]++;
    }
  });

  // Count activities
  const activityCounts: Record<string, number> = {};
  userRewards.forEach(reward => {
    activityCounts[reward.activityType] = (activityCounts[reward.activityType] || 0) + 1;
  });

  // Get tier
  const tier = getReferralTier(userReferrals.length);

  return {
    walletAddress: user.walletAddress,
    referralCode: user.referralCode,
    totalReferrals: userReferrals.length,
    directReferrals: levelCounts[1],
    indirectReferrals: userReferrals.length - levelCounts[1],
    totalEarned,
    totalPaid,
    pendingRewards,
    tier: tier.tier,
    bonusMultiplier: tier.bonusMultiplier,
    activityCounts,
    level1Count: levelCounts[1],
    level2Count: levelCounts[2],
    level3Count: levelCounts[3],
    level4Count: levelCounts[4],
    level5Count: levelCounts[5],
  };
}

/**
 * Get leaderboard (top referrers)
 */
export function getLeaderboard(limit: number = 10): Array<{
  rank: number;
  walletAddress: string;
  referralCode: string;
  totalReferrals: number;
  totalEarned: number;
  tier: string;
}> {
  const allUsers = Array.from(referralUsers.values());

  const leaderboard = allUsers
    .map(user => {
      const stats = getReferralStats(user.walletAddress);
      if (!stats) return null;

      return {
        walletAddress: user.walletAddress,
        referralCode: user.referralCode,
        totalReferrals: stats.totalReferrals,
        totalEarned: stats.totalEarned,
        tier: stats.tier,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      // Sort by total earned, then by total referrals
      if (b!.totalEarned !== a!.totalEarned) {
        return b!.totalEarned - a!.totalEarned;
      }
      return b!.totalReferrals - a!.totalReferrals;
    })
    .slice(0, limit)
    .map((entry, index) => ({
      rank: index + 1,
      ...entry!,
    }));

  return leaderboard;
}

/**
 * Update reward status
 */
export function updateRewardStatus(
  rewardId: string,
  status: 'pending' | 'paid' | 'cancelled',
  txHash?: string
): boolean {
  const reward = rewards.get(rewardId);
  if (!reward) return false;

  reward.status = status;
  if (status === 'paid') {
    reward.paidAt = Date.now();
    reward.txHash = txHash;
  }

  rewards.set(rewardId, reward);
  return true;
}

/**
 * Get referral chain for a user (up to 5 levels)
 */
export function getReferralChain(walletAddress: string): string[] {
  const chain: string[] = [];
  let current = walletAddress.toLowerCase();
  let depth = 0;
  const maxDepth = 5;

  while (current && depth < maxDepth) {
    const referrer = getReferrerAddress(current);
    if (!referrer) break;

    chain.push(referrer);
    current = referrer.toLowerCase();
    depth++;
  }

  return chain;
}
