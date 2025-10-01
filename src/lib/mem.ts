// Ephemeral in-memory store to bridge bot -> webhook context within a single runtime
// Note: This resets on redeploy or cold start. For durability, persist in a DB.

export type RequestMsgContext = {
  chatId: number;
  messageId: number;
  paidCaption: string;
  replyMarkup?: any;
};

export const requestContextById = new Map<string, RequestMsgContext>();


