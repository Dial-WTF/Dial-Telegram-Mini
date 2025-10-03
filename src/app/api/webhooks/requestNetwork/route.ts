import { NextRequest, NextResponse } from 'next/server';
import { tg } from '#/lib/telegram';
import { requestContextById } from '#/lib/mem';

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
    const ctx = requestContextById.get(requestId || '');
    const chatId = ctx?.chatId;
    const messageId = ctx?.messageId;
    const caption = '✅ PAID';
    const replyMarkup = ctx?.replyMarkup;

    // Consider these as "paid" signals; adjust to exact value from your dashboard (e.g., "Payment Confirmed")
    const looksPaid = /paid|payment[_\s-]?confirmed/i.test(eventType);

    if (looksPaid && chatId && messageId) {
      try {
        // Replace QR content with brand image and keep only Request Scan + Paid status
        const kb = replyMarkup && replyMarkup.inline_keyboard
          ? { inline_keyboard: [
              [{ text: 'Open invoice', url: (replyMarkup.inline_keyboard[0]?.[0]?.url) || '' }].filter(Boolean),
              [{ text: 'View on Request Scan', url: (replyMarkup.inline_keyboard[1]?.[0]?.url) || '' }],
              [{ text: 'Status: ✅ Paid', callback_data: 'status_paid' }],
            ].filter((row: any) => row.length > 0) }
          : undefined;
        await tg.editCaption(chatId, Number(messageId), caption, kb);
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


