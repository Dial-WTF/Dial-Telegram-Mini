/**
 * API Route: Serve AI setup script for curl | bash
 * GET /api/ai/setup/script
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const scriptPath = join(process.cwd(), 'SETUP_AI.sh');
    const content = await readFile(scriptPath, 'utf8');
    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/x-sh; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'script not found' }, { status: 404 });
  }
}
