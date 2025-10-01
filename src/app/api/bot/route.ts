import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { parseEther, Interface } from 'ethers';
import { parseRequest } from '@/lib/parse';
import { isValidHexAddress, normalizeHexAddress, resolveEnsToHex } from '@/lib/addr';
import { tg } from '@/lib/telegram';
import { fetchPayCalldata } from '@/lib/requestApi';
import { bpsToPercentString } from '@/lib/fees';
import { buildEthereumUri, decodeProxyDataAndValidateValue } from '@/lib/ethUri';
import { estimateGasAndPrice } from '@/lib/gas';
import { buildQrForRequest } from '@/lib/qrUi';
import { isValidEthereumAddress } from '@/lib/utils';
import { requestContextById } from '@/lib/mem';

// Ephemeral, in-memory state for DM follow-ups (resets on deploy/restart)
const pendingAddressByUser = new Map<number, { amount: number; note: string }>();

async function resolveEnsOrAddress(input: string): Promise<string | undefined> {
  return resolveEnsToHex(input, process.env.RPC_URL);
}

export const runtime = 'nodejs';

const DEBUG = process.env.DEBUG_BOT === '1';
const DRY = process.env.BOT_DRY_RUN === '1';

async function tgCall(method: string, payload: any): Promise<any> {
  if (DRY) {
    try { console.log(`[BOT_DRY_RUN] ${method}`, payload); } catch {}
    return { ok: true, result: { message_id: 1 } } as any;
  }
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  try {
    const json = await res.json();
    if (DEBUG) {
      try { console.log(`[TG] ${method} ->`, json); } catch {}
    }
    return json;
  } catch {
    if (DEBUG) {
      try { console.log(`[TG] ${method} http=${res.status} ok=${res.ok}`); } catch {}
    }
    return { ok: res.ok };
  }
}

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

    const reply = async (text: string) => { const r = await tg.sendMessage(chatId, text); return !!r?.ok; };

    if (DEBUG) {
      await reply(`dbg: chatType=${chatType} isCmd=${typeof text === 'string' && text.startsWith('/')} text="${text}"`);
    }

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
        const apiBase = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const rest = await fetch(`${apiBase}/api/invoice`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-internal': process.env.INTERNAL_API_KEY || '',
          },
          body: JSON.stringify({
            payee: addr,
            amount: Number(ctx.amount),
            note: ctx.note || '',
            kind: 'request',
            initData: '',
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
        const openUrl = `${baseUrl}/pay/${id}`;
        const keyboard = { inline_keyboard: [[{ text: 'Open', web_app: { url: openUrl } }]] } as any;
        await tg.sendMessage(chatId, `Request: $${ctx.amount.toFixed(2)}${ctx.note ? ` — ${ctx.note}` : ''}`,);
        pendingAddressByUser.delete(tgUserId);
        return NextResponse.json({ ok: true, id, payUrl: openUrl });
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
      const parsed = parseRequest(text, process.env.BOT_USERNAME);
      const amt = parsed.amount as number;
      const note = parsed.memo;
      const explicitDest = parsed.payeeCandidate;
      if (!Number.isFinite(amt) || amt <= 0) {
        if (DEBUG) {
          await reply(`dbg: parse failed. raw="${text}"`);
        }
        await reply('Usage: /request <amount> [note] [destination]');
        return NextResponse.json({ ok: true });
      }

      try {
        const apiBase = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
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
              if (addr && isValidEthereumAddress(addr)) payee = addr;
              else if ((w as any)?.id) {
                try {
                  const walletId = (w as any).id as string;
                  const details = await (privy as any).wallets().ethereum().get(walletId);
                  const a = details?.address as string | undefined;
                  if (a && isValidEthereumAddress(a)) payee = a;
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
          await tgCall('sendMessage', { chat_id: chatId, text: combinedText, reply_markup: keyboard });
          return NextResponse.json({ ok: true });
        }

        const rest = await fetch(`${apiBase}/api/invoice`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', 'Accept': 'application/json',
            'x-internal': process.env.INTERNAL_API_KEY || '',
          },
          body: JSON.stringify({
            payee,
            amount: Number(amt),
            note,
            kind: 'request',
            initData: '',
          }),
        });
        if (!rest.ok) {
          const t = await rest.text();
          await reply(`Failed to create invoice: ${rest.status} ${rest.statusText}`);
          return NextResponse.json({ ok: true, error: t });
        }
        const json = await rest.json();
        const id = json.requestId || json.requestID || json.id;
        if (!id) {
          await reply('Invoice created but id missing');
          return NextResponse.json({ ok: true });
        }
        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const invUrl = `${baseUrl}/pay/${id}`;

        // Build QR using utils and pay endpoint; fallback to invoice link on any mismatch
        let ethUri: string | undefined;
        try {
          const feeAddress = process.env.FEE_ADDRESS || appConfig.feeAddr || undefined;
          const feePercentage = feeAddress ? bpsToPercentString(process.env.FEE_BPS || '50') : undefined;
          const payJson = await fetchPayCalldata(id, { feeAddress, feePercentage, apiKey: appConfig.request.apiKey || process.env.REQUEST_API_KEY });
          const txs: any[] = Array.isArray((payJson as any)?.transactions) ? (payJson as any).transactions : [];
          const idx: number = Number.isInteger((payJson as any)?.metadata?.paymentTransactionIndex)
            ? (payJson as any).metadata.paymentTransactionIndex
            : 0;
          const sel = txs[idx] || txs[0];
          if (sel && typeof sel.to === 'string') {
            const toAddr: string = sel.to;
            const data: string | undefined = typeof sel.data === 'string' ? sel.data : undefined;
            const hexVal: string | undefined = typeof sel.value?.hex === 'string' ? sel.value.hex : undefined;
            const decVal = (() => { try { return hexVal ? BigInt(hexVal).toString(10) : '0'; } catch { return '0'; } })();
            let gasDec: string | undefined;
            let gasPriceDec: string | undefined;
            if (process.env.QR_INCLUDE_GAS_HINTS === '1') {
              const est = await estimateGasAndPrice({ rpcUrl: process.env.RPC_URL, to: toAddr, data, valueWeiDec: decVal });
              gasDec = est.gas; gasPriceDec = est.gasPrice;
            }
            ethUri = buildEthereumUri({ to: toAddr, valueWeiDec: decVal, data, chainId: 1, gas: gasDec, gasPrice: gasPriceDec });
            const check = decodeProxyDataAndValidateValue(data, decVal, amt);
            if (!check.ok) {
              if (DEBUG) { try { console.warn('[BOT] Value/fee mismatch; fallback', check); } catch {} }
              ethUri = undefined;
            }
            if (DEBUG && ethUri) { try { console.log('[BOT] built ethUri from pay endpoint:', ethUri); } catch {} }
          }
        } catch {}
        const { qrUrl, caption, keyboard, payUrl: builtPayUrl } = buildQrForRequest(baseUrl, id, ethUri, amt, note || '');
        const sent = await tg.sendPhoto(chatId, qrUrl, caption, keyboard);
        const messageId = sent?.result?.message_id as number | undefined;
        if (messageId) {
          try {
            requestContextById.set(id, {
              chatId: Number(chatId),
              messageId: Number(messageId),
              paidCaption: `✅ PAID — $${amt.toFixed(2)}${note ? ` — ${note}` : ''}`,
              replyMarkup: keyboard,
            });
          } catch {}
        }

        return NextResponse.json({ ok: true, id, payUrl: builtPayUrl || invUrl });
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

      // Send a native transfer on Base (eip155:8453) @or USDC transfer if desired
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


