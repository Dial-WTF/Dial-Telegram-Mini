import { NextRequest, NextResponse } from 'next/server';
import { registerPeer } from '@/lib/swarm-registry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.peerId || !body?.publicUrl || !Array.isArray(body?.models)) {
      return NextResponse.json({ ok: false, error: 'invalid payload' }, { status: 400 });
    }
    registerPeer(body);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 });
  }
}
