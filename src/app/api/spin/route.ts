import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { validate } from '@telegram-apps/init-data-node';
import { appConfig } from '@/lib/config';

export const runtime = 'nodejs';

type Prize =
  | { kind: 'none'; label: 'Try again'; amount?: 0 }
  | { kind: 'minutes'; label: 'Minutes'; amount: number }
  | { kind: 'dial'; label: '$DIAL'; amount: number }
  | { kind: 'nft'; label: 'NFT'; amount: 1 }
  | { kind: 'free_spin'; label: 'Free Spin'; amount: 1 };

type WheelSlice = { label: string; kind: Prize['kind'] };

const wheel: WheelSlice[] = [
  { label: 'Try again', kind: 'none' },
  { label: '+1 min', kind: 'minutes' },
  { label: 'Try again', kind: 'none' },
  { label: 'Free spin', kind: 'free_spin' },
  { label: 'Try again', kind: 'none' },
  { label: '+5 $DIAL', kind: 'dial' },
  { label: 'Try again', kind: 'none' },
  { label: '+5 min', kind: 'minutes' },
  { label: 'Try again', kind: 'none' },
  { label: 'NFT', kind: 'nft' },
  { label: 'Try again', kind: 'none' },
  { label: '+10 min', kind: 'minutes' },
];

const weights: Record<Prize['kind'], number> = {
  none: 0.7,
  minutes: 0.2,
  free_spin: 0.08,
  dial: 0.019,
  nft: 0.001,
};

function rngFloat(seed: string): number {
  const h = crypto.createHmac('sha256', process.env.SPIN_SECRET || 'dev').update(seed).digest();
  // Use first 8 bytes for a uint64 then normalize
  const n = Number(BigInt('0x' + h.subarray(0, 8).toString('hex')));
  return (n % 10_000_000) / 10_000_000;
}

function pickPrize(r: number): Prize['kind'] {
  let acc = 0;
  for (const [k, w] of Object.entries(weights)) {
    acc += w as number;
    if (r <= acc) return k as Prize['kind'];
  }
  return 'none';
}

function todayKey(tgUserId: string | number): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  return `${tgUserId}:${ymd}`;
}

export async function POST(req: NextRequest) {
  try {
    const { initData } = await req.json();

    const allowBypass = appConfig.allowUnverifiedInitData;
    if (!allowBypass) {
      if (!initData || typeof initData !== 'string' || !initData.includes('hash=')) {
        return NextResponse.json({ error: 'Missing Telegram initData' }, { status: 401 });
      }
      validate(initData, appConfig.telegram.botToken!);
    }

    // Extract user id from initData if present
    let tgUserId = 'anonymous';
    try {
      const url = new URL('https://x/?' + initData);
      const userStr = url.searchParams.get('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        if (user?.id) tgUserId = String(user.id);
      }
    } catch {}

    const key = todayKey(tgUserId);
    const r = rngFloat(key);
    const kind = pickPrize(r);

    // Derive amount per kind deterministically from a second slice of entropy
    const r2 = rngFloat(key + ':amt');
    let prize: Prize;
    switch (kind) {
      case 'minutes':
        prize = { kind, label: 'Minutes', amount: [1, 3, 5, 10][Math.floor(r2 * 4)] };
        break;
      case 'dial':
        prize = { kind, label: '$DIAL', amount: [5, 10, 25][Math.floor(r2 * 3)] };
        break;
      case 'nft':
        prize = { kind, label: 'NFT', amount: 1 };
        break;
      case 'free_spin':
        prize = { kind, label: 'Free Spin', amount: 1 };
        break;
      default:
        prize = { kind: 'none', label: 'Try again', amount: 0 };
    }

    // Map prize kind to a wheel slice index (choose first matching slice deterministically)
    const indices = wheel.map((s, i) => ({ i, s })).filter(x => x.s.kind === prize.kind);
    const sliceIndex = indices.length ? indices[Math.floor(r2 * indices.length)].i : 0;

    // Next available spin at midnight UTC
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));

    return NextResponse.json({ ok: true, prize, sliceIndex, nextSpinAt: next.toISOString(), wheel });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 400 });
  }
}


