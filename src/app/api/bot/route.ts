import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
import { parseEther, Interface } from 'ethers';
import { parseRequest } from '@/lib/parse';
import { isValidHexAddress, normalizeHexAddress, resolveEnsToHex } from '@/lib/addr';
import { tg } from '@/lib/telegram';

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
        const rawBase = (appConfig.request.restBase || 'https://api.request.network');
        const baseTrim = rawBase.replace(/\/$/, '');
        const endpoint = /\/v1$/.test(baseTrim)
          ? `${baseTrim}/request`
          : /\/v2$/.test(baseTrim)
          ? `${baseTrim}/request`
          : `${baseTrim}/v2/request`;
        const apiKey = appConfig.request.apiKey || process.env.REQUEST_API_KEY;
        if (!apiKey) {
          await reply('Server missing REQUEST_API_KEY');
          return NextResponse.json({ ok: false }, { status: 200 });
        }
        const rest = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-api-key': apiKey as string,
          },
          body: JSON.stringify({
            payee: addr,
            amount: String(ctx.amount),
            invoiceCurrency: 'ETH-mainnet',
            paymentCurrency: 'ETH-mainnet',
            reference: ctx.note || '',
            paymentNetwork: {
              id: 'ETH_FEE_PROXY_CONTRACT',
              parameters: {
                paymentNetworkName: 'mainnet',
                paymentAddress: addr,
                feeAddress: process.env.FEE_ADDRESS || appConfig.feeAddr || appConfig.payeeAddr!,
                feeAmount: (() => {
                  try {
                    const bps = Number(process.env.FEE_BPS || '50');
                    const wei = parseEther(String(ctx.amount));
                    const fee = (wei * BigInt(bps)) / 10000n;
                    return fee.toString();
                  } catch { return '0'; }
                })()
              }
            }
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
        await tg.sendMessage(chatId, `Request: $${ctx.amount.toFixed(2)}${ctx.note ? ` — ${ctx.note}` : ''}`,);
        pendingAddressByUser.delete(tgUserId);
        return NextResponse.json({ ok: true, id, payUrl });
      } catch (err: any) {
        await reply(`Error creating request: ${err?.message || 'unknown'}`);
        pendingAddressByUser.delete(tgUserId);
        return NextResponse.json({ ok: false });
      }
    }

    if (/^\/start\b/.test(text)) {
      await reply('Dial Bot ready. Use /pay <to> <amt> or /request <amt>\n\nParty Lines:\n/startparty - Create a party room\n/listparty - List open party rooms\n/findparty <address> - Find party by contract address');
      return NextResponse.json({ ok: true });
    }

    // /startparty - Create a new party room on dial.wtf
    if (/^\/startparty\b/i.test(text)) {
      const apiKey = process.env.PUBLIC_API_KEY_TELEGRAM;
      if (!apiKey) {
        await reply('Server missing PUBLIC_API_KEY_TELEGRAM');
        return NextResponse.json({ ok: false }, { status: 200 });
      }

      // Get user's wallet address
      let owner: string | undefined;
      const parts = text.split(/\s+/);
      const providedAddr = parts[1];

      // If user provided an address, use that
      if (providedAddr && /^0x[0-9a-fA-F]{40}$/i.test(providedAddr)) {
        owner = providedAddr.toLowerCase();
      } else {
        // Try to get from Privy
        try {
          const privy = await getPrivyClient();
          if (privy) {
            const user = await privy.users().getByTelegramUserID({ telegram_user_id: tgUserId });
            const w = (user.linked_accounts || []).find((a: any) => a.type === 'wallet' && typeof (a as any).address === 'string');
            const addr = (w as any)?.address as string | undefined;
            if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) owner = addr;
          }
        } catch (err: any) {
          if (DEBUG) {
            await reply(`dbg: Privy lookup failed: ${err?.message || 'unknown'}`);
          }
        }
      }

      if (!owner) {
        await reply('No wallet found. Usage: /startparty <your_wallet_address>\n\nExample: /startparty 0xaA64...337c');
        return NextResponse.json({ ok: true });
      }

      try {
        const response = await fetch('https://staging.dial.wtf/api/v1/party-lines', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            owner,
            telegramUserId: String(tgUserId),
            telegramChatId: String(chatId),
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          await reply(`Failed to create party room: ${response.status} ${response.statusText}`);
          return NextResponse.json({ ok: false, error });
        }

        const apiResponse = await response.json();
        if (DEBUG) {
          await reply(`dbg: API response: ${JSON.stringify(apiResponse)}`);
        }

        const data = apiResponse.data || apiResponse;
        const joinUrl = data.joinUrl;
        const roomCode = data.roomCode;
        const partyId = data.id || data.partyLineId || data.contractAddress || data.address;

        if (!joinUrl && !partyId) {
          await reply(`⚠️ Party room created but no ID or joinUrl returned.`);
          return NextResponse.json({ ok: true, data: apiResponse });
        }

        // Replace dial.wtf with staging.dial.wtf in joinUrl
        const partyLineUrl = joinUrl
          ? joinUrl.replace('https://dial.wtf/', 'https://staging.dial.wtf/')
          : `https://staging.dial.wtf/party/${roomCode || partyId}`;
        const message = `🎉 Party room created!\n\nOwner: ${owner}\nRoom Code: ${roomCode || 'N/A'}`;
        const keyboard = {
          inline_keyboard: [[{ text: 'Open Party Room', url: partyLineUrl }]]
        };
        await tgCall('sendMessage', { chat_id: chatId, text: message, reply_markup: keyboard });
        return NextResponse.json({ ok: true, data: apiResponse });
      } catch (err: any) {
        await reply(`Error creating party room: ${err?.message || 'unknown'}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /listparty - List all open party rooms
    if (/^\/listparty\b/i.test(text)) {
      const apiKey = process.env.PUBLIC_API_KEY_TELEGRAM;
      if (!apiKey) {
        await reply('Server missing PUBLIC_API_KEY_TELEGRAM');
        return NextResponse.json({ ok: false }, { status: 200 });
      }

      try {
        // Query all party lines (not just active ones)
        const response = await fetch('https://staging.dial.wtf/api/v1/party-lines?limit=100', {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
          },
        });

        if (!response.ok) {
          const error = await response.text();
          await reply(`Failed to fetch party rooms: ${response.status} ${response.statusText}`);
          return NextResponse.json({ ok: false, error });
        }

        const apiResponse = await response.json();

        if (DEBUG) {
          const shortResp = JSON.stringify(apiResponse).slice(0, 500);
          await reply(`dbg: Raw response: ${shortResp}`);
        }

        // API returns: { success: true, data: { partyLines: [...], pagination: {...} } }
        const partyLines = apiResponse?.data?.partyLines || [];

        if (DEBUG) {
          await reply(`dbg: Found ${partyLines.length} party rooms`);
        }

        if (partyLines.length === 0) {
          await reply('No open party rooms found. Use /startparty to create one!');
          return NextResponse.json({ ok: true, data: [] });
        }

        let message = `🎊 Open Party Rooms (${partyLines.length}):\n\n`;
        partyLines.slice(0, 10).forEach((party: any, idx: number) => {
          const roomCode = party.roomCode || 'N/A';
          const owner = party.owner || 'Unknown';
          const joinUrl = party.joinUrl ? party.joinUrl.replace('https://dial.wtf/', 'https://staging.dial.wtf/') : '';
          message += `${idx + 1}. ${roomCode}\n   Owner: ${owner.slice(0, 10)}...${owner.slice(-6)}\n   ${joinUrl}\n\n`;
        });

        if (partyLines.length > 10) {
          message += `\n...and ${partyLines.length - 10} more`;
        }

        await reply(message);
        return NextResponse.json({ ok: true, data: partyLines });
      } catch (err: any) {
        await reply(`Error fetching party rooms: ${err?.message || 'unknown'}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /findparty <address> - Search for a party room by contract address
    if (/^\/findparty\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const searchQuery = parts[1];

      if (!searchQuery) {
        await reply('Usage: /findparty <contract_address>');
        return NextResponse.json({ ok: true });
      }

      const apiKey = process.env.PUBLIC_API_KEY_TELEGRAM;
      if (!apiKey) {
        await reply('Server missing PUBLIC_API_KEY_TELEGRAM');
        return NextResponse.json({ ok: false }, { status: 200 });
      }

      try {
        const response = await fetch('https://staging.dial.wtf/api/v1/party-lines', {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
          },
        });

        if (!response.ok) {
          const error = await response.text();
          await reply(`Failed to search party rooms: ${response.status} ${response.statusText}`);
          return NextResponse.json({ ok: false, error });
        }

        const data = await response.json();
        const partyLines = Array.isArray(data) ? data : data.partyLines || [];

        // Search by contract address or partial match
        const matches = partyLines.filter((party: any) => {
          const contractAddr = (party.contractAddress || party.address || '').toLowerCase();
          const search = searchQuery.toLowerCase();
          return contractAddr.includes(search) || contractAddr === search;
        });

        if (matches.length === 0) {
          await reply(`No party rooms found matching: ${searchQuery}`);
          return NextResponse.json({ ok: true, data: [] });
        }

        let message = `🔍 Found ${matches.length} matching party room${matches.length > 1 ? 's' : ''}:\n\n`;
        matches.slice(0, 5).forEach((party: any, idx: number) => {
          const contractAddr = party.contractAddress || party.address || 'N/A';
          const owner = party.owner || 'Unknown';
          const status = party.status || 'active';
          const partyUrl = `https://staging.dial.wtf/party/${party.id || contractAddr}`;
          message += `${idx + 1}. ${contractAddr}\n   Owner: ${owner}\n   Status: ${status}\n   URL: ${partyUrl}\n\n`;
        });

        if (matches.length > 5) {
          message += `\n...and ${matches.length - 5} more`;
        }

        await reply(message);
        return NextResponse.json({ ok: true, data: matches });
      } catch (err: any) {
        await reply(`Error searching party rooms: ${err?.message || 'unknown'}`);
        return NextResponse.json({ ok: false });
      }
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
        const rawBase = (appConfig.request.restBase || 'https://api.request.network');
        const baseTrim = rawBase.replace(/\/$/, '');
        const endpoint = /\/v1$/.test(baseTrim)
          ? `${baseTrim}/request`
          : /\/v2$/.test(baseTrim)
          ? `${baseTrim}/request`
          : `${baseTrim}/v2/request`;
        const apiKey = appConfig.request.apiKey || process.env.REQUEST_API_KEY;
        if (!apiKey) {
          await reply('Server missing REQUEST_API_KEY');
          return NextResponse.json({ ok: false }, { status: 200 });
        }
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
          await tgCall('sendMessage', { chat_id: chatId, text: combinedText, reply_markup: keyboard });
          return NextResponse.json({ ok: true });
        }

        const rest = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', 'Accept': 'application/json',
            'x-api-key': apiKey as string,
          },
          body: JSON.stringify({
            payee,
            amount: String(amt),
            invoiceCurrency: 'ETH-mainnet',
            paymentCurrency: 'ETH-mainnet',
            reference: note || '',
            paymentNetwork: {
              id: 'ETH_FEE_PROXY_CONTRACT',
              parameters: {
                paymentNetworkName: 'mainnet',
                paymentAddress: payee,
                feeAddress: process.env.FEE_ADDRESS || appConfig.feeAddr || appConfig.payeeAddr!,
                feeAmount: (() => {
                  try {
                    const bps = Number(process.env.FEE_BPS || '50');
                    const wei = parseEther(String(amt));
                    const fee = (wei * BigInt(bps)) / 10000n;
                    return fee.toString();
                  } catch { return '0'; }
                })()
              }
            }
          }),
        });
        if (!rest.ok) {
          const t = await rest.text();
          await reply(`Failed to create invoice: ${rest.status} ${rest.statusText}`);
          return NextResponse.json({ ok: true, error: t });
        }
        const json = await rest.json();
        const id = json.requestID || json.requestId || json.id;
        const paymentReference: string | undefined = json.paymentReference || json.reference || json.payment_reference;
        if (!id) {
          await reply('Invoice created but id missing');
          return NextResponse.json({ ok: true });
        }
        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const payUrl = `${baseUrl}/pay/${id}`;

        // Build an EIP-681 ETH URI to the ETH Fee Proxy if configured
        const amountWei = parseEther(String(amt));
        const feeBps = Number(process.env.FEE_BPS || '50');
        const feeWei = (amountWei * BigInt(feeBps)) / 10000n;
        const feeAddr = process.env.FEE_ADDRESS || appConfig.feeAddr || appConfig.payeeAddr!;
        const proxy = process.env.ETH_FEE_PROXY_ADDRESS; // set this for mainnet to get wallet-pay QR

        let ethUri: string | undefined;
        if (proxy && paymentReference) {
          try {
            const iface = new Interface([
              'function transferWithReferenceAndFee(address to, bytes reference, uint256 fee, address feeAddress)'
            ]);
            const data = iface.encodeFunctionData('transferWithReferenceAndFee', [payee, paymentReference, feeWei, feeAddr]);
            ethUri = `ethereum:${proxy}?value=${amountWei.toString()}&data=${data}`;
          } catch {}
        }
        // Fallback: simple ETH transfer URI to payee if proxy/reference not available
        if (!ethUri && payee) {
          ethUri = `ethereum:${payee}?value=${amountWei.toString()}`;
        }
        const base = appConfig.publicBaseUrl || '';
        const scanUrl = `https://scan.request.network/request/${id}`;
        const qrPayload = ethUri || payUrl; // prefer wallet-pay if available, otherwise app link
        const qrApi = `${baseUrl.replace(/\/$/, '')}/api/qr`;
        const qrUrl = `${qrApi}?size=720&data=${encodeURIComponent(qrPayload)}&logo=/phone-logo-no-bg.png&bg=%23F8F6FF&grad1=%237C3AED&grad2=%23C026D3&footerH=180&wordmark=/Dial.letters.transparent.bg.crop.png`;
        const caption = `Request: $${amt.toFixed(2)}${note ? ` — ${note}` : ''}`;
        // Buttons: Only https URLs (Telegram rejects ethereum: links in buttons)
        const topRow: any[] = [{ text: 'Open invoice', url: payUrl }];
        if (ethUri) topRow.push({ text: 'Pay in wallet', url: `${baseUrl.replace(/\/$/, '')}/paylink?uri=${encodeURIComponent(ethUri)}` });
        const scanRow: any[] = [{ text: 'View on Request Scan', url: scanUrl }];
        const statusRow: any[] = [{ text: 'Status: Pending', callback_data: 'status_pending', sticker: 'ABCEmoji' }];
        const keyboard = { inline_keyboard: [topRow, scanRow, statusRow] } as any;
        const sent = await tg.sendPhoto(chatId, qrUrl, caption, keyboard);

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
                await tg.editCaption(chatId, messageId, paidCaption, keyboard);
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


