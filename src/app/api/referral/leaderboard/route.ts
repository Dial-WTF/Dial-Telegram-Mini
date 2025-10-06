import { NextRequest, NextResponse } from 'next/server';
import { GetLeaderboardResponse } from '@/types/referral';
import { getLeaderboard } from '@/lib/referral-storage';

export const runtime = 'nodejs';

/**
 * GET /api/referral/leaderboard - Get referral leaderboard
 * Query params:
 *   - limit: max results (default: 10)
 */
export async function GET(req: NextRequest): Promise<NextResponse<GetLeaderboardResponse>> {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '10');

    const leaderboard = getLeaderboard(limit);

    return NextResponse.json({
      ok: true,
      result: leaderboard,
    });
  } catch (error: any) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
