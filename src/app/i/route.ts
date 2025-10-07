import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const base = req.nextUrl.origin || process.env.PUBLIC_BASE_URL || '';
  const target = `${base}/api/ai/setup/script`;
  return NextResponse.redirect(target, { status: 302 });
}
