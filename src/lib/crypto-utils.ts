// Utility functions for crypto payment operations

import { SupportedAsset, SupportedFiat, CHAIN_CONFIGS, TOKEN_ADDRESSES } from '#/types/crypto';

// Supported chain IDs
export const SUPPORTED_CHAINS = {
  ETH: 1,
  BASE: 8453,
  BNB: 56,
  POLYGON: 137,
  ARBITRUM: 42161,
  OPTIMISM: 10,
  SOLANA: 0, // Solana - non-EVM
  BITCOIN: 0, // Bitcoin - non-EVM
  LIGHTNING: 0, // Lightning Network
  TON: 0, // TON - non-EVM
} as const;

// Generate unique invoice ID
export function generateInvoiceId(): string {
  return `inv_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// Generate unique transfer ID
export function generateTransferId(): string {
  return `txf_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// Generate unique check ID
export function generateCheckId(): string {
  return `chk_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// Get chain for asset
export function getChainForAsset(asset: string, network?: string): number | string {
  // If network is specified, use it
  if (network) {
    const chain = SUPPORTED_CHAINS[network as keyof typeof SUPPORTED_CHAINS];
    if (chain !== undefined) return chain;
    // For non-EVM chains, return the network name
    if (['SOLANA', 'BITCOIN', 'LIGHTNING'].includes(network.toUpperCase())) {
      return network.toUpperCase();
    }
  }
  
  // Otherwise infer from asset
  switch (asset.toUpperCase()) {
    case 'ETH':
      return SUPPORTED_CHAINS.ETH;
    case 'BNB':
      return SUPPORTED_CHAINS.BNB;
    case 'MATIC':
      return SUPPORTED_CHAINS.POLYGON;
    case 'SOL':
      return 'SOLANA';
    case 'BTC':
      return 'BITCOIN';
    default:
      return SUPPORTED_CHAINS.BASE; // Default to Base for stablecoins
  }
}

// Get token address for asset on specific chain
export function getTokenAddress(asset: SupportedAsset, chain: string | number): string | null {
  const chainKey = typeof chain === 'number' ? Object.keys(SUPPORTED_CHAINS).find(k => SUPPORTED_CHAINS[k as keyof typeof SUPPORTED_CHAINS] === chain) || String(chain) : chain;
  const addresses = TOKEN_ADDRESSES[asset];
  if (!addresses) return null;
  return addresses[chainKey] || null;
}

// Check if asset is native currency
export function isNativeCurrency(asset: SupportedAsset, chain: string | number): boolean {
  const addr = getTokenAddress(asset, chain);
  return addr === 'native';
}

// Format amount with proper decimals
export function formatAmount(amount: string | number, decimals: number = 18): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return num.toFixed(decimals);
}

// Parse amount to wei/smallest unit
export function parseAmountToWei(amount: string | number, decimals: number = 18): bigint {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  const multiplier = BigInt(10) ** BigInt(decimals);
  const integerPart = Math.floor(num);
  const decimalPart = num - integerPart;
  const integerWei = BigInt(integerPart) * multiplier;
  const decimalWei = BigInt(Math.floor(decimalPart * Number(multiplier)));
  return integerWei + decimalWei;
}

// Format wei to human-readable amount
export function formatWeiToAmount(wei: bigint | string, decimals: number = 18): string {
  const weiValue = typeof wei === 'string' ? BigInt(wei) : wei;
  const divisor = BigInt(10) ** BigInt(decimals);
  const integerPart = weiValue / divisor;
  const remainder = weiValue % divisor;
  const decimalPart = remainder.toString().padStart(decimals, '0');
  return `${integerPart}.${decimalPart}`;
}

// Validate asset
export function isValidAsset(asset: string): asset is SupportedAsset {
  const validAssets: SupportedAsset[] = ['USDT', 'TON', 'BTC', 'ETH', 'LTC', 'BNB', 'TRX', 'USDC', 'SOL'];
  return validAssets.includes(asset as SupportedAsset);
}

// Validate fiat
export function isValidFiat(fiat: string): fiat is SupportedFiat {
  const validFiats: SupportedFiat[] = ['USD', 'EUR', 'GBP', 'CNY', 'JPY', 'KRW', 'INR', 'BRL', 'RUB'];
  return validFiats.includes(fiat as SupportedFiat);
}

// Get asset emoji
export function getAssetEmoji(asset: SupportedAsset): string {
  const emojis: Record<SupportedAsset, string> = {
    USDT: '💵',
    USDC: '💵',
    TON: '💎',
    BTC: '₿',
    ETH: 'Ξ',
    LTC: 'Ł',
    BNB: '🔶',
    TRX: '🔺',
    SOL: '◎',
  };
  return emojis[asset] || '💰';
}

// Get chain ID for Privy
export function getChainIdForAsset(asset: SupportedAsset): number {
  const chain = getChainForAsset(asset);
  if (typeof chain === 'string') {
    const config = CHAIN_CONFIGS[chain];
    return config?.chainId || 1;
  }
  return chain; // Return the numeric chain ID directly
}

// Get CAIP-2 chain identifier for Privy
export function getCaip2ForAsset(asset: SupportedAsset): string {
  const chainId = getChainIdForAsset(asset);
  return `eip155:${chainId}`;
}

// Validate Ethereum address
export function isValidAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

// Get block explorer URL
export function getBlockExplorerUrl(asset: SupportedAsset, txHash: string): string | null {
  const chain = getChainForAsset(asset);
  if (typeof chain === 'number') return null;
  const config = CHAIN_CONFIGS[chain];
  if (!config?.blockExplorer) return null;
  return `${config.blockExplorer}/tx/${txHash}`;
}

// Calculate expiry timestamp
export function calculateExpiry(expiresIn?: number): number | undefined {
  if (!expiresIn) return undefined;
  return Date.now() + (expiresIn * 1000);
}

// Check if invoice is expired
export function isInvoiceExpired(expiresAt?: number): boolean {
  if (!expiresAt) return false;
  return Date.now() > expiresAt;
}

// Get asset display name
export function getAssetDisplayName(asset: SupportedAsset): string {
  const names: Record<SupportedAsset, string> = {
    USDT: 'Tether USD',
    USDC: 'USD Coin',
    TON: 'Toncoin',
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    LTC: 'Litecoin',
    BNB: 'BNB',
    TRX: 'TRON',
    SOL: 'Solana',
  };
  return names[asset] || asset;
}
