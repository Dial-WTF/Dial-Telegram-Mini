import { NextRequest, NextResponse } from 'next/server';
import { CreateInvoiceRequest, CryptoInvoice } from '@/types/crypto';
import {
  generateInvoiceId,
  isValidAsset,
  isValidFiat,
  calculateExpiry,
  getAssetEmoji,
} from '@/lib/crypto-utils';

// In-memory storage (replace with database in production)
const invoices = new Map<string, CryptoInvoice>();

export const runtime = 'nodejs';

// GET /api/crypto/invoice - List invoices
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const asset = searchParams.get('asset');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    let filtered = Array.from(invoices.values());

    if (asset && isValidAsset(asset)) {
      filtered = filtered.filter(inv => inv.asset === asset);
    }

    if (status) {
      filtered = filtered.filter(inv => inv.status === status);
    }

    const paginated = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      ok: true,
      result: paginated,
      total: filtered.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to fetch invoices' },
      { status: 500 }
    );
  }
}

// POST /api/crypto/invoice - Create invoice
export async function POST(req: NextRequest) {
  try {
    const body: CreateInvoiceRequest = await req.json();

    // Validate required fields
    if (!body.amount || parseFloat(String(body.amount)) <= 0) {
      return NextResponse.json(
        { ok: false, error: 'Invalid amount' },
        { status: 400 }
      );
    }

    const currencyType = body.currency_type || 'crypto';

    // Validate currency
    if (currencyType === 'crypto') {
      if (!body.asset || !isValidAsset(body.asset)) {
        return NextResponse.json(
          { ok: false, error: 'Invalid or missing asset for crypto payment' },
          { status: 400 }
        );
      }
    } else if (currencyType === 'fiat') {
      if (!body.fiat || !isValidFiat(body.fiat)) {
        return NextResponse.json(
          { ok: false, error: 'Invalid or missing fiat currency' },
          { status: 400 }
        );
      }
    }

    // Generate invoice
    const id = generateInvoiceId();
    const now = Date.now();
    const expiresAt = calculateExpiry(body.expires_in);

    const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
    const payUrl = `${baseUrl}/crypto/pay/${id}`;

    const invoice: CryptoInvoice = {
      id,
      status: 'active',
      currency_type: currencyType,
      asset: body.asset,
      fiat: body.fiat,
      amount: String(body.amount),
      network: body.network || 'BASE',
      accepted_assets: body.accepted_assets,
      description: body.description,
      hidden_message: body.hidden_message,
      paid_btn_name: body.paid_btn_name,
      paid_btn_url: body.paid_btn_url,
      payload: body.payload,
      allow_comments: body.allow_comments !== false,
      allow_anonymous: body.allow_anonymous !== false,
      created_at: now,
      expires_at: expiresAt,
      pay_url: payUrl,
      payee_address: body.payee,
      telegram_user_id: body.telegram_user_id,
    };

    invoices.set(id, invoice);

    return NextResponse.json({
      ok: true,
      result: invoice,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to create invoice' },
      { status: 500 }
    );
  }
}

// DELETE /api/crypto/invoice - Delete invoice
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get('invoice_id');

    if (!invoiceId) {
      return NextResponse.json(
        { ok: false, error: 'Missing invoice_id' },
        { status: 400 }
      );
    }

    const deleted = invoices.delete(invoiceId);

    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: 'Invoice not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      result: true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to delete invoice' },
      { status: 500 }
    );
  }
}
