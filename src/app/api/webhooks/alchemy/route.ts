import { NextRequest, NextResponse } from 'next/server';
import { deployedCreate2Salts, predictContextByAddress, requestContextById, requestIdByPredictedAddress } from '#/lib/mem';
import { tg } from '#/lib/telegram';
import { s3 } from '#/services/s3/client';
import { ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { updateWebhookAddresses } from '#/lib/alchemyWebhooks';
import { PATH_INVOICES } from '#/services/s3/filepaths';
import { AWS_S3_BUCKET } from '#/config/constants';
import { ethers } from 'ethers';

export const runtime = 'nodejs';

const CREATEX_ABI = [
  { type: 'function', name: 'deployCreate2', stateMutability: 'payable', inputs: [
    { name: 'salt', type: 'bytes32' },
    { name: 'initCode', type: 'bytes' },
  ], outputs: [{ name: 'newContract', type: 'address' }] },
] as const;

export async function POST(req: NextRequest) {
  try {
    const DEBUG = process.env.DEBUG_BOT === '1';
    // Optional: verify Alchemy signature if configured later
    const secret = process.env.WEBHOOK_SECRET || '';
    const auth = req.headers.get('x-webhook-secret') || '';
    if (secret && auth !== secret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    if (DEBUG) {
      try {
        const sample = JSON.stringify(body).slice(0, 500);
        console.log('[WEBHOOK][Alchemy] body=', sample);
        console.log('[WEBHOOK][Alchemy] headers=', Object.fromEntries(req.headers));
      } catch {}
    }
    // Address Activity webhook: expect affected address in payload
    // See Alchemy docs for exact shape; we support a few common fields
    const addr = (body?.event?.activity?.[0]?.toAddress || body?.event?.activity?.[0]?.to || body?.address || body?.to || '').toLowerCase();
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      if (DEBUG) { try { console.warn('[WEBHOOK][Alchemy] invalid address in payload'); } catch {} }
      return NextResponse.json({ ok: false, reason: 'invalid_address' }, { status: 200 });
    }
    if (DEBUG) { try { console.log('[WEBHOOK][Alchemy] toAddress=', addr); } catch {} }

    let ctx = predictContextByAddress.get(addr);
    let invoiceRec: any | undefined;
    if (!ctx) {
      // Fallback to S3 lookup by filename invoices/invoice-<addr>-*
      try {
        const prefix = `${PATH_INVOICES}invoice-${addr}`;
        const listed = await s3.send(new ListObjectsV2Command({ Bucket: AWS_S3_BUCKET, Prefix: prefix }));
        const key = listed?.Contents?.[0]?.Key;
        if (key) {
          const obj = await s3.send(new GetObjectCommand({ Bucket: AWS_S3_BUCKET, Key: key }));
          const text = await (obj.Body as any).transformToString();
          const rec = JSON.parse(text || '{}');
          if (rec?.networkId && rec?.salt && rec?.initCode && rec?.predictedAddress && rec?.requestId) {
            ctx = { networkId: String(rec.networkId), createx: process.env.CREATEX_ADDRESS as `0x${string}`, salt: rec.salt, initCode: rec.initCode } as any;
            invoiceRec = rec;
            if (DEBUG) { try { console.log('[WEBHOOK][Alchemy] recovered ctx from S3:', { key, requestId: rec.requestId }); } catch {} }
            // Save by-request mapping for later (paid update)
            try { requestIdByPredictedAddress.set(addr, rec.requestId); } catch {}
          }
        }
      } catch (e) {
        if (DEBUG) { try { console.warn('[WEBHOOK][Alchemy] S3 lookup failed', (e as any)?.message || e); } catch {} }
      }
    }
    if (!ctx) {
      if (DEBUG) { try { console.warn('[WEBHOOK][Alchemy] unknown address (no context mapped):', addr); } catch {} }
      return NextResponse.json({ ok: false, reason: 'unknown_address_unmapped' }, { status: 200 });
    }

    const saltKey = `${ctx.networkId}:${ctx.salt.toLowerCase()}`;
    if (deployedCreate2Salts.has(saltKey)) {
      if (DEBUG) { try { console.log('[WEBHOOK][Alchemy] skipping deploy; salt already seen'); } catch {} }
      return NextResponse.json({ ok: true, skipped: true, reason: 'already_deployed' });
    }
    // Also check S3 for a deployment marker to avoid duplicate work across cold starts
    try {
      const markerKey = `${PATH_INVOICES}deploy/${saltKey}.json`;
      const markerList = await s3.send(new ListObjectsV2Command({ Bucket: AWS_S3_BUCKET, Prefix: markerKey }));
      if ((markerList?.Contents || []).length > 0) {
        if (DEBUG) { try { console.log('[WEBHOOK][Alchemy] skipping deploy; marker exists'); } catch {} }
        deployedCreate2Salts.add(saltKey);
        return NextResponse.json({ ok: true, skipped: true, reason: 'marker_exists' });
      }
      // Create inflight marker (best-effort) to avoid races
      try {
        await s3.send(new PutObjectCommand({ Bucket: AWS_S3_BUCKET, Key: markerKey, Body: Buffer.from(JSON.stringify({ inflight: true, at: new Date().toISOString() })), ContentType: 'application/json' }));
      } catch {}
    } catch {}

    const pk = process.env.PRIVATE_KEY as string;
    const rpcUrl = process.env.RPC_URL as string;
    if (!pk || !rpcUrl) {
      return NextResponse.json({ ok: false, error: 'missing PRIVATE_KEY/RPC_URL' }, { status: 500 });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(pk, provider);
    const createx = new ethers.Contract(ctx.createx, CREATEX_ABI as any, wallet);

    if (DEBUG) { try { console.log('[WEBHOOK][Alchemy] deployCreate2 input:', { createx: ctx.createx, salt: ctx.salt, initCodeLen: ctx.initCode?.length, networkId: ctx.networkId }); } catch {} }
    try {
      const tx = await createx.deployCreate2(ctx.salt, ctx.initCode);
      const receipt = await tx.wait();
      if (DEBUG) { try { console.log('[WEBHOOK][Alchemy] deployed txHash=', tx.hash); } catch {} }
      deployedCreate2Salts.add(saltKey);
      // Write deployment marker
      try {
        const markerKey = `${PATH_INVOICES}deploy/${saltKey}.json`;
        const payload = Buffer.from(JSON.stringify({ txHash: tx.hash, at: new Date().toISOString() }, null, 2));
        await s3.send(new PutObjectCommand({ Bucket: AWS_S3_BUCKET, Key: markerKey, Body: payload, ContentType: 'application/json' }));
      } catch {}
    } catch (deployErr: any) {
      if (DEBUG) { try { console.warn('[WEBHOOK][Alchemy] deploy error (skipping):', deployErr?.message || deployErr); } catch {} }
      return NextResponse.json({ ok: true, skipped: true, reason: 'deploy_failed' });
    }

    // Try to update the original message status to Pending (🟡)
    try {
      const reqId = requestIdByPredictedAddress.get(addr) || (body?.requestId || body?.event?.requestId || '').toString();
      const maybeCtx = reqId ? requestContextById.get(reqId) : undefined;
      if (maybeCtx?.chatId && maybeCtx?.messageId) {
        // Rebuild keyboard to ensure button changes
        const base = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const openUrl = `${base}/pay/${reqId}`;
        const scanUrl = `https://scan.request.network/request/${reqId}`;
        const kb = { inline_keyboard: [
          [{ text: 'Open invoice', url: openUrl }],
          [{ text: 'View on Request Scan', url: scanUrl }],
          [{ text: 'Status: 🟡 Pending', callback_data: 'sr' }],
        ] } as any;
        await tg.editReplyMarkup(maybeCtx.chatId, maybeCtx.messageId, kb);
        await tg.editCaption(maybeCtx.chatId, maybeCtx.messageId, 'Request: 🟡 Pending', kb);
      }
    } catch {}

    // If paid enough, remove address from webhook to reduce noise
    try {
      const acts: any[] = Array.isArray(body?.event?.activity) ? body.event.activity : [];
      let inboundTotal = 0n;
      for (const a of acts) {
        const toA = (a?.toAddress || a?.to || '').toString().toLowerCase();
        if (toA === addr) {
          const raw = a?.rawContract?.rawValue;
          let wei: bigint | undefined;
          if (typeof raw === 'string') {
            try { wei = raw.startsWith('0x') ? BigInt(raw) : BigInt(raw); } catch {}
          }
          if (!wei && typeof a?.value === 'number') {
            try { wei = BigInt(Math.round(a.value * 1e18)); } catch {}
          }
          if (wei && wei > 0n) inboundTotal += wei;
        }
      }
      const threshold = invoiceRec?.amountWei ? BigInt(String(invoiceRec.amountWei)) : 0n;
      if (threshold > 0n && inboundTotal >= threshold) {
        const webhookId = process.env.ALCHEMY_WEBHOOK_ID as string | undefined;
        if (webhookId) {
          await updateWebhookAddresses({ webhookId, remove: [addr] });
          if (DEBUG) { try { console.log('[WEBHOOK][Alchemy] removed address from webhook after payment >= threshold', { addr, inboundTotal: inboundTotal.toString(), threshold: threshold.toString() }); } catch {} }
        }
      }
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    try { console.error('[WEBHOOK][Alchemy] error:', e?.message || e); } catch {}
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const DEBUG = process.env.DEBUG_BOT === '1';
    if (DEBUG) {
      try { console.log('[WEBHOOK][Alchemy][GET] headers=', Object.fromEntries(req.headers)); } catch {}
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 200 });
  }
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}


