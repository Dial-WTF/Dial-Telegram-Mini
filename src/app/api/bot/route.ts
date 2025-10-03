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

    // Handle callback queries (inline button presses)
    const callbackQuery = body?.callback_query;
    if (callbackQuery) {
      const callbackData = callbackQuery.data;
      const callbackChatId = callbackQuery.message?.chat?.id;
      const callbackUserId = callbackQuery.from?.id;
      const callbackQueryId = callbackQuery.id;
      const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;

      // Answer callback query to remove loading state
      await tgCall('answerCallbackQuery', { callback_query_id: callbackQueryId });

      if (callbackData === 'quick_invoice') {
        const keyboard = {
          inline_keyboard: [
            [
              { text: '💵 5 USDC', callback_data: 'invoice_5_USDC' },
              { text: '💵 10 USDC', callback_data: 'invoice_10_USDC' }
            ],
            [
              { text: '💵 20 USDC', callback_data: 'invoice_20_USDC' },
              { text: '💵 50 USDC', callback_data: 'invoice_50_USDC' }
            ],
            [
              { text: '💰 Custom Amount', web_app: { url: baseUrl } }
            ]
          ]
        };
        await tgCall('sendMessage', {
          chat_id: callbackChatId,
          text: '📨 *Quick Invoice*\n\nSelect an amount to create an invoice:',
          reply_markup: keyboard,
          parse_mode: 'Markdown'
        });
      } else if (callbackData === 'quick_send') {
        await tgCall('sendMessage', {
          chat_id: callbackChatId,
          text: '⚡ *Quick Send*\n\nTo send crypto, use:\n`/send @username <amount> <asset>`\n\nExample:\n`/send @john 10 USDC`',
          parse_mode: 'Markdown'
        });
      } else if (callbackData === 'create_party') {
        await tgCall('sendMessage', {
          chat_id: callbackChatId,
          text: '🎉 *Create Party*\n\nTo create a party room, use:\n`/startparty`\n\nOr provide your wallet address:\n`/startparty 0xYourAddress`',
          parse_mode: 'Markdown'
        });
      } else if (callbackData === 'list_parties') {
        await tgCall('sendMessage', {
          chat_id: callbackChatId,
          text: '🔍 *Finding Parties*\n\n• List all parties: `/listparty`\n• Search parties: `/findparty <keyword>`\n\nExample:\n`/findparty room123`',
          parse_mode: 'Markdown'
        });
      } else if (callbackData === 'view_balance') {
        await tgCall('sendMessage', {
          chat_id: callbackChatId,
          text: '💳 *View Balance*\n\nUse `/balance` to view your wallet balance, or open the app to see detailed balances.',
          reply_markup: {
            inline_keyboard: [[{ text: '💰 Open Dial Pay', web_app: { url: baseUrl } }]]
          },
          parse_mode: 'Markdown'
        });
      } else if (callbackData === 'help') {
        const keyboard = {
          inline_keyboard: [
            [{ text: '💰 Open Dial Pay', web_app: { url: baseUrl } }]
          ]
        };
        await tgCall('sendMessage', {
          chat_id: callbackChatId,
          text: '❓ *Dial Pay Help*\n\n*💰 Payments:*\n• `/invoice <amount> <asset>` - Create invoice\n• `/send @user <amount> <asset>` - Send crypto\n• `/check <amount> <asset>` - Create voucher\n• `/balance` - View balance\n\n*🎉 Party Lines:*\n• `/startparty` - Create party\n• `/listparty` - List parties\n• `/findparty <keyword>` - Search\n\n*Assets:* USDT, USDC, ETH, BTC, TON, BNB, SOL',
          reply_markup: keyboard,
          parse_mode: 'Markdown'
        });
      } else if (callbackData && callbackData.startsWith('invoice_')) {
        // Handle quick invoice creation (e.g., invoice_10_USDC)
        const parts = callbackData.split('_');
        const amount = parts[1];
        const asset = parts[2] || 'USDC';

        await tgCall('sendMessage', {
          chat_id: callbackChatId,
          text: `Creating ${amount} ${asset} invoice...\n\nUse: \`/invoice ${amount} ${asset}\` to create it now!`,
          parse_mode: 'Markdown'
        });
      }

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

    if (/^\/start\b/.test(text)) {
      const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;

      const message = `💎 *Dial Crypto Pay Bot*\n\nWelcome to Dial Pay - the easiest way to send and receive crypto on Telegram.\n\n*Commands:*\n• \`/invoice <amount> <asset>\` - Create invoice\n• \`/send @user <amount> <asset>\` - Send crypto\n• \`/balance\` - View wallet\n• \`/startparty\` - Create party room\n• \`/listparty\` - Browse parties\n\n*Supported:* USDT, USDC, ETH, BTC, TON, BNB, SOL`;

      // In private chats, use web_app for native mini app experience
      // In groups, fall back to regular URL buttons
      const isPrivate = chatType === 'private';

      const keyboard = {
        inline_keyboard: [
          [
            isPrivate
              ? { text: '💰 Open Dial Pay', web_app: { url: baseUrl } }
              : { text: '💰 Open Dial Pay', url: baseUrl }
          ],
          [
            { text: '📨 Create Invoice', url: `${baseUrl}?action=invoice` },
            { text: '⚡ Send Payment', url: `${baseUrl}?action=send` }
          ],
          [
            { text: '🎉 Party Rooms', url: 'https://staging.dial.wtf' }
          ]
        ]
      };

      // Send photo with caption and inline keyboard
      const logoUrl = `${baseUrl}/phone.logo.no.bg.png`;
      const result = await tgCall('sendPhoto', {
        chat_id: chatId,
        photo: logoUrl,
        caption: message,
        reply_markup: keyboard,
        parse_mode: 'Markdown'
      });

      if (DEBUG && !result.ok) {
        await reply(`Debug: sendPhoto failed - ${JSON.stringify(result)}`);
      }

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


