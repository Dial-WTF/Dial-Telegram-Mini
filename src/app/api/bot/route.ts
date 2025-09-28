import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';

// Ephemeral, in-memory state for DM follow-ups (resets on deploy/restart)
const pendingAddressByUser = new Map<number, { amount: number; note: string }>();

async function resolveEnsOrAddress(input: string): Promise<string | undefined> {
  const trimmed = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return trimmed;
  if (/^[a-z0-9\-_.]+\.[a-z]{2,}$/i.test(trimmed)) {
    try {
      const r = await fetch(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(trimmed)}`);
      if (!r.ok) return undefined;
      const j: any = await r.json();
      const addr = j?.address as string | undefined;
      if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) return addr;
    } catch {}
  }
  return undefined;
}

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
    // Inline mode support: when users type @YourBot in any chat
    const inline = body?.inline_query;
    if (inline && inline.id) {
      const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
      const q: string = (inline.query || '').trim();
      const m = q.match(/\d+(?:\.\d+)?/);
      const amt = m ? Number(m[0]) : undefined;

      const results: any[] = [];

      // Open app quick action
      results.push({
        type: 'article',
        id: 'open-app',
        title: 'Open Dial Pay',
        description: 'Launch the mini app to request or send',
        input_message_content: { message_text: 'Open Dial Pay' },
        reply_markup: {
          inline_keyboard: [[{ text: 'Open app', web_app: { url: baseUrl } }]],
        },
      });

      const quick = [5, 10, 20, 50];
      for (const v of quick) {
        results.push({
          type: 'article',
          id: `req-${v}`,
          title: `Request $${v}`,
          description: 'Create an invoice for this amount',
          input_message_content: { message_text: `Request $${v}` },
          reply_markup: {
            inline_keyboard: [[{ text: 'Create invoice', web_app: { url: `${baseUrl}?amount=${v}` } }]],
          },
        });
      }

      if (amt && amt > 0) {
        results.unshift({
          type: 'article',
          id: `req-custom-${amt}`,
          title: `Request $${amt}`,
          description: 'Create an invoice for this amount',
          input_message_content: { message_text: `Request $${amt}` },
          reply_markup: {
            inline_keyboard: [[{ text: 'Create invoice', web_app: { url: `${baseUrl}?amount=${amt}` } }]],
          },
        });
      }

      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/answerInlineQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inline_query_id: inline.id, results, cache_time: 1, is_personal: true }),
      });
      return NextResponse.json({ ok: true });
    }
    const msg = body?.message;
    const text: string = msg?.text || '';
    const chatId = msg?.chat?.id;
    const chatType: string | undefined = msg?.chat?.type;
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

    // Avoid spamming group chats: only act on slash commands. In DMs, allow normal flow.
    const isCommand = typeof text === 'string' && text.startsWith('/');
    if (!isCommand && chatType !== 'private') {
      return NextResponse.json({ ok: true });
    }

    // If we are waiting for an address from this user in DM, handle it first
    if (chatType === 'private' && !isCommand && pendingAddressByUser.has(tgUserId)) {
      const ctx = pendingAddressByUser.get(tgUserId)!;
      const addr = await resolveEnsOrAddress(text);
      if (!addr) {
        await reply('Could not parse that as an address or ENS. Please send a valid 0x address or ens name.');
        return NextResponse.json({ ok: true });
      }
      try {
        const apiBase = process.env.REQUEST_REST_BASE || 'https://api.request.network/v1';
        const rest = await fetch(`${apiBase}/request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(process.env.REQUEST_API_KEY ? { 'x-api-key': process.env.REQUEST_API_KEY as string } : {}),
          },
          body: JSON.stringify({
            payee: addr,
            amount: String(ctx.amount),
            invoiceCurrency: 'USD',
            paymentCurrency: 'USDC-base',
          }),
        });
        if (!rest.ok) {
          const t = await rest.text();
          await reply(`Failed to create invoice: ${rest.status} ${rest.statusText}`);
          pendingAddressByUser.delete(tgUserId);
          return NextResponse.json({ ok: true, error: t });
        }
        const json = await rest.json();
        const id = json.paymentReference || json.requestID || json.requestId;
        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const payUrl = `${baseUrl}/pay/${id}`;
        const keyboard = { inline_keyboard: [[{ text: 'Open', web_app: { url: payUrl } }]] } as any;
        await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: `Request: $${ctx.amount.toFixed(2)}${ctx.note ? ` — ${ctx.note}` : ''}`, reply_markup: keyboard }),
        });
        pendingAddressByUser.delete(tgUserId);
        return NextResponse.json({ ok: true, id, payUrl });
      } catch (err: any) {
        await reply(`Error creating request: ${err?.message || 'unknown'}`);
        pendingAddressByUser.delete(tgUserId);
        return NextResponse.json({ ok: false });
      }
    }

    if (/^\/start/.test(text)) {
      await reply('Dial Bot ready. Use /pay <to> <amt> or /request <amt>');
      return NextResponse.json({ ok: true });
    }

    // /request <amount> [note] [destination]
    if (/^\/request\b/i.test(text)) {
      // Robust parsing: allow /request@BotName 5 note dest (tolerant to extra whitespace)
      let amt = NaN as number;
      let tokens: string[] = [];
      const m = text.match(/^\/request(?:@[^\s]+)?\s+([0-9]+(?:\.[0-9]+)?)(?:\s+([\s\S]*))?$/i);
      if (m) {
        amt = Number(m[1]);
        tokens = m[2] ? m[2].trim().split(/\s+/) : [];
      } else {
        // Fallback extraction when the message includes odd formatting
        const cleaned = text.replace(/^\/request(?:@[^\s]+)?/i, '').trim();
        const m2 = cleaned.match(/([0-9]+(?:\.[0-9]+)?)/);
        if (m2) {
          amt = Number(m2[1]);
          const rest = cleaned.slice(m2.index! + m2[0].length).trim();
          tokens = rest ? rest.split(/\s+/) : [];
        }
      }
      let explicitDest: string | undefined;
      const last = tokens[tokens.length - 1];
      if (last && (/^0x[0-9a-fA-F]{40}$/.test(last) || /\.[a-z]{2,}$/i.test(last))) {
        explicitDest = last;
        tokens = tokens.slice(0, -1);
      }
      const note = tokens.join(' ');
      if (!Number.isFinite(amt) || amt <= 0) {
        await reply('Usage: /request <amount> [note] [destination]');
        return NextResponse.json({ ok: true });
      }

      try {
        const apiBase = process.env.REQUEST_REST_BASE || 'https://api.request.network/v1';
        // Resolve payee: explicit destination > linked wallet > env fallback
        let payee: string | undefined;
        if (explicitDest) {
          const resolved = await resolveEnsOrAddress(explicitDest);
          if (resolved) payee = resolved;
        }
        if (!payee) {
          try {
            const privy = await getPrivyClient();
            if (privy) {
              const user = await privy.users().getByTelegramUserID({ telegram_user_id: tgUserId });
              const w = (user.linked_accounts || []).find((a: any) => a.type === 'wallet' && typeof (a as any).address === 'string');
              const addr = (w as any)?.address as string | undefined;
              if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) payee = addr;
              else if ((w as any)?.id) {
                try {
                  const walletId = (w as any).id as string;
                  const details = await (privy as any).wallets().ethereum().get(walletId);
                  const a = details?.address as string | undefined;
                  if (a && /^0x[0-9a-fA-F]{40}$/.test(a)) payee = a;
                } catch {}
              }
            }
          } catch {}
        }
        if (!payee) payee = (process.env.PAYEE_ADDR as string | undefined) || appConfig.payeeAddr || undefined;
        if (!payee) {
          const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
          const keyboard = { inline_keyboard: [[{ text: 'Open app to link wallet', web_app: { url: baseUrl } }]] } as any;
          pendingAddressByUser.set(tgUserId, { amount: amt, note });
          const combinedText = 'No wallet linked. Open the app and sign in first, then retry /request.\n\nAlternatively, reply to this message with your receiving address or ENS.';
          await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: combinedText, reply_markup: keyboard }),
          });
          return NextResponse.json({ ok: true });
        }

        const rest = await fetch(`${apiBase}/request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', 'Accept': 'application/json',
            ...(process.env.REQUEST_API_KEY ? { 'x-api-key': process.env.REQUEST_API_KEY as string } : {}),
          },
          body: JSON.stringify({ payee, amount: String(amt), invoiceCurrency: 'USD', paymentCurrency: 'USDC-base' }),
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

        // Send inline QR with an Open button that uses web_app
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(payUrl)}`;
        const caption = `Request: $${amt.toFixed(2)}${note ? ` — ${note}` : ''}`;
        const keyboard = { inline_keyboard: [[{ text: 'Open invoice', web_app: { url: payUrl } }]] } as any;
        const sent = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendPhoto`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, photo: qrUrl, caption, reply_markup: keyboard }),
        }).then(r => r.json()).catch(() => ({} as any));

        // Poll and update caption to ✅ PAID
        const messageId = sent?.result?.message_id as number | undefined;
        (async () => {
          if (!messageId) return;
          for (let i = 0; i < 24; i++) {
            try {
              await new Promise(r => setTimeout(r, 5000));
              const s = await fetch(`${baseUrl}/api/status?id=${id}`).then(r => r.json());
              if (s?.status === 'paid') {
                const paidCaption = `✅ PAID — $${amt.toFixed(2)}${note ? ` — ${note}` : ''}`;
                await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/editMessageCaption`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: chatId, message_id: messageId, caption: paidCaption, reply_markup: keyboard }),
                });
                break;
              }
            } catch {}
          }
        })();

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

    if (chatType === 'private' && isCommand) {
      await reply('Unknown command. Try /pay or /request');
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 200 });
  }
}


