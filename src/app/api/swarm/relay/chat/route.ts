import { NextRequest, NextResponse } from 'next/server';
import { chat } from '@/lib/ai-inference';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { modelId, messages, maxTokens, temperature } = body || {};
    if (!modelId || !Array.isArray(messages)) {
      return NextResponse.json({ ok: false, error: 'invalid payload' }, { status: 400 });
    }
    const result = await chat({ modelId, messages, maxTokens, temperature, stream: false });
    return NextResponse.json({ content: result.content });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 });
  }
}
