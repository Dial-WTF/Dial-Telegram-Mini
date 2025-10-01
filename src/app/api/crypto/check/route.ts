import { NextRequest, NextResponse } from 'next/server';
import { CreateCheckRequest, CryptoCheck } from '@/types/crypto';
import {
  generateCheckId,
  isValidAsset,
  getAssetEmoji,
} from '@/lib/crypto-utils';

// In-memory storage
const checks = new Map<string, CryptoCheck>();

export const runtime = 'nodejs';

// POST /api/crypto/check - Create check/voucher
export async function POST(req: NextRequest) {
  try {
    const body: CreateCheckRequest = await req.json();

    // Validate required fields
    if (!body.asset || !body.amount) {
      return NextResponse.json(
        { ok: false, error: 'Missing required fields' },
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

    // Generate check
    const id = generateCheckId();
    const now = Date.now();
    const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
    const checkUrl = `${baseUrl}/crypto/check/${id}`;

    const check: CryptoCheck = {
      id,
      asset: body.asset,
      amount: String(amount),
      network: body.network || 'BASE',
      status: 'active',
      created_at: now,
      pin_to_user_id: body.pin_to_user_id,
      pin_to_username: body.pin_to_username,
      check_url: checkUrl,
    };

    checks.set(id, check);

    return NextResponse.json({
      ok: true,
      result: check,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to create check' },
      { status: 500 }
    );
  }
}

// GET /api/crypto/check - List checks
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const asset = searchParams.get('asset');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    let filtered = Array.from(checks.values());

    if (asset && isValidAsset(asset)) {
      filtered = filtered.filter(c => c.asset === asset);
    }

    if (status) {
      filtered = filtered.filter(c => c.status === status);
    }

    const paginated = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      ok: true,
      result: paginated,
      total: filtered.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to fetch checks' },
      { status: 500 }
    );
  }
}

// DELETE /api/crypto/check - Delete check
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const checkId = searchParams.get('check_id');

    if (!checkId) {
      return NextResponse.json(
        { ok: false, error: 'Missing check_id' },
        { status: 400 }
      );
    }

    const deleted = checks.delete(checkId);

    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: 'Check not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      result: true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to delete check' },
      { status: 500 }
    );
  }
}
