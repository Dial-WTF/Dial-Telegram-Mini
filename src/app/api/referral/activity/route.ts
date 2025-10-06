import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { TrackActivityRequest } from '@/types/referral';
import {
  getReferralUser,
  createActivity,
  createReward,
  getReferralChain,
} from '@/lib/referral-storage';
import { calculateReferralReward } from '@/lib/referral-utils';

export const runtime = 'nodejs';

/**
 * POST /api/referral/activity - Track user activity and distribute rewards
 * Body: TrackActivityRequest
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: TrackActivityRequest = await req.json();

    if (!body.walletAddress || !body.activityType) {
      return NextResponse.json(
        { ok: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const walletAddress = body.walletAddress.toLowerCase();

    // Check if user exists
    const user = getReferralUser(walletAddress);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'User not registered' },
        { status: 404 }
      );
    }

    // Create activity record
    const activity = createActivity({
      id: randomBytes(16).toString('hex'),
      userId: walletAddress,
      activityType: body.activityType,
      amount: body.amount,
      metadata: body.metadata,
      timestamp: Date.now(),
    });

    // Get referral chain (up to 5 levels)
    const referralChain = getReferralChain(walletAddress);

    if (referralChain.length === 0) {
      // No referrers, just return the activity
      return NextResponse.json({
        ok: true,
        result: {
          activity,
          rewardsDistributed: 0,
        },
      });
    }

    // Distribute rewards to referral chain
    const rewards = [];
    const baseAmount = body.amount || 0;

    for (let level = 1; level <= referralChain.length && level <= 5; level++) {
      const referrerAddress = referralChain[level - 1];
      const rewardAmount = calculateReferralReward(
        baseAmount,
        body.activityType,
        level
      );

      if (rewardAmount > 0) {
        const reward = createReward({
          id: randomBytes(16).toString('hex'),
          referrer: referrerAddress,
          referred: walletAddress,
          activityType: body.activityType,
          baseAmount,
          rewardAmount,
          level,
          status: 'pending',
          createdAt: Date.now(),
        });

        rewards.push(reward);
      }
    }

    return NextResponse.json({
      ok: true,
      result: {
        activity,
        rewardsDistributed: rewards.length,
        totalRewardAmount: rewards.reduce((sum, r) => sum + r.rewardAmount, 0),
        rewards,
      },
    });
  } catch (error: any) {
    console.error('Error tracking activity:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to track activity' },
      { status: 500 }
    );
  }
}
