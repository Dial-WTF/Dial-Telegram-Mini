// Referral system types

export interface ReferralUser {
  walletAddress: string;
  telegramUserId?: number;
  referralCode: string;
  referredBy?: string; // referral code of the referrer
  referrerAddress?: string; // wallet address of the referrer
  registeredAt: number;
  isAffiliate: boolean;
}

export interface Referral {
  id: string;
  referrer: string; // wallet address
  referred: string; // wallet address
  referralCode: string;
  registeredAt: number;
  status: 'active' | 'rewarded' | 'expired';
  telegramUserId?: number;
}

export interface ReferralReward {
  id: string;
  referrer: string; // wallet address
  referred: string; // wallet address
  activityType: string; // e.g., "payment_completed", "wallet_connected"
  baseAmount: number; // amount in cents
  rewardAmount: number; // reward in cents
  level: number; // referral level (1 = direct, 2+ = indirect)
  status: 'pending' | 'paid' | 'cancelled';
  createdAt: number;
  paidAt?: number;
  txHash?: string; // blockchain transaction hash
}

export interface ReferralActivity {
  id: string;
  userId: string; // wallet address
  activityType: string;
  amount?: number;
  metadata?: Record<string, any>;
  timestamp: number;
}

export interface ReferralStats {
  walletAddress: string;
  referralCode: string;
  totalReferrals: number;
  directReferrals: number;
  indirectReferrals: number;
  totalEarned: number; // in cents
  totalPaid: number; // in cents
  pendingRewards: number; // in cents
  tier: string; // bronze, silver, gold, platinum, diamond
  bonusMultiplier: number;
  activityCounts: Record<string, number>;
  level1Count: number;
  level2Count: number;
  level3Count: number;
  level4Count: number;
  level5Count: number;
}

export interface CreateReferralRequest {
  walletAddress: string;
  telegramUserId?: number;
  referredBy?: string; // referral code
}

export interface RegisterAffiliateRequest {
  walletAddress: string;
  telegramUserId?: number;
  referrer?: string; // wallet address
}

export interface TrackActivityRequest {
  walletAddress: string;
  activityType: string;
  amount?: number;
  metadata?: Record<string, any>;
}

export interface ReferralLeaderboard {
  rank: number;
  walletAddress: string;
  referralCode: string;
  totalReferrals: number;
  totalEarned: number;
  tier: string;
}

export interface GetReferralsResponse {
  ok: boolean;
  result?: Referral[];
  total?: number;
  error?: string;
}

export interface GetStatsResponse {
  ok: boolean;
  result?: ReferralStats;
  error?: string;
}

export interface GetLeaderboardResponse {
  ok: boolean;
  result?: ReferralLeaderboard[];
  error?: string;
}

export interface CreateReferralResponse {
  ok: boolean;
  result?: {
    referralCode: string;
    referralLink: string;
    walletAddress: string;
  };
  error?: string;
}
