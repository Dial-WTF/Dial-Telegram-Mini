import { NextRequest, NextResponse } from 'next/server';
import { GetReferralsResponse } from '@/types/referral';
import { getReferralsByReferrer } from '@/lib/referral-storage';

export const runtime = 'nodejs';

/**
 * GET /api/referral/list - Get all referrals for a referrer
 * Query params:
 *   - wallet: wallet address
 *   - limit: max results (default: 100)
 *   - offset: pagination offset (default: 0)
 */
export async function GET(req: NextRequest): Promise<NextResponse<GetReferralsResponse>> {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = searchParams.get('wallet');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!wallet) {
      return NextResponse.json(
        { ok: false, error: 'Missing wallet address' },
        { status: 400 }
      );
    }

    const allReferrals = getReferralsByReferrer(wallet);

    // Apply pagination
    const paginated = allReferrals.slice(offset, offset + limit);

    return NextResponse.json({
      ok: true,
      result: paginated,
      total: allReferrals.length,
    });
  } catch (error: any) {
    console.error('Error fetching referrals:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to fetch referrals' },
      { status: 500 }
    );
  }
}
