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
    chain: string; // e.g., "ethereum", "base"
  };
  getPayUrl: (id: string) => string;
};

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback;
  return v;
}

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
  },
  getPayUrl: (id: string) => {
    const base = env("PUBLIC_BASE_URL", "")!;
    return base ? `${base.replace(/\/$/, "")}/pay/${id}` : `/pay/${id}`;
  },
};


