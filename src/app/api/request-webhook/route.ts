import { NextRequest, NextResponse } from 'next/server';
import { tg } from '@/lib/telegram';

export const runtime = 'nodejs';

// Minimal Request Network webhook endpoint
// Configure in Request dashboard → Webhooks → endpoint: <PUBLIC_BASE_URL>/api/request-webhook
// Optionally verify x-request-network-signature here (HMAC) if you set a secret in the dashboard.

export async function POST(req: NextRequest) {
  try {
    const sig = req.headers.get('x-request-network-signature') || '';
    // TODO: verify signature if you configure a secret. Skipping for MVP.

    const body = await req.json().catch(() => ({} as any));
    // Expected shapes can vary; try common fields
    const eventType: string = body?.event?.type || body?.type || '';
    const data = body?.event?.data || body?.data || body || {};
    const requestId: string | undefined = data?.requestId || data?.id || data?.request?.id;
    const metadata = data?.metadata || data?.request?.metadata || {};

    // If we stored Telegram context when creating the request, use it here
    const chatId = metadata?.chatId;
    const messageId = metadata?.messageId;
    const caption = metadata?.paidCaption || '✅ PAID';
    const replyMarkup = metadata?.replyMarkup; // if you persisted the same inline keyboard

    // Consider these as "paid" signals; adjust to exact value from your dashboard (e.g., "Payment Confirmed")
    const looksPaid = /paid|payment[_\s-]?confirmed/i.test(eventType);

    if (looksPaid && chatId && messageId) {
      try {
        await tg.editCaption(chatId, Number(messageId), caption, replyMarkup);
      } catch (e) {
        // Fall through; still return 200 to avoid retries if not desired
        console.error('Failed to edit caption for webhook:', (e as any)?.message || e);
      }
    }

    return NextResponse.json({ ok: true, received: true, event: eventType, requestId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 200 });
  }
}


