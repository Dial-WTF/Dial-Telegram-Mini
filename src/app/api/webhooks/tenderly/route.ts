import { NextRequest, NextResponse } from 'next/server';
import { deployedCreate2Salts, predictContextByAddress } from '#/lib/mem';
import { ethers } from 'ethers';

export const runtime = 'nodejs';

const CREATEX_ABI = [
  {
    type: 'function',
    name: 'deployCreate2',
    stateMutability: 'payable',
    inputs: [
      { name: 'salt', type: 'bytes32' },
      { name: 'initCode', type: 'bytes' },
    ],
    outputs: [{ name: 'newContract', type: 'address' }],
  },
] as const;

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.WEBHOOK_SECRET || '';
    const auth = req.headers.get('x-webhook-secret') || '';
    if (!secret || auth !== secret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    const eventType: string = body?.type || body?.event?.type || '';
    const data = body?.data || body?.event?.data || body || {};

    // Accept both shapes: direct { address } or Tenderly-style { contract, requestId }
    const address: string | undefined = (data?.address || data?.contract || data?.to || '').toLowerCase();
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return NextResponse.json({ ok: false, error: 'invalid address' }, { status: 400 });
    }

    const ctx = predictContextByAddress.get(address);
    if (!ctx) {
      return NextResponse.json({ ok: false, error: 'unknown address' }, { status: 404 });
    }

    // Idempotency guard
    const saltKey = `${ctx.networkId}:${ctx.salt.toLowerCase()}`;
    if (deployedCreate2Salts.has(saltKey)) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'already_deployed' });
    }

    const pk = process.env.PRIVATE_KEY as string;
    const rpcUrl = process.env.RPC_URL as string;
    if (!pk || !rpcUrl) {
      return NextResponse.json({ ok: false, error: 'missing PRIVATE_KEY/RPC_URL' }, { status: 500 });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const createx = new ethers.Contract(ctx.createx, CREATEX_ABI as any, wallet);

    const gasOverrides: Record<string, any> = {};
    const tx = await createx.deployCreate2(ctx.salt, ctx.initCode, gasOverrides);
    const receipt = await tx.wait();

    deployedCreate2Salts.add(saltKey);
    return NextResponse.json({ ok: true, txHash: tx.hash, receipt });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}


