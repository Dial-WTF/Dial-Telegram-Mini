import { NextRequest, NextResponse } from 'next/server';
import { getReferralUserByCode } from '@/lib/referral-storage';
import { isValidReferralCode } from '@/lib/referral-utils';

export const runtime = 'nodejs';

/**
 * GET /api/referral/verify - Verify a referral code
 * Query params:
 *   - code: referral code to verify
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');

    if (!code) {
      return NextResponse.json(
        { ok: false, error: 'Missing referral code' },
        { status: 400 }
      );
    }

    // Validate format
    if (!isValidReferralCode(code)) {
      return NextResponse.json({
        ok: true,
        result: {
          valid: false,
          exists: false,
          message: 'Invalid referral code format',
        },
      });
    }

    // Check if code exists
    const user = getReferralUserByCode(code);

    if (!user) {
      return NextResponse.json({
        ok: true,
        result: {
          valid: true,
          exists: false,
          message: 'Referral code not found',
        },
      });
    }

    return NextResponse.json({
      ok: true,
      result: {
        valid: true,
        exists: true,
        referralCode: user.referralCode,
        walletAddress: user.walletAddress,
        isAffiliate: user.isAffiliate,
        message: 'Valid referral code',
      },
    });
  } catch (error: any) {
    console.error('Error verifying referral code:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to verify code' },
      { status: 500 }
    );
  }
}
