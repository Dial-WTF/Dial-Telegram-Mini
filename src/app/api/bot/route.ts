import { NextRequest, NextResponse } from 'next/server';
import { appConfig } from '#/lib/config';
import { parseEther, Interface } from 'ethers';
import { parseRequest } from '#/lib/parse';
import { isValidHexAddress, normalizeHexAddress, resolveEnsToHex } from '#/lib/addr';
import { tg } from '#/lib/telegram';
import { fetchPayCalldata, extractForwarderInputs } from '#/lib/requestApi';
import { bpsToPercentString } from '#/lib/fees';
import { buildEthereumUri, decodeProxyDataAndValidateValue } from '#/lib/ethUri';
import { buildPredictTenderlyInput, predictDestinationTenderly, createIncomingPaymentAlert } from '#/lib/tenderlyApi';
  import { createAddressActivityWebhook, updateWebhookAddresses } from '#/lib/alchemyWebhooks';
import ForwarderArtifact from '#/lib/contracts/DepositForwarderMinimal/DepositForwarderMinimal.json';
import { keccak256, toHex } from 'viem';
import { estimateGasAndPrice } from '#/lib/gas';
import { buildQrForRequest } from '#/lib/qrUi';
import { isValidEthereumAddress } from '#/lib/utils';
import { requestContextById, predictContextByAddress } from '#/lib/mem';
import { writeFile as writeS3File } from '#/services/s3/actions/writeFile';
import { PATH_INVOICES } from '#/services/s3/filepaths';

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
        const id = json.requestId || json.requestID || json.id;
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

    if (/^\/start\b/.test(text)) {
      await reply('💎 Dial Crypto Pay Bot\n\n💰 Payments:\n/invoice <amount> <asset> - Create invoice\n/send <user> <amount> <asset> - Send crypto\n/check <amount> <asset> - Create voucher\n/balance - View balance\n\n🎉 Party Lines:\n/startparty - Create party\n/listparty - List parties\n/findparty <keyword> - Search\n\nAssets: USDT, USDC, ETH, BTC, TON, BNB, SOL');
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

    // /findparty <keyword> - Search for a party room by keyword (name, room code, owner, or contract address)
    if (/^\/findparty\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const searchQuery = parts.slice(1).join(' ').trim();

      if (!searchQuery) {
        await reply('Usage: /findparty <keyword>\n\nSearch by party name, room code, owner address, or contract address');
        return NextResponse.json({ ok: true });
      }

      const apiKey = process.env.PUBLIC_API_KEY_TELEGRAM;
      if (!apiKey) {
        await reply('Server missing PUBLIC_API_KEY_TELEGRAM');
        return NextResponse.json({ ok: false }, { status: 200 });
      }

      try {
        // Use the API's search parameter for server-side filtering
        const searchUrl = `https://staging.dial.wtf/api/v1/party-lines?search=${encodeURIComponent(searchQuery)}&isActive=true&limit=50`;
        const response = await fetch(searchUrl, {
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

        const apiResponse = await response.json();
        const partyLines = apiResponse?.data?.partyLines || [];

        if (partyLines.length === 0) {
          await reply(`No party rooms found matching: "${searchQuery}"\n\nTry searching by party name, room code, owner address, or contract address`);
          return NextResponse.json({ ok: true, data: [] });
        }

        let message = `🔍 Found ${partyLines.length} matching party room${partyLines.length > 1 ? 's' : ''}:\n\n`;
        partyLines.slice(0, 5).forEach((party: any, idx: number) => {
          const name = party.name || party.roomCode || 'Unnamed';
          const roomCode = party.roomCode || 'N/A';
          const owner = party.owner || 'Unknown';
          const contractAddr = party.contractAddress || party.address || 'N/A';
          const joinUrl = party.joinUrl ? party.joinUrl.replace('https://dial.wtf/', 'https://staging.dial.wtf/') : '';
          
          message += `${idx + 1}. ${name}\n`;
          if (party.name && party.roomCode) message += `   Code: ${roomCode}\n`;
          message += `   Owner: ${owner.slice(0, 10)}...${owner.slice(-6)}\n`;
          if (contractAddr !== 'N/A') message += `   Contract: ${contractAddr.slice(0, 10)}...${contractAddr.slice(-6)}\n`;
          message += `   ${joinUrl}\n\n`;
        });

        if (partyLines.length > 5) {
          message += `\n...and ${partyLines.length - 5} more`;
        }

        await reply(message);
        return NextResponse.json({ ok: true, data: partyLines });
      } catch (err: any) {
        await reply(`Error searching party rooms: ${err?.message || 'unknown'}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /invoice <amount> <asset> [description] - Create crypto invoice
    if (/^\/invoice\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const amount = parseFloat(parts[1] || '0');
      const asset = (parts[2] || 'USDC').toUpperCase();
      const description = parts.slice(3).join(' ') || undefined;

      if (!amount || amount <= 0) {
        await reply('Usage: /invoice <amount> <asset> [description]\n\nExample: /invoice 10 USDC Payment for service\n\nAssets: USDT, USDC, ETH, BTC, TON, BNB, SOL');
        return NextResponse.json({ ok: true });
      }

      const validAssets = ['USDT', 'USDC', 'ETH', 'BTC', 'TON', 'BNB', 'TRX', 'LTC', 'SOL'];
      if (!validAssets.includes(asset)) {
        await reply(`Invalid asset: ${asset}\n\nSupported: ${validAssets.join(', ')}`);
        return NextResponse.json({ ok: true });
      }

      try {
        let payee: string | undefined;
        try {
          const privy = await getPrivyClient();
          if (privy) {
            const user = await privy.users().getByTelegramUserID({ telegram_user_id: tgUserId });
            const w = (user.linked_accounts || []).find((a: any) => a.type === 'wallet' && typeof (a as any).address === 'string');
            payee = (w as any)?.address as string | undefined;
          }
        } catch {}

        if (!payee) {
          const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
          await reply('No wallet connected. Open the app to connect your wallet first.');
          return NextResponse.json({ ok: true });
        }

        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const res = await fetch(`${baseUrl}/api/crypto/invoice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currency_type: 'crypto',
            asset,
            amount: String(amount),
            description,
            payee,
            telegram_user_id: tgUserId,
          }),
        });

        const data = await res.json();
        if (!data.ok || !data.result) {
          await reply(`Failed to create invoice: ${data.error || 'unknown error'}`);
          return NextResponse.json({ ok: false });
        }

        const invoice = data.result;
        const assetEmojis: any = { USDT: '💵', USDC: '💵', ETH: 'Ξ', BTC: '₿', TON: '💎', BNB: '🔶', SOL: '◎', TRX: '🔺', LTC: 'Ł' };
        const emoji = assetEmojis[asset] || '💰';
        const message = `${emoji} Invoice Created\n\nAmount: ${amount} ${asset}\n${description ? `Description: ${description}\n` : ''}Status: Active`;
        
        const keyboard = {
          inline_keyboard: [[
            { text: 'Pay Invoice', url: invoice.pay_url }
          ]]
        };

        await tgCall('sendMessage', { chat_id: chatId, text: message, reply_markup: keyboard });
        return NextResponse.json({ ok: true, result: invoice });
      } catch (err: any) {
        await reply(`Error creating invoice: ${err?.message || 'unknown'}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /send <user_id|@username> <amount> <asset> [comment] - Send crypto
    if (/^\/send\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const userTarget = parts[1];
      const amount = parseFloat(parts[2] || '0');
      const asset = (parts[3] || 'USDC').toUpperCase();
      const comment = parts.slice(4).join(' ') || undefined;

      if (!userTarget || !amount || amount <= 0) {
        await reply('Usage: /send <user_id|@username> <amount> <asset> [comment]\n\nExample: /send @john 5 USDC Thanks!\n\nAssets: USDT, USDC, ETH, BTC, TON, BNB, SOL');
        return NextResponse.json({ ok: true });
      }

      const validAssets = ['USDT', 'USDC', 'ETH', 'BTC', 'TON', 'BNB', 'TRX', 'LTC', 'SOL'];
      if (!validAssets.includes(asset)) {
        await reply(`Invalid asset: ${asset}\n\nSupported: ${validAssets.join(', ')}`);
        return NextResponse.json({ ok: true });
      }

      const targetUserId = userTarget.startsWith('@') ? null : parseInt(userTarget);
      if (!targetUserId && !userTarget.startsWith('@')) {
        await reply('Invalid user. Use user ID or @username');
        return NextResponse.json({ ok: true });
      }

      try {
        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const spendId = `spend_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
        
        const res = await fetch(`${baseUrl}/api/crypto/transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: targetUserId || 0,
            asset,
            amount: String(amount),
            spend_id: spendId,
            comment,
          }),
        });

        const data = await res.json();
        if (!data.ok || !data.result) {
          await reply(`Failed to send: ${data.error || 'unknown error'}`);
          return NextResponse.json({ ok: false });
        }

        const transfer = data.result;
        const assetEmojis: any = { USDT: '💵', USDC: '💵', ETH: 'Ξ', BTC: '₿', TON: '💎', BNB: '🔶', SOL: '◎', TRX: '🔺', LTC: 'Ł' };
        const emoji = assetEmojis[asset] || '💰';
        await reply(`✅ ${emoji} Sent ${amount} ${asset} to ${userTarget}${comment ? `\n\n"${comment}"` : ''}`);
        return NextResponse.json({ ok: true, result: transfer });
      } catch (err: any) {
        await reply(`Error sending: ${err?.message || 'unknown'}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /check <amount> <asset> [pin_to_user] - Create crypto voucher
    if (/^\/check\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const amount = parseFloat(parts[1] || '0');
      const asset = (parts[2] || 'USDC').toUpperCase();
      const pinTo = parts[3];

      if (!amount || amount <= 0) {
        await reply('Usage: /check <amount> <asset> [pin_to_user]\n\nExample: /check 10 USDC @john\n\nAssets: USDT, USDC, ETH, BTC, TON, BNB, SOL');
        return NextResponse.json({ ok: true });
      }

      const validAssets = ['USDT', 'USDC', 'ETH', 'BTC', 'TON', 'BNB', 'TRX', 'LTC', 'SOL'];
      if (!validAssets.includes(asset)) {
        await reply(`Invalid asset: ${asset}\n\nSupported: ${validAssets.join(', ')}`);
        return NextResponse.json({ ok: true });
      }

      try {
        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const payload: any = { asset, amount: String(amount) };
        
        if (pinTo) {
          if (pinTo.startsWith('@')) {
            payload.pin_to_username = pinTo.substring(1);
          } else {
            payload.pin_to_user_id = parseInt(pinTo);
          }
        }

        const res = await fetch(`${baseUrl}/api/crypto/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!data.ok || !data.result) {
          await reply(`Failed to create check: ${data.error || 'unknown error'}`);
          return NextResponse.json({ ok: false });
        }

        const check = data.result;
        const assetEmojis: any = { USDT: '💵', USDC: '💵', ETH: 'Ξ', BTC: '₿', TON: '💎', BNB: '🔶', SOL: '◎', TRX: '🔺', LTC: 'Ł' };
        const emoji = assetEmojis[asset] || '💰';
        const message = `🎁 ${emoji} Crypto Check Created\n\nAmount: ${amount} ${asset}\n${pinTo ? `Pinned to: ${pinTo}\n` : ''}Status: Active`;
        
        const keyboard = {
          inline_keyboard: [[
            { text: 'Claim Check', url: check.check_url }
          ]]
        };

        await tgCall('sendMessage', { chat_id: chatId, text: message, reply_markup: keyboard });
        return NextResponse.json({ ok: true, result: check });
      } catch (err: any) {
        await reply(`Error creating check: ${err?.message || 'unknown'}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /balance - View wallet balance
    if (/^\/balance\b/i.test(text)) {
      try {
        let walletAddr: string | undefined;
        try {
          const privy = await getPrivyClient();
          if (privy) {
            const user = await privy.users().getByTelegramUserID({ telegram_user_id: tgUserId });
            const w = (user.linked_accounts || []).find((a: any) => a.type === 'wallet' && typeof (a as any).address === 'string');
            walletAddr = (w as any)?.address as string | undefined;
          }
        } catch {}

        if (!walletAddr) {
          await reply('No wallet connected. Open the app to connect your wallet first.');
          return NextResponse.json({ ok: true });
        }

        await reply(`💰 Your Wallet\n\nAddress: ${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}\n\nConnect your wallet in the app to view balances and manage crypto payments.`);
        return NextResponse.json({ ok: true });
      } catch (err: any) {
        await reply(`Error: ${err?.message || 'unknown'}`);
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

        let rest: Response;
        try {
          if (DEBUG) {
            try { console.log('[BOT]/request -> POST', `${apiBase}/api/invoice`, { payee, amount: Number(amt), note }); } catch {}
          }
          rest = await fetch(`${apiBase}/api/invoice`, {
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
        } catch (err: any) {
          if (DEBUG) { try { console.warn('[BOT]/request fetch /api/invoice failed:', err?.message || err); } catch {} }
          throw err;
        }
        if (!rest.ok) {
          const t = await rest.text().catch(() => '');
          if (DEBUG) { try { console.warn('[BOT]/request invoice non-OK:', rest.status, rest.statusText, t.slice(0, 300)); } catch {} }
          await reply(`Failed to create invoice: ${rest.status} ${rest.statusText}`);
          return NextResponse.json({ ok: true, error: t });
        }
        const json = await rest.json().catch(() => ({} as any));
        if (DEBUG) { try { console.log('[BOT]/request invoice OK response keys:', Object.keys(json || {})); } catch {} }
        const id = json.requestId || json.requestID || json.id;
        if (!id) {
          await reply('Invoice created but id missing');
          return NextResponse.json({ ok: true });
        }
        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const invUrl = `${baseUrl}/pay/${id}`;

        // Build QR using forwarder prediction (Create2) for improved wallet compatibility
        let ethUri: string | undefined;
        try {
          const feeAddress = process.env.FEE_ADDRESS || appConfig.feeAddr || undefined;
          const feePercentage = feeAddress ? bpsToPercentString(process.env.FEE_BPS || '50') : undefined;
          if (DEBUG) { try { console.log('[BOT]/request fetching pay calldata for id=', id); } catch {} }
          const payJson = await fetchPayCalldata(id, { feeAddress, feePercentage, apiKey: appConfig.request.apiKey || process.env.REQUEST_API_KEY });
          if (DEBUG) { try { console.log('[BOT]/request pay transactions:', Array.isArray((payJson as any)?.transactions) ? (payJson as any).transactions.length : 0); } catch {} }
          const fwd = extractForwarderInputs(payJson);
          if (DEBUG) { try { console.log('[BOT]/request forwarder inputs:', { proxy: fwd.requestProxy, to: fwd.beneficiary, feeAddress: fwd.feeAddress, feeAmountWei: String(fwd.feeAmountWei), hasAmount: typeof fwd.amountWei === 'bigint' }); } catch {} }

          // Compute network id and CreateX config
          const chainKey = String(appConfig.request.chain || '').toLowerCase();
          const NETWORK_ID_BY_CHAIN: Record<string, string> = { base: '8453', ethereum: '1', mainnet: '1', sepolia: '11155111' };
          const networkId = process.env.TENDERLY_NETWORK_ID || NETWORK_ID_BY_CHAIN[chainKey] || '1';
          const createx = (process.env.CREATEX_ADDRESS || process.env.CREATE_X || '').trim() as `0x${string}`;
          const from = (process.env.TENDERLY_FROM || process.env.CREATEX_FROM || '').trim() as `0x${string}`;
          if (!/^0x[0-9a-fA-F]{40}$/.test(createx)) throw new Error('Missing CREATEX_ADDRESS');
          if (!/^0x[0-9a-fA-F]{40}$/.test(from)) throw new Error('Missing TENDERLY_FROM');

          // Salt ties deposit address to request id and chain
          const salt = keccak256(toHex(`DIAL|${id}|${networkId}`)) as `0x${string}`;
          const predictInput = buildPredictTenderlyInput({
            networkId,
            createx,
            from,
            requestProxy: fwd.requestProxy,
            beneficiary: fwd.beneficiary,
            paymentReferenceHex: fwd.paymentReferenceHex,
            feeAmountWei: fwd.feeAmountWei,
            feeAddress: fwd.feeAddress,
            salt,
            artifact: { bytecode: (ForwarderArtifact as any)?.bytecode as `0x${string}` },
          });
          if (DEBUG) { try { console.log('[BOT]/request predict input:', { networkId, createx, from, salt: predictInput.salt.slice(0,10)+'…', initCodeLen: predictInput.initCode.length }); } catch {} }
          const { predicted } = await predictDestinationTenderly(predictInput);
          if (DEBUG) { try { console.log('[BOT]/request predicted address:', predicted); } catch {} }
          if (predicted && fwd.amountWei && fwd.amountWei > 0n) {
            const decVal = fwd.amountWei.toString(10);
            // Save predict context for webhook
            try {
              predictContextByAddress.set(String(predicted).toLowerCase(), {
                networkId,
                createx,
                salt: predictInput.salt,
                initCode: predictInput.initCode,
                from,
              });
            } catch {}
            // Persist invoice metadata to S3 for later lookup by predicted address
            try {
              const tgUserName: string = (msg?.from?.username || '').toString();
              const lowerPred = String(predicted).toLowerCase();
              const fileName = `invoice-${lowerPred}-${tgUserName || 'anon'}-${id}.json`;
              const s3Key = `${PATH_INVOICES}${fileName}`;
              const scanUrl = `https://scan.request.network/request/${id}`;
              const chainIdNum = Number(networkId) || 1;
              const payUri = buildEthereumUri({ to: String(predicted), valueWeiDec: decVal, chainId: chainIdNum });
              const record = {
                requestId: id,
                networkId,
                predictedAddress: String(predicted),
                salt: predictInput.salt,
                initCode: predictInput.initCode,
                requestProxy: fwd.requestProxy,
                beneficiary: fwd.beneficiary,
                paymentReferenceHex: fwd.paymentReferenceHex,
                feeAmountWei: fwd.feeAmountWei.toString(),
                feeAddress: fwd.feeAddress,
                amountWei: decVal,
                ethereumUri: payUri,
                requestScanUrl: scanUrl,
                telegram: {
                  chatId,
                  chatType,
                  userId: tgUserId,
                  username: tgUserName || undefined,
                  commandText: text,
                },
                createdAt: new Date().toISOString(),
              } as const;
              const body = Buffer.from(JSON.stringify(record, null, 2));
              await writeS3File(s3Key, { Body: body, ContentType: 'application/json' });
              if (DEBUG) { try { console.log('[BOT]/request saved invoice json to S3:', s3Key); } catch {} }
            } catch (e) {
              if (DEBUG) { try { console.warn('[BOT]/request failed to save invoice S3:', (e as any)?.message || e); } catch {} }
            }
            // Register address activity on Alchemy webhook (create once, then update addresses)
            try {
              const alchemyWebhookId = process.env.ALCHEMY_WEBHOOK_ID;
              if (alchemyWebhookId) {
                await updateWebhookAddresses({ webhookId: alchemyWebhookId, add: [predicted as `0x${string}`], remove: [] });
                if (DEBUG) {
                  try { console.log('[BOT]/request alchemy: added address to webhook', { webhookId: alchemyWebhookId, address: predicted }); } catch {}
                }
              } else {
                const created = await createAddressActivityWebhook({ addresses: [predicted as `0x${string}`] });
                if (DEBUG) {
                  try { console.log('[BOT]/request alchemy: created webhook', created); } catch {}
                }
              }
            } catch (e) {
              if (DEBUG) { try { console.warn('[BOT] alchemy webhook setup failed', { error: (e as any)?.message || e }); } catch {} }
            }
            // Action registration temporarily disabled; focusing on alert only

            // Build direct ETH URI to pay predicted deposit address
            const chainIdNum = Number(networkId) || 1;
            ethUri = buildEthereumUri({ to: predicted, valueWeiDec: decVal, chainId: chainIdNum });
            if (DEBUG && ethUri) { try { console.log('[BOT] built ethUri (predict):', ethUri); } catch {} }
          }
        } catch (e) {
          if (DEBUG) { try { console.warn('[BOT] forwarder predict failed; fallback to invoice link', (e as any)?.message || e); } catch {} }
        }
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


