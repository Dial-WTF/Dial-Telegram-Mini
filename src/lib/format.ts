export function formatUsd(n: number): string {
  try {
    const roundedUp = Math.ceil(n * 100) / 100;
    return `$${roundedUp.toFixed(2)}`;
  } catch {
    return `$${n}`;
  }
}

export function roundUpEth6DecimalsFromWei(wei: bigint): string {
  // Ceil to 6 decimals: ceil(wei / 1e12) gives micro-ETH units
  const MICRO_ETH = 1_000_000n; // 1e6
  const WEI_PER_MICRO_ETH = 1_000_000_000_000n; // 1e12
  const microEth = (wei + (WEI_PER_MICRO_ETH - 1n)) / WEI_PER_MICRO_ETH;
  const intPart = microEth / MICRO_ETH;
  const fracPart = microEth % MICRO_ETH;
  return `${intPart}.${fracPart.toString().padStart(6, '0')}`;
}

export function formatCaptionRich(params: { username?: string; usdAmount: number; ethWei?: bigint; networkName?: string; note?: string; }): string {
  const usd = formatUsd(params.usdAmount);
  const net = (params.networkName || 'mainnet').toLowerCase();
  const netLabel = net === '1' || net === 'mainnet' ? 'mainnet' : net;
  const ethPretty = typeof params.ethWei === 'bigint' ? roundUpEth6DecimalsFromWei(params.ethWei) : '';
  const who = params.username ? `@${params.username} requests` : 'Request:';
  let lines = `${who}\n${usd} USD in ETH (${netLabel})`;
  if (ethPretty) lines += `\nor ${ethPretty} ETH`;
  if (params.note) lines += `\nFor: \n${params.note}`;
  return lines;
}

// Back-compat for existing callers (qrUi.ts). Simple "Request: $X.XX — note" caption.
export function formatCaption(amount: number, note?: string): string {
  const a = formatUsd(amount);
  return `Request: ${a}${note ? ` — ${note}` : ''}`;
}


