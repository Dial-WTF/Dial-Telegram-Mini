/**
 * API Route: List AI Models
 * GET /api/ai/list
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllModels } from '@/lib/ai-model-storage';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const models = getAllModels();

    return NextResponse.json({
      ok: true,
      result: models,
    });
  } catch (err: any) {
    console.error('[API] List error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to list models' },
      { status: 500 }
    );
  }
}
