import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';

// Minimal MoonPay signed URL generator for widget
export async function GET(req: NextRequest) {
  const apiKey = process.env.NEXT_PUBLIC_MOONPAY_KEY;
  const secret = process.env.MOONPAY_SECRET_KEY;
  const defaultCurrencyCode = process.env.MOONPAY_DEFAULT_CURRENCY_CODE || 'usdc';
  const defaultBaseCurrencyCode = process.env.MOONPAY_DEFAULT_BASE_CURRENCY || 'usd';
  const walletAddress = req.nextUrl.searchParams.get('walletAddress') || '';

  if (!apiKey || !secret) {
    return NextResponse.json({ error: 'MoonPay keys not configured' }, { status: 400 });
  }

  const base = 'https://buy.moonpay.com/';
  const url = new URL(base);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('currencyCode', defaultCurrencyCode);
  url.searchParams.set('baseCurrencyCode', defaultBaseCurrencyCode);
  if (walletAddress) url.searchParams.set('walletAddress', walletAddress);
  url.searchParams.set('enableRecurringBuys', 'false');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(url.search)
    .digest('base64');

  url.searchParams.set('signature', signature);
  return NextResponse.redirect(url.toString());
}


