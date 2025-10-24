/**
 * Format ETH amount with 6 decimal places (rounded up)
 * @param wei - Amount in wei (bigint)
 * @returns Formatted ETH string like "0.123456"
 */
export function formatEth(wei: bigint): string {
  // Ceil to 6 decimals: ceil(wei / 1e12) gives micro-ETH units
  const MICRO_ETH = 1_000_000n; // 1e6
  const WEI_PER_MICRO_ETH = 1_000_000_000_000n; // 1e12
  const microEth = (wei + (WEI_PER_MICRO_ETH - 1n)) / WEI_PER_MICRO_ETH;
  const intPart = microEth / MICRO_ETH;
  const fracPart = microEth % MICRO_ETH;
  return `${intPart}.${fracPart.toString().padStart(6, "0")}`;
}

/**
 * Format ETH amount from wei for display (trimmed trailing zeros)
 * @param wei - Amount in wei (bigint)
 * @returns Formatted ETH string like "0.1234" (trimmed)
 */
export function formatEthTrimmed(wei: bigint): string {
  const full = formatEth(wei);
  // Remove trailing zeros after decimal
  return full.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/**
 * Rich caption for payment requests (ETH-only)
 * @param params - Caption parameters
 * @returns Formatted caption string
 */
export function formatCaptionRich(params: {
  username?: string;
  ethWei: bigint;
  networkName?: string;
  note?: string;
}): string {
  const ethPretty = formatEthTrimmed(params.ethWei);
  const net = (params.networkName || "mainnet").toLowerCase();
  const netLabel = net === "1" || net === "mainnet" ? "mainnet" : net;
  const who = params.username ? `@${params.username} requests` : "Request:";

  let lines = `${who}\n${ethPretty} ETH (${netLabel})`;
  if (params.note) lines += `\nFor: ${params.note}`;
  return lines;
}

/**
 * Simple caption for payment requests (back-compat)
 * @param ethWei - Amount in wei (bigint)
 * @param note - Optional note
 * @returns Formatted caption string
 */
export function formatCaption(ethWei: bigint, note?: string): string {
  const ethPretty = formatEthTrimmed(ethWei);
  return `Request: ${ethPretty} ETH${note ? ` — ${note}` : ""}`;
}
