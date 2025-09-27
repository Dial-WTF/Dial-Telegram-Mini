import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Minimal Coinbase Onramp hosted URL generator
// Hosted URL expects: appId, addresses (JSON), assets, amount, fiatCurrency
// If your Coinbase app requires sessionToken, set COINBASE_SESSION_TOKEN or disable in the portal.
export async function GET(req: NextRequest) {
  const appId = process.env.NEXT_PUBLIC_COINBASE_APP_ID;
  const defaultAsset = (process.env.COINBASE_DEFAULT_ASSET || 'USDC').toUpperCase();
  const defaultFiat = process.env.COINBASE_DEFAULT_FIAT || 'USD';
  const defaultAmount = process.env.COINBASE_DEFAULT_FIAT_AMOUNT || '20';
  const sessionToken = process.env.COINBASE_SESSION_TOKEN;
  const walletAddress = req.nextUrl.searchParams.get('walletAddress') || '';

  if (!appId) {
    return NextResponse.json({ error: 'Coinbase appId not configured' }, { status: 400 });
  }

  // Build addresses param (replacement for deprecated destinationWallets)
  const isHexAddress = /^0x[a-fA-F0-9]{40}$/.test(walletAddress);
  const addresses = isHexAddress ? [{ address: walletAddress, blockchains: ['base'] }] : [];

  const url = new URL('https://pay.coinbase.com/buy');
  url.searchParams.set('appId', appId);
  if (addresses.length) url.searchParams.set('addresses', JSON.stringify(addresses));
  // Only set assets if it's a safe, known value. Otherwise let UI prompt.
  if (['USDC', 'ETH', 'BTC', 'SOL'].includes(defaultAsset)) {
    url.searchParams.set('assets', defaultAsset);
  }
  url.searchParams.set('fiatCurrency', defaultFiat);
  url.searchParams.set('amount', String(defaultAmount));
  // Optional: suggest card
  url.searchParams.set('paymentMethods', 'card');
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken);

  return NextResponse.redirect(url.toString());
}


