import { NextRequest, NextResponse } from 'next/server';
import { nextToken } from '@/lib/ai-inference';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { modelId, prompt, temperature } = body || {};
    if (!modelId || typeof prompt !== 'string') {
      return NextResponse.json({ ok: false, error: 'invalid payload' }, { status: 400 });
    }
    const token = await nextToken(modelId, prompt, typeof temperature === 'number' ? temperature : 0.7);
    return NextResponse.json({ token });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 });
  }
}
