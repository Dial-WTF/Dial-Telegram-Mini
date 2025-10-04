// Ephemeral in-memory store to bridge bot -> webhook context within a single runtime
// Note: This resets on redeploy or cold start. For durability, persist in a DB.

export type RequestMsgContext = {
  chatId: number;
  messageId: number;
  paidCaption: string;
  replyMarkup?: any;
};

export const requestContextById = new Map<string, RequestMsgContext>();


export type PredictContext = {
  networkId: string;
  createx: `0x${string}`;
  salt: `0x${string}`;
  initCode: `0x${string}`;
  from?: `0x${string}`;
};

// Keyed by predicted deposit address (lowercased)
export const predictContextByAddress = new Map<string, PredictContext>();

// Idempotency guard to avoid re-deploying the same salt multiple times per runtime
export const deployedCreate2Salts = new Set<string>();

// Link predicted deposit address -> requestId for later webhook lookups
export const requestIdByPredictedAddress = new Map<string, string>();


