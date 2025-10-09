import { NextRequest, NextResponse } from 'next/server';
import { listAggregated } from '@/lib/swarm-client';
import { remoteNextToken } from '@/lib/swarm-client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const code = String(body?.code || '').toLowerCase();
    const prompt = String(body?.prompt || '');
    const maxTokens = Math.max(1, Math.min(2048, Number(body?.maxTokens || 256)));
    const temperature = typeof body?.temperature === 'number' ? body.temperature : 0.7;

    if (!prompt) return NextResponse.json({ ok: false, error: 'prompt required' }, { status: 400 });

    const selfBase = (process.env.PUBLIC_BASE_URL || req.nextUrl.origin).replace(/\/$/, '');
    const aggregated = await listAggregated(selfBase).catch(() => [] as any[]);

    // pick entry by code if provided, else best available
    let entry: any | undefined = undefined;
    if (code) entry = aggregated.find((e: any) => String(e.code).toLowerCase() === code);
    if (!entry) entry = aggregated[0];
    if (!entry) return NextResponse.json({ ok: false, error: 'no peers available' }, { status: 503 });

    const examples: Array<{ publicUrl: string; modelId: string; capabilities?: string[]; status: string }> = (entry.examples || [])
      .filter((ex: any) => ex && ex.publicUrl && ex.modelId && ex.status === 'serving')
      .filter((ex: any) => Array.isArray(ex.capabilities) ? ex.capabilities.includes('next_token') : true);

    if (examples.length === 0) {
      return NextResponse.json({ ok: false, error: 'no next_token-capable peers for code' }, { status: 503 });
    }

    // round-robin across peers per token
    let out = '';
    let idx = 0;
    for (let t = 0; t < maxTokens; t++) {
      const ex = examples[idx % examples.length];
      idx++;
      try {
        const res = await remoteNextToken(ex.publicUrl, ex.modelId, prompt + out, temperature);
        const tok = (res?.token || '');
        if (!tok) break;
        out += tok;
      } catch {
        // skip failed peer for this round; try next
        continue;
      }
    }

    return NextResponse.json({ text: out });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 });
  }
}
