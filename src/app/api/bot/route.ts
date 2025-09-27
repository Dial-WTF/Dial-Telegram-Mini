import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Lazy-initialize Privy client at runtime to avoid build-time dependency
async function getPrivyClient() {
  if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) return null;
  try {
    const mod = await import('@privy-io/node');
    // @ts-ignore - runtime import
    const client = new mod.PrivyClient({
      appId: process.env.PRIVY_APP_ID as string,
      appSecret: process.env.PRIVY_APP_SECRET as string,
    });
    return client;
  } catch {
    return null;
  }
}

// Minimal webhook endpoint for Telegram bot commands via Bot API webhook
// Set this path as your webhook URL: <PUBLIC_BASE_URL>/api/bot
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const msg = body?.message;
    const text: string = msg?.text || '';
    const chatId = msg?.chat?.id;
    const tgUserId = msg?.from?.id;

    if (!chatId || !tgUserId) return NextResponse.json({ ok: true });

    const reply = async (text: string) => {
      const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      return res.ok;
    };

    if (/^\/start/.test(text)) {
      await reply('Dial Bot ready. Use /pay <to> <amt> or /request <amt>');
      return NextResponse.json({ ok: true });
    }

    // /request <amount> [note...]
    if (/^\/request\b/.test(text)) {
      const parts = text.trim().split(/\s+/);
      const amt = Number(parts[1] || '0');
      const note = parts.slice(2).join(' ');
      if (!Number.isFinite(amt) || amt <= 0) {
        await reply('Usage: /request <amount> [note]');
        return NextResponse.json({ ok: true });
      }

      try {
        // Create Request invoice via REST (avoids TMA initData requirement)
        const apiBase = process.env.REQUEST_REST_BASE || 'https://api.request.network/v1';
        const payee = process.env.PAYEE_ADDR as string;
        if (!payee) {
          await reply('Server not configured: missing PAYEE_ADDR');
          return NextResponse.json({ ok: true });
        }
        const rest = await fetch(`${apiBase}/request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(process.env.REQUEST_API_KEY ? { 'x-api-key': process.env.REQUEST_API_KEY as string } : {}),
          },
          body: JSON.stringify({
            payee,
            amount: String(amt),
            invoiceCurrency: 'USD',
            paymentCurrency: 'USDC-base',
          }),
        });
        if (!rest.ok) {
          const t = await rest.text();
          await reply(`Failed to create invoice: ${rest.status} ${rest.statusText}`);
          return NextResponse.json({ ok: true, error: t });
        }
        const json = await rest.json();
        const id = json.paymentReference || json.requestID || json.requestId;
        if (!id) {
          await reply('Invoice created but id missing');
          return NextResponse.json({ ok: true });
        }
        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const payUrl = `${baseUrl}/pay/${id}`;

        // Try to send an image + caption if we have a public asset base
        const photoUrl = process.env.PUBLIC_BASE_URL ? `${baseUrl}/dial-neon.png` : null;
        const caption = `Request: $${amt.toFixed(2)}${note ? ` — ${note}` : ''}`;
        const keyboard = {
          inline_keyboard: [[{ text: 'Open', url: payUrl }]],
        };

        if (photoUrl) {
          await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, reply_markup: keyboard }),
          });
        } else {
          await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: caption + '\n' + payUrl, reply_markup: keyboard }),
          });
        }
        return NextResponse.json({ ok: true, id, payUrl });
      } catch (err: any) {
        await reply(`Error creating request: ${err?.message || 'unknown'}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /pay <toAddress> <amount>
    if (/^\/pay\b/.test(text)) {
      const parts = text.split(/\s+/);
      const to = parts[1];
      const amt = Number(parts[2] || '0');
      if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to) || !Number.isFinite(amt) || amt <= 0) {
        await reply('Usage: /pay <toAddress> <amount>');
        return NextResponse.json({ ok: true });
      }

      // Find the Privy user by Telegram user id and get their wallet id
      const privy = await getPrivyClient();
      if (!privy) {
        await reply('Server wallet not configured.');
        return NextResponse.json({ ok: true });
      }
      const user = await privy.users().getByTelegramUserID({ telegram_user_id: tgUserId });
      const wallet = user.linked_accounts.find((a: any) => a.type === 'wallet' && 'id' in a);
      const walletId = (wallet as any)?.id;
      if (!walletId) {
        await reply('No wallet linked. Open the app and sign in first.');
        return NextResponse.json({ ok: true });
      }

      // Send a native transfer on Base (eip155:8453) or USDC transfer if desired
      await privy.wallets().ethereum().sendTransaction(walletId, {
        caip2: 'eip155:8453',
        params: {
          transaction: {
            to,
            value: '0x' + BigInt(Math.round(amt * 1e18)).toString(16),
          },
        },
      });

      await reply(`Sent ${amt} (native) to ${to}`);
      return NextResponse.json({ ok: true });
    }

    await reply('Unknown command. Try /pay or /request');
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 200 });
  }
}


