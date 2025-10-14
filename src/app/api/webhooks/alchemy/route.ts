import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
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
    // Verify signature if ALCHEMY_SIGNATURE is set; else fall back to x-webhook-secret check
    const signingKey = process.env.ALCHEMY_SIGNATURE as string | undefined;
    const rawBody = await req.text().catch(() => '');
    if (signingKey) {
      const received = (req.headers.get('x-alchemy-signature') || '').toString();
      const expected = createHmac('sha256', signingKey).update(rawBody).digest('hex');
      const match = received === expected || received.replace(/^sha256=/i, '') === expected;
      if (!match) {
        if (DEBUG) { try { console.warn('[WEBHOOK][Alchemy] signature mismatch', { received: received.slice(0, 12) + '…', expected: expected.slice(0, 12) + '…' }); } catch {} }
        return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 });
      }
    } else {
      const secret = process.env.WEBHOOK_SECRET || '';
      const auth = req.headers.get('x-webhook-secret') || '';
      if (secret && auth !== secret) {
        if (DEBUG) { try { console.log('[WEBHOOK][Alchemy] unauthorized (missing/invalid x-webhook-secret)'); } catch {} }
        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }
    }

    const body = rawBody ? (JSON.parse(rawBody || '{}') as any) : ({} as any);
    if (DEBUG) {
      try {
        const sample = JSON.stringify(body).slice(0, 500);
        console.log('[WEBHOOK][Alchemy] body=', sample);
        console.log('[WEBHOOK][Alchemy] headers=', Object.fromEntries(req.headers));
      } catch {}
    }
    // Address Activity webhook: try to resolve the predicted deposit address from payload
    // Some events include internal calls where toAddress is the proxy; in that case, the deposit
    // is usually the fromAddress. Prefer a mapped address from our context set.
    const acts: any[] = Array.isArray(body?.event?.activity) ? body.event.activity : [];
    const first = acts[0] || {};
    const candidates: string[] = [
      (first?.toAddress || first?.to || '').toString().toLowerCase(),
      (first?.fromAddress || '').toString().toLowerCase(),
      (body?.address || body?.to || '').toString().toLowerCase(),
    ].filter(Boolean);
    let addr = candidates.find((a) => predictContextByAddress.has(a)) || candidates[0] || '';
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

    // Compute inbound total received by the deposit address (exclude internal forwards to proxy)
    // and update UI to Processing/Partial/Pending based on threshold vs inbound
    let inboundTotal = 0n;
    try {
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
    } catch {}

    const threshold = invoiceRec?.amountWei ? BigInt(String(invoiceRec.amountWei)) : 0n;

    // Try to update the original message status to Pending/Processing
    try {
      const reqId = requestIdByPredictedAddress.get(addr) || (body?.requestId || body?.event?.requestId || '').toString();
      const maybeCtx = reqId ? requestContextById.get(reqId) : undefined;
      if (maybeCtx?.chatId && maybeCtx?.messageId) {
        // Rebuild keyboard to ensure button changes
        const base = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const openUrl = `${base}/pay/${reqId}`;
        const scanUrl = `https://scan.request.network/request/${reqId}`;
        const statusText = threshold > 0n
          ? (inboundTotal === 0n ? 'Status: 🟡 Pending'
             : (inboundTotal < threshold ? 'Status: 🟠 Processing (partial)'
               : 'Status: 🟡 Pending'))
          : 'Status: 🟡 Pending';
        const kb = { inline_keyboard: [
          [{ text: 'Open invoice', url: openUrl }],
          [{ text: 'View on Request Scan', url: scanUrl }],
          [{ text: statusText, callback_data: 'sr' }],
        ] } as any;
        await tg.editReplyMarkup(maybeCtx.chatId, maybeCtx.messageId, kb);
        const caption = inboundTotal > 0n
          ? `Request: 🟠 Processing${threshold > 0n ? ` — ${inboundTotal.toString()} / ${threshold.toString()} wei` : ''}`
          : 'Request: 🟡 Pending';
        await tg.editCaption(maybeCtx.chatId, maybeCtx.messageId, caption, kb);
      }
    } catch {}

    // Persist raw webhook to S3 pending folder for diagnosis and recovery
    try {
      const reqId = requestIdByPredictedAddress.get(addr) || (body?.requestId || body?.event?.requestId || '').toString();
      const key = `${PATH_INVOICES}pending/${addr}-${Date.now()}.json`;
      const payload = Buffer.from(JSON.stringify({ requestId: reqId, addr, inboundTotal: inboundTotal.toString(), threshold: threshold.toString(), body }, null, 2));
      await s3.send(new PutObjectCommand({ Bucket: AWS_S3_BUCKET, Key: key, Body: payload, ContentType: 'application/json' }));
    } catch {}

    // If paid enough, remove address from webhook to reduce noise
    try {
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


