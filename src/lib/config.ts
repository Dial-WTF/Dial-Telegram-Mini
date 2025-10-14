// Centralized, typed config with sensible defaults and helpers

export type AppConfig = {
  isProd: boolean;
  allowUnverifiedInitData: boolean;
  publicBaseUrl: string; // may be empty; use getPayUrl() helper
  payeeAddr?: string;
  feeAddr?: string;
  telegram: { botToken?: string };
  privy: { appId?: string };
  request: {
    apiKey?: string;
    restBase: string;
    nodeUrl: string;
    chain: string; // e.g., "base"
    erc20Address?: string; // if set, use addr; else defaultBaseUSDC
    defaultBaseUSDC: string;
  };
  getPayUrl: (id: string) => string;
};

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback;
  return v;
}

const DEFAULT_BASE_USDC = "0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913";

export const appConfig: AppConfig = {
  isProd: process.env.NODE_ENV === "production",
  allowUnverifiedInitData:
    env("ALLOW_UNVERIFIED_INITDATA") === "1" && process.env.NODE_ENV !== "production",
  publicBaseUrl: env("PUBLIC_BASE_URL", "")!,
  payeeAddr: env("PAYEE_ADDR"),
  feeAddr: env("FEE_ADDR"),
  telegram: { botToken: env("BOT_TOKEN") },
  privy: { appId: env("NEXT_PUBLIC_PRIVY_APP_ID") },
  request: {
    apiKey: env("REQUEST_API_KEY"),
    restBase: env("REQUEST_REST_BASE", "https://api.request.network/v1")!,
    nodeUrl: env("REQUEST_NODE_URL", "https://main.gateway.request.network")!,
    chain: (env("REQUEST_CHAIN", "ethereum") || "ethereum").toLowerCase(),
    erc20Address: env("ERC20_TOKEN_ADDRESS"),
    defaultBaseUSDC: DEFAULT_BASE_USDC,
  },
  getPayUrl: (id: string) => {
    const base = env("PUBLIC_BASE_URL", "")!;
    return base ? `${base.replace(/\/$/, "")}/pay/${id}` : `/pay/${id}`;
  },
};


