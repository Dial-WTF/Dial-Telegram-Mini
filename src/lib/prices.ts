export async function getEthUsdPrice(): Promise<number> {
  // Try Alchemy Prices API
  const alchemyKey = process.env.ALCHEMY_PRICE_API_KEY || process.env.ALCHEMY_API_KEY;
  if (alchemyKey) {
    try {
      const url = `https://api.g.alchemy.com/prices/v1/${alchemyKey}/tokens/by-symbol?symbols=ETH`;
      const r = await fetch(url, { method: 'GET' });
      if (r.ok) {
        const j = await r.json().catch(() => ({} as any));
        const prices: any[] = Array.isArray(j?.data) ? j.data[0]?.prices || [] : [];
        const usd = prices.find((p: any) => String(p?.currency || '').toUpperCase() === 'USD');
        const v = usd?.value ? Number(usd.value) : undefined;
        if (typeof v === 'number' && isFinite(v) && v > 0) return v;
      }
    } catch {}
  }
  // Try CoinMarketCap
  const cmcKey = process.env.CMC_API_KEY || process.env.CMC_PRO_API_KEY;
  if (cmcKey) {
    try {
      const url = 'https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=ETH&convert=USD';
      const r = await fetch(url, { headers: { 'X-CMC_PRO_API_KEY': cmcKey as string }});
      if (r.ok) {
        const j = await r.json().catch(() => ({} as any));
        const v = Number(j?.data?.ETH?.[0]?.quote?.USD?.price ?? j?.data?.ETH?.quote?.USD?.price);
        if (isFinite(v) && v > 0) return v;
      }
    } catch {}
  }
  // Fallback to Coingecko (public)
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    if (r.ok) {
      const j = await r.json();
      const v = Number(j?.ethereum?.usd);
      if (isFinite(v) && v > 0) return v;
    }
  } catch {}
  // Safe default if everything fails
  return 0;
}


