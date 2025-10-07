import { NextRequest, NextResponse } from 'next/server';
import { tg } from '#/lib/telegram';
import { requestContextById } from '#/lib/mem';

export const runtime = 'nodejs';

// Minimal Request Network webhook endpoint
// Configure in Request dashboard → Webhooks → endpoint: <PUBLIC_BASE_URL>/api/request-webhook
// Optionally verify x-request-network-signature here (HMAC) if you set a secret in the dashboard.

export async function POST(req: NextRequest) {
  try {
    const DEBUG = process.env.DEBUG_BOT === '1';
    const sig = req.headers.get('x-request-network-signature') || '';
    // TODO: verify signature if you configure a secret. Skipping for MVP.

    const body = await req.json().catch(() => ({} as any));
    if (DEBUG) {
      try { console.log('[WEBHOOK][Request] body=', JSON.stringify(body).slice(0, 800)); } catch {}
    }
    // Expected shapes can vary; try common fields
    const eventType: string = body?.event?.type || body?.type || '';
    const data = body?.event?.data || body?.data || body || {};
    const requestId: string | undefined = data?.requestId || data?.id || data?.request?.id;
    let ctx = requestContextById.get(requestId || '');
    let chatId = ctx?.chatId as number | undefined;
    let messageId = ctx?.messageId as number | undefined;
    const paidCaption = (ctx as any)?.paidCaption || '✅ PAID';
    const replyMarkup = ctx?.replyMarkup;

    // Consider these as "paid" signals; adjust to exact value from your dashboard (e.g., "Payment Confirmed")
    const looksPaid = /paid|payment[_\s-]?confirmed/i.test(eventType);

    // Fallback to S3 index if context missing
    if ((!chatId || !messageId) && requestId) {
      try {
        const { s3 } = await import('#/services/s3/client');
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const { PATH_INVOICES } = await import('#/services/s3/filepaths');
        const { AWS_S3_BUCKET } = await import('#/config/constants');
        const key = `${PATH_INVOICES}by-request/${requestId}.json`;
        const obj = await s3.send(new GetObjectCommand({ Bucket: AWS_S3_BUCKET, Key: key }));
        const text = await (obj.Body as any).transformToString();
        const rec = JSON.parse(text || '{}');
        chatId = Number(rec?.chatId) || chatId;
        messageId = Number(rec?.messageId) || messageId;
      } catch {}
    }

    if (looksPaid && chatId && messageId) {
      try {
        // Build pretty paid caption with details
        const amtStr: string = (data?.amount || data?.totalAmountPaid || '').toString();
        const currency: string = (data?.paymentCurrency || data?.currency || 'ETH').toString().toUpperCase();
        const tsIso: string = (data?.timestamp || new Date().toISOString()).toString();
        const d = new Date(tsIso);
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const yy = String(d.getUTCFullYear()).slice(-2);
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mi = String(d.getUTCMinutes()).padStart(2, '0');
        const netRaw: string = (data?.network || 'mainnet').toString();
        const netName = netRaw.charAt(0).toUpperCase() + netRaw.slice(1);
        const txHash: string | undefined = (data?.txHash || data?.transactionHash || '').toString() || undefined;

        const pretty = `✅ ${amtStr} ${currency} paid on ${mm}/${dd}/${yy} @ ${hh}:${mi} UTC\nOn ${netName}\nPowered by Request Network`;

        // Rebuild keyboard with Paid status
        const base = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const openUrl = (() => {
          try { return replyMarkup?.inline_keyboard?.[0]?.find((b: any) => b?.url)?.url || `${base}/pay/${requestId}`; } catch { return `${base}/pay/${requestId}`; }
        })();
        const scanUrl = `https://scan.request.network/request/${requestId}`;
        const etherscanBase = netRaw === 'mainnet' ? 'https://etherscan.io' : netRaw === 'sepolia' ? 'https://sepolia.etherscan.io' : 'https://etherscan.io';
        const txUrl = txHash ? `${etherscanBase}/tx/${txHash}` : '';
        const kb = { inline_keyboard: [
          [{ text: 'Open invoice', url: openUrl }],
          [{ text: 'View on Request Scan', url: scanUrl }],
          ...(txUrl ? [[{ text: 'View Transaction', url: txUrl }]] : []),
          [{ text: 'Status: ✅ Paid', callback_data: 'sr' }],
        ] } as any;

        // Replace QR with wordmark image
        const mediaUrl = `${base}/Dial.letters.transparent.bg.crop.png`;
        try {
          await tg.editMedia(chatId, Number(messageId), { type: 'photo', media: mediaUrl, caption: pretty }, kb);
        } catch {
          // Fallback to markup+caption edits if media change fails
          await tg.editReplyMarkup(chatId, Number(messageId), kb);
          await tg.editCaption(chatId, Number(messageId), pretty, kb);
        }
      } catch (e) {
        // Fall through; still return 200 to avoid retries if not desired
        console.error('Failed to edit caption for webhook:', (e as any)?.message || e);
      }
      // Clear context after success to avoid leaks
      try { if (requestId) requestContextById.delete(requestId); } catch {}
    }

    return NextResponse.json({ ok: true, received: true, event: eventType, requestId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 200 });
  }
}


