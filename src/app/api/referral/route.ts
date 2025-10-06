import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import {
  CreateReferralRequest,
  CreateReferralResponse,
  GetStatsResponse,
  GetReferralsResponse,
} from '@/types/referral';
import {
  generateReferralCode,
  generateReferralLink,
  isValidReferralCode,
  validateReferralChain,
} from '@/lib/referral-utils';
import {
  createReferralUser,
  getReferralUser,
  getReferralUserByCode,
  createReferral,
  getReferralsByReferrer,
  getReferralStats,
  getReferrerAddress,
} from '@/lib/referral-storage';

export const runtime = 'nodejs';

/**
 * GET /api/referral - Get user's referral info and stats
 * Query params:
 *   - wallet: wallet address
 */
export async function GET(req: NextRequest): Promise<NextResponse<GetStatsResponse>> {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = searchParams.get('wallet');

    if (!wallet) {
      return NextResponse.json(
        { ok: false, error: 'Missing wallet address' },
        { status: 400 }
      );
    }

    const stats = getReferralStats(wallet);

    if (!stats) {
      return NextResponse.json(
        { ok: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      result: stats,
    });
  } catch (error: any) {
    console.error('Error fetching referral stats:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/referral - Create or register user's referral code
 * Body: CreateReferralRequest
 */
export async function POST(req: NextRequest): Promise<NextResponse<CreateReferralResponse>> {
  try {
    const body: CreateReferralRequest = await req.json();

    if (!body.walletAddress) {
      return NextResponse.json(
        { ok: false, error: 'Missing wallet address' },
        { status: 400 }
      );
    }

    const walletAddress = body.walletAddress.toLowerCase();

    // Check if user already exists
    let user = getReferralUser(walletAddress);

    if (user) {
      // User already exists, return their referral code
      const referralLink = generateReferralLink(user.referralCode);

      return NextResponse.json({
        ok: true,
        result: {
          referralCode: user.referralCode,
          referralLink,
          walletAddress: user.walletAddress,
        },
      });
    }

    // Generate referral code
    const referralCode = generateReferralCode(walletAddress);

    // Process referrer if provided
    let referrerAddress: string | undefined;
    let referredByCode: string | undefined;

    if (body.referredBy) {
      // Validate referral code
      if (!isValidReferralCode(body.referredBy)) {
        return NextResponse.json(
          { ok: false, error: 'Invalid referral code format' },
          { status: 400 }
        );
      }

      // Get referrer
      const referrer = getReferralUserByCode(body.referredBy);
      if (!referrer) {
        return NextResponse.json(
          { ok: false, error: 'Referral code not found' },
          { status: 404 }
        );
      }

      // Prevent self-referral
      if (referrer.walletAddress.toLowerCase() === walletAddress) {
        return NextResponse.json(
          { ok: false, error: 'Cannot refer yourself' },
          { status: 400 }
        );
      }

      // Validate referral chain (prevent circular references)
      const isValidChain = validateReferralChain(
        walletAddress,
        referrer.walletAddress,
        getReferrerAddress
      );

      if (!isValidChain) {
        return NextResponse.json(
          { ok: false, error: 'Circular referral detected' },
          { status: 400 }
        );
      }

      referrerAddress = referrer.walletAddress;
      referredByCode = body.referredBy;
    }

    // Create referral user
    user = createReferralUser({
      walletAddress,
      telegramUserId: body.telegramUserId,
      referralCode,
      referredBy: referredByCode,
      referrerAddress,
      registeredAt: Date.now(),
      isAffiliate: true,
    });

    // Create referral relationship if there's a referrer
    if (referrerAddress && referredByCode) {
      createReferral({
        id: randomBytes(16).toString('hex'),
        referrer: referrerAddress,
        referred: walletAddress,
        referralCode: referredByCode,
        registeredAt: Date.now(),
        status: 'active',
        telegramUserId: body.telegramUserId,
      });
    }

    // Generate referral link
    const referralLink = generateReferralLink(referralCode);

    return NextResponse.json({
      ok: true,
      result: {
        referralCode,
        referralLink,
        walletAddress,
      },
    });
  } catch (error: any) {
    console.error('Error creating referral:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to create referral' },
      { status: 500 }
    );
  }
}
