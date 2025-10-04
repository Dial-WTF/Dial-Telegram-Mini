// Crypto Pay-style types for multi-currency payment system

export type SupportedAsset = 'USDT' | 'TON' | 'BTC' | 'ETH' | 'LTC' | 'BNB' | 'TRX' | 'USDC' | 'SOL';
export type SupportedFiat = 'USD' | 'EUR' | 'GBP' | 'CNY' | 'JPY' | 'KRW' | 'INR' | 'BRL' | 'RUB';
export type SupportedNetwork = 'ETH' | 'BASE' | 'BNB' | 'POLYGON' | 'ARBITRUM' | 'OPTIMISM' | 'SOLANA' | 'BITCOIN' | 'LIGHTNING';
export type CurrencyType = 'crypto' | 'fiat';
export type InvoiceStatus = 'active' | 'paid' | 'expired' | 'cancelled';
export type PaidButtonName = 'viewItem' | 'openChannel' | 'openBot' | 'callback';

export interface CryptoInvoice {
  id: string;
  status: InvoiceStatus;
  currency_type: CurrencyType;
  asset?: SupportedAsset;
  fiat?: SupportedFiat;
  amount: string;
  network?: SupportedNetwork;
  accepted_assets?: SupportedAsset[];
  description?: string;
  hidden_message?: string;
  paid_btn_name?: PaidButtonName;
  paid_btn_url?: string;
  payload?: string;
  allow_comments: boolean;
  allow_anonymous: boolean;
  created_at: number;
  expires_at?: number;
  paid_at?: number;
  pay_url: string;
  // Privy-specific fields
  payee_address?: string;
  payer_address?: string;
  telegram_user_id?: number;
}

export interface CreateInvoiceRequest {
  currency_type?: CurrencyType;
  asset?: SupportedAsset;
  fiat?: SupportedFiat;
  network?: SupportedNetwork;
  accepted_assets?: SupportedAsset[];
  amount: string | number;
  description?: string;
  hidden_message?: string;
  paid_btn_name?: PaidButtonName;
  paid_btn_url?: string;
  payload?: string;
  allow_comments?: boolean;
  allow_anonymous?: boolean;
  expires_in?: number;
  // Privy integration
  payee?: string;
  telegram_user_id?: number;
}

export interface CryptoTransfer {
  id: string;
  user_id: number;
  asset: SupportedAsset;
  amount: string;
  network?: SupportedNetwork;
  status: 'completed' | 'pending' | 'failed';
  comment?: string;
  created_at: number;
  completed_at?: number;
  from_address?: string;
  to_address?: string;
  tx_hash?: string;
}

export interface TransferRequest {
  user_id: number;
  asset: SupportedAsset;
  amount: string | number;
  network?: SupportedNetwork;
  spend_id: string;
  comment?: string;
  disable_send_notification?: boolean;
  to_address?: string; // Privy wallet address
}

export interface CryptoCheck {
  id: string;
  asset: SupportedAsset;
  amount: string;
  network?: SupportedNetwork;
  status: 'active' | 'activated' | 'expired';
  created_at: number;
  activated_at?: number;
  pin_to_user_id?: number;
  pin_to_username?: string;
  check_url: string;
  creator_address?: string;
  activator_address?: string;
}

export interface CreateCheckRequest {
  asset: SupportedAsset;
  amount: string | number;
  network?: SupportedNetwork;
  pin_to_user_id?: number;
  pin_to_username?: string;
}

export interface ExchangeRate {
  source: string;
  target: string;
  rate: string;
}

export interface Balance {
  asset: SupportedAsset;
  available: string;
  locked?: string;
}

// Chain configuration for multi-currency support
export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorer?: string;
}

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  ETH: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: 'https://eth.llamarpc.com',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://etherscan.io',
  },
  BASE: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://basescan.org',
  },
  BNB: {
    chainId: 56,
    name: 'BNB Smart Chain',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    blockExplorer: 'https://bscscan.com',
  },
  POLYGON: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    blockExplorer: 'https://polygonscan.com',
  },
};

// Token addresses for stablecoins on different chains
export const TOKEN_ADDRESSES: Record<SupportedAsset, Record<string, string>> = {
  USDT: {
    ETH: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    BASE: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    BNB: '0x55d398326f99059fF775485246999027B3197955',
    POLYGON: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  USDC: {
    ETH: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    BASE: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    BNB: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    POLYGON: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
  ETH: {
    ETH: 'native',
    BASE: 'native',
  },
  BNB: {
    BNB: 'native',
  },
  TON: {},
  BTC: {},
  LTC: {},
  TRX: {},
  SOL: {},
};
