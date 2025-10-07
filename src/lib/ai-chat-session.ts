/**
 * AI Chat Session Manager
 * 
 * Manages multi-turn conversations with AI models in Telegram
 */

import type { ChatMessage } from '@/types/ai-model';

interface ChatSession {
  userId: number;
  chatId: number;
  modelId: string;
  messages: ChatMessage[];
  createdAt: number;
  lastMessageAt: number;
}

// In-memory session storage (use Redis/database in production)
const sessions = new Map<string, ChatSession>();

// Session timeout (30 minutes)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Generate session key
 */
function getSessionKey(userId: number, chatId: number): string {
  return `${userId}_${chatId}`;
}

/**
 * Get or create chat session
 */
export function getChatSession(
  userId: number,
  chatId: number,
  modelId: string
): ChatSession {
  const key = getSessionKey(userId, chatId);
  let session = sessions.get(key);

  if (!session || session.modelId !== modelId) {
    // Create new session
    session = {
      userId,
      chatId,
      modelId,
      messages: [],
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
    };
    sessions.set(key, session);
  }

  return session;
}

/**
 * Add message to session
 */
export function addMessageToSession(
  userId: number,
  chatId: number,
  message: ChatMessage
): void {
  const key = getSessionKey(userId, chatId);
  const session = sessions.get(key);

  if (session) {
    session.messages.push(message);
    session.lastMessageAt = Date.now();
    sessions.set(key, session);
  }
}

/**
 * Get session messages
 */
export function getSessionMessages(
  userId: number,
  chatId: number
): ChatMessage[] {
  const key = getSessionKey(userId, chatId);
  const session = sessions.get(key);
  return session?.messages || [];
}

/**
 * Clear session
 */
export function clearSession(userId: number, chatId: number): void {
  const key = getSessionKey(userId, chatId);
  sessions.delete(key);
}

/**
 * Get active session info
 */
export function getActiveSession(
  userId: number,
  chatId: number
): { modelId: string; messageCount: number } | null {
  const key = getSessionKey(userId, chatId);
  const session = sessions.get(key);

  if (!session) return null;

  return {
    modelId: session.modelId,
    messageCount: session.messages.length,
  };
}

/**
 * Clean up expired sessions
 */
export function cleanupExpiredSessions(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, session] of sessions.entries()) {
    if (now - session.lastMessageAt > SESSION_TIMEOUT_MS) {
      sessions.delete(key);
      cleaned++;
    }
  }

  return cleaned;
}

// Run cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cleaned = cleanupExpiredSessions();
    if (cleaned > 0) {
      console.log(`[Chat Session] Cleaned up ${cleaned} expired sessions`);
    }
  }, 5 * 60 * 1000);
}

/**
 * Format session summary
 */
export function getSessionSummary(userId: number, chatId: number): string {
  const session = getActiveSession(userId, chatId);

  if (!session) {
    return 'No active chat session';
  }

  const duration = Math.floor((Date.now() - Date.now()) / 1000 / 60);

  return (
    `📊 *Chat Session*\n` +
    `Model: \`${session.modelId}\`\n` +
    `Messages: ${session.messageCount}\n` +
    `Duration: ${duration}m\n\n` +
    `Use \`/ai-clear\` to start a new conversation`
  );
}
