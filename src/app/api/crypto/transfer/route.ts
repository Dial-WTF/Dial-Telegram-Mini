import { NextRequest, NextResponse } from 'next/server';
import { TransferRequest, CryptoTransfer } from '#/types/crypto';
import {
  generateTransferId,
  isValidAsset,
  isValidAddress,
  getCaip2ForAsset,
  getAssetEmoji,
  parseAmountToWei,
  getTokenAddress,
  getChainForAsset,
  isNativeCurrency,
} from '#/lib/crypto-utils';

// In-memory storage
const transfers = new Map<string, CryptoTransfer>();
const spendIds = new Set<string>();

export const runtime = 'nodejs';

// Lazy-initialize Privy client
async function getPrivyClient() {
  if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) return null;
  try {
    const mod = await import('@privy-io/node');
    const client = new (mod as any).PrivyClient({
      appId: process.env.PRIVY_APP_ID as string,
      appSecret: process.env.PRIVY_APP_SECRET as string,
    });
    return client;
  } catch {
    return null;
  }
}

// POST /api/crypto/transfer - Send crypto to user
export async function POST(req: NextRequest) {
  try {
    const body: TransferRequest = await req.json();

    // Validate required fields
    if (!body.user_id || !body.asset || !body.amount || !body.spend_id) {
      return NextResponse.json(
        { ok: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check spend_id uniqueness
    if (spendIds.has(body.spend_id)) {
      return NextResponse.json(
        { ok: false, error: 'Duplicate spend_id' },
        { status: 400 }
      );
    }

    // Validate asset
    if (!isValidAsset(body.asset)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid asset' },
        { status: 400 }
      );
    }

    // Validate amount
    const amount = parseFloat(String(body.amount));
    if (amount <= 0) {
      return NextResponse.json(
        { ok: false, error: 'Invalid amount' },
        { status: 400 }
      );
    }

    // Get Privy client
    const privy = await getPrivyClient();
    if (!privy) {
      return NextResponse.json(
        { ok: false, error: 'Payment system not configured' },
        { status: 500 }
      );
    }

    // Get recipient's wallet
    let toAddress = body.to_address;
    if (!toAddress) {
      try {
        const user = await privy.users().getByTelegramUserID({ telegram_user_id: body.user_id });
        const wallet = user.linked_accounts.find((a: any) => a.type === 'wallet' && 'address' in a);
        toAddress = (wallet as any)?.address;
      } catch (error: any) {
        return NextResponse.json(
          { ok: false, error: 'User wallet not found' },
          { status: 404 }
        );
      }
    }

    if (!toAddress || !isValidAddress(toAddress)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid recipient address' },
        { status: 400 }
      );
    }

    // Get sender's wallet (app wallet)
    const senderWalletId = process.env.APP_WALLET_ID;
    if (!senderWalletId) {
      return NextResponse.json(
        { ok: false, error: 'App wallet not configured' },
        { status: 500 }
      );
    }

    // Generate transfer ID
    const id = generateTransferId();
    const now = Date.now();

    // Prepare transaction
    const chain = getChainForAsset(body.asset);
    const caip2 = getCaip2ForAsset(body.asset);
    const isNative = isNativeCurrency(body.asset, chain);
    const amountWei = parseAmountToWei(amount, 18);

    let txHash: string | undefined;

    try {
      if (isNative) {
        // Send native currency
        const result = await privy.wallets().ethereum().sendTransaction(senderWalletId, {
          caip2,
          params: {
            transaction: {
              to: toAddress,
              value: '0x' + amountWei.toString(16),
            },
          },
        });
        txHash = (result as any)?.hash;
      } else {
        // Send ERC20 token
        const tokenAddress = getTokenAddress(body.asset, chain);
        if (!tokenAddress) {
          return NextResponse.json(
            { ok: false, error: 'Token not supported on this chain' },
            { status: 400 }
          );
        }

        // ERC20 transfer function signature
        const transferData = `0xa9059cbb${toAddress.slice(2).padStart(64, '0')}${amountWei.toString(16).padStart(64, '0')}`;

        const result = await privy.wallets().ethereum().sendTransaction(senderWalletId, {
          caip2,
          params: {
            transaction: {
              to: tokenAddress,
              data: transferData,
            },
          },
        });
        txHash = (result as any)?.hash;
      }

      // Create transfer record
      const transfer: CryptoTransfer = {
        id,
        user_id: body.user_id,
        asset: body.asset,
        amount: String(amount),
        network: body.network || 'BASE',
        status: 'completed',
        comment: body.comment,
        created_at: now,
        completed_at: now,
        to_address: toAddress,
        tx_hash: txHash,
      };

      transfers.set(id, transfer);
      spendIds.add(body.spend_id);

      // Send notification if enabled
      if (!body.disable_send_notification) {
        try {
          const botToken = process.env.BOT_TOKEN;
          if (botToken) {
            const emoji = getAssetEmoji(body.asset);
            const message = `${emoji} You received ${amount} ${body.asset}${body.comment ? `\n\n${body.comment}` : ''}`;
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: body.user_id,
                text: message,
              }),
            });
          }
        } catch {
          // Ignore notification errors
        }
      }

      return NextResponse.json({
        ok: true,
        result: transfer,
      });
    } catch (error: any) {
      // Create failed transfer record
      const transfer: CryptoTransfer = {
        id,
        user_id: body.user_id,
        asset: body.asset,
        amount: String(amount),
        network: body.network || 'BASE',
        status: 'failed',
        comment: body.comment,
        created_at: now,
        to_address: toAddress,
      };

      transfers.set(id, transfer);

      return NextResponse.json(
        { ok: false, error: error?.message || 'Transfer failed' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to process transfer' },
      { status: 500 }
    );
  }
}

// GET /api/crypto/transfer - List transfers
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const asset = searchParams.get('asset');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    let filtered = Array.from(transfers.values());

    if (asset && isValidAsset(asset)) {
      filtered = filtered.filter(t => t.asset === asset);
    }

    const paginated = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      ok: true,
      result: paginated,
      total: filtered.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to fetch transfers' },
      { status: 500 }
    );
  }
}
