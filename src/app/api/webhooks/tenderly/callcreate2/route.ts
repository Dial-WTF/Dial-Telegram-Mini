import { NextRequest, NextResponse } from 'next/server';
import { predictContextByAddress } from '#/lib/mem';
import { isAddress, Hex } from 'viem';
import { ethers } from 'ethers';

export const runtime = 'nodejs';

// Minimal CreateX ABI
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

    const { address } = await req.json();
    const target = typeof address === 'string' ? address.toLowerCase() : '';
    if (!target || !/^0x[0-9a-fA-F]{40}$/.test(target)) {
      return NextResponse.json({ ok: false, error: 'invalid address' }, { status: 400 });
    }

    const ctx = predictContextByAddress.get(target);
    if (!ctx) {
      return NextResponse.json({ ok: false, error: 'unknown address' }, { status: 404 });
    }

    const rpcUrl = process.env.RPC_URL as string;
    const pk = process.env.PRIVATE_KEY as string;
    if (!rpcUrl || !pk) {
      return NextResponse.json({ ok: false, error: 'missing RPC_URL/PRIVATE_KEY' }, { status: 500 });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const createx = new ethers.Contract(ctx.createx, CREATEX_ABI as any, wallet);

    const tx = await createx.deployCreate2(ctx.salt as Hex, ctx.initCode as Hex, { value: 0 });
    const receipt = await tx.wait();

    return NextResponse.json({ ok: true, txHash: tx.hash, receipt });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}


