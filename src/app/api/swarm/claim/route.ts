import { NextRequest, NextResponse } from 'next/server';
import { claimServe, releaseServe } from '@/lib/swarm-registry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const code = String(body?.code || '').toLowerCase();
    const peerId = String(body?.peerId || '');
    const ttlMs = typeof body?.ttlMs === 'number' ? body.ttlMs : 60000;
    if (!code || !peerId) {
      return NextResponse.json({ ok: false, error: 'code and peerId required' }, { status: 400 });
    }
    const res = claimServe(code, peerId, ttlMs);
    return NextResponse.json({ ok: true, ...res });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = String(searchParams.get('code') || '').toLowerCase();
    const peerId = String(searchParams.get('peerId') || '');
    if (!code || !peerId) {
      return NextResponse.json({ ok: false, error: 'code and peerId required' }, { status: 400 });
    }
    releaseServe(code, peerId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 });
  }
}
