/**
 * Telegram Bot Commands for Decentralized AI
 * 
 * Commands: /ai, /ai-list, /ai-serve
 */

import {
  getAllModels,
  getModelById,
  getReadyModels,
  getServingModels,
  formatBytes,
} from '@/lib/ai-model-storage';
import { getServeStatus } from '@/lib/ai-model-storage';
import type { AIModel } from '@/types/ai-model';
import { createHash } from 'crypto';

/**
 * Handle /ai command with URL
 * Downloads a model from HuggingFace
 */
export async function handleAiDownloadCommand(url: string): Promise<string> {
  // Validate HuggingFace URL
  if (!url.includes('huggingface.co')) {
    return `❌ Invalid URL. Please provide a HuggingFace model URL.\n\nExample:\n\`/ai https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B\``;
  }

  return (
    `🚀 *Starting Model Download*\n\n` +
    `URL: ${url}\n\n` +
    `⏳ This may take a while depending on file size and bandwidth.\n\n` +
    `Use \`/ai-list\` to check download progress.`
  );
}

/**
 * Handle /ai-list command
 * Shows all downloaded models and their status
 */
export function handleAiListCommand(): string {
  const models = getAllModels();

  if (models.length === 0) {
    return (
      `📚 *No Models Downloaded*\n\n` +
      `Download a model using:\n` +
      `\`/ai <huggingface_url>\`\n\n` +
      `Example:\n` +
      `\`/ai https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B\``
    );
  }

  let message = `📚 *Downloaded AI Models*\n\n`;

  models.forEach((model, idx) => {
    const statusEmoji = getStatusEmoji(model.status);
    const progress = model.downloadProgress;
    const size = formatBytes(model.size);
    const code = model.infoHash
      ? String(model.infoHash).slice(0, 7).toLowerCase()
      : createHash('sha1').update(model.repoId && model.fileName ? `${model.repoId}::${model.fileName}` : model.id).digest('hex').slice(0, 7).toLowerCase();

    message += `${idx + 1}. ${statusEmoji} *${model.name}*\n`;
    message += `   ID: \`${model.id}\`\n`;
    message += `   Code: \`${code}\`\n`;
    message += `   Status: ${model.status.toUpperCase()}`;

    if (model.status === 'downloading') {
      message += ` (${progress}%)`;
      if (model.peers > 0) {
        message += ` | ${model.peers} peers`;
      }
    }

    message += `\n   Size: ${size}\n`;

    if (model.status === 'serving') {
      const serveStatus = getServeStatus(model.id);
      if (serveStatus) {
        message += `   🌐 Serving on ${serveStatus.host}:${serveStatus.port}\n`;
      }
    }

    message += `\n`;
  });

  message += `\nUse \`/ai-serve <model_id>\` to start serving a model.`;

  return message;
}

/**
 * Handle /ai-serve command
 * Starts serving a model for inference
 */
export function handleAiServeCommand(modelId?: string): string {
  if (!modelId) {
    const readyModels = getReadyModels();

    if (readyModels.length === 0) {
      return (
        `❌ *No Models Available*\n\n` +
        `Download a model first using:\n` +
        `\`/ai <huggingface_url>\`\n\n` +
        `Then serve it with:\n` +
        `\`/ai-serve <model_id>\``
      );
    }

    let message = `🎯 *Select a Model to Serve*\n\n`;
    message += `Available models:\n\n`;

    readyModels.forEach((model, idx) => {
      message += `${idx + 1}. \`${model.id}\`\n`;
      message += `   ${model.name}\n`;
      message += `   ${formatBytes(model.size)}\n\n`;
    });

    message += `Use: \`/ai-serve <model_id>\``;

    return message;
  }

  const model = getModelById(modelId);

  if (!model) {
    return `❌ Model not found: \`${modelId}\`\n\nUse \`/ai-list\` to see available models.`;
  }

  if (model.status !== 'ready') {
    return `❌ Model is not ready. Current status: ${model.status.toUpperCase()}`;
  }

  return (
    `🚀 *Starting Model Server*\n\n` +
    `Model: ${model.name}\n` +
    `ID: \`${model.id}\`\n\n` +
    `The model server is starting...\n` +
    `You'll be able to chat with it once it's ready.\n\n` +
    `Use \`/ai\` to select and chat with the model.`
  );
}

/**
 * Handle /ai command without arguments
 * Shows inline keyboard to select a model for chat
 */
export function handleAiChatCommand(): { message: string; keyboard?: any } {
  const servingModels = getServingModels();
  const readyModels = getReadyModels();

  // If nothing is serving or ready, show guidance
  if (servingModels.length === 0 && readyModels.length === 0) {
    return {
      message: (
        `🤖 *Decentralized AI Chat*\n\n` +
        `No models are downloaded yet.\n\n` +
        `*Steps to get started:*\n` +
        `1️⃣ Download a model:\n` +
        `   \`/ai https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B\`\n\n` +
        `2️⃣ List your models:\n` +
        `   \`/ai-list\`\n\n` +
        `3️⃣ Serve a model:\n` +
        `   \`/ai-serve <model_id>\`\n\n` +
        `4️⃣ Chat with it: \`/ai\``
      ),
    };
  }

  const buttons: any[] = [];

  // Serving models -> direct chat
  for (const model of servingModels) {
    buttons.push([
      { text: `💬 ${model.name}`, callback_data: `ai_chat_${model.id}` },
    ]);
  }

  // Ready (not serving) -> serve & chat
  for (const model of readyModels) {
    buttons.push([
      { text: `▶️ Serve & Chat: ${model.name}`, callback_data: `ai_serve_${model.id}` },
    ]);
  }

  const keyboard = { inline_keyboard: buttons };

  const parts: string[] = [];
  if (servingModels.length > 0) parts.push(`• Tap a model below to chat.`);
  if (readyModels.length > 0) parts.push(`• Tap "Serve & Chat" to start a model.`);

  return {
    message: `🤖 *Decentralized AI Chat*\n\n${parts.join('\n')}`,
    keyboard,
  };
}

/**
 */
export function getModelStatsMessage(modelId: string): string {
  const model = getModelById(modelId);

  if (!model) {
    return `❌ Model not found.`;
  }

  const statusEmoji = getStatusEmoji(model.status);
  const size = formatBytes(model.size);

  let message = `📊 *Model Statistics*\n\n`;
  message += `Name: *${model.name}*\n`;
  message += `ID: \`${model.id}\`\n`;
  message += `Status: ${statusEmoji} ${model.status.toUpperCase()}\n\n`;

  message += `📦 *Storage*\n`;
  message += `Size: ${size}\n`;
  message += `Format: ${model.format}\n\n`;

  const serveStatus = getServeStatus(modelId);
  if (serveStatus?.isServing) {
    message += `\n\n🌐 *Serving*\n`;
    message += `Host: ${serveStatus.host}\n`;
    message += `Port: ${serveStatus.port}\n`;
    message += `Requests: ${serveStatus.requestCount || 0}\n`;
    message += `Errors: ${serveStatus.errorCount || 0}\n`;
  }

  return message;
}

/**
 * Get status emoji for model status
 */
function getStatusEmoji(status: AIModel['status']): string {
  switch (status) {
    case 'downloading':
      return '⬇️';
    case 'ready':
      return '✅';
    case 'serving':
      return '🌐';
    case 'error':
      return '❌';
    case 'paused':
      return '⏸️';
    default:
      return '❓';
  }
}

/**
 * Format model list for inline keyboard
 */
export function getModelSelectionKeyboard(models: AIModel[]): any {
  const buttons = models.map((model) => [
    {
      text: `${model.name} (${formatBytes(model.size)})`,
      callback_data: `model_select_${model.id}`,
    },
  ]);

  return {
    inline_keyboard: buttons,
  };
}

/**
 * Build inline keyboard for serving models (ready state)
 */
export function getServeSelectionKeyboard(): any | undefined {
  const ready = getReadyModels();
  if (ready.length === 0) return undefined;
  const buttons = ready.map((m) => [
    { text: `▶️ Serve & Chat: ${m.name}`, callback_data: `ai_serve_${m.id}` },
  ]);
  return { inline_keyboard: buttons };
}

/**
 * Generate help message for AI commands
 */
export function getAiHelpMessage(): string {
  return (
    `🤖 *Decentralized AI Commands*\n\n` +
    `*Download Models:*\n` +
    `\`/ai <url>\` - Download from HuggingFace\n` +
    `Example: \`/ai https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B\`\n\n` +
    `*Manage Models:*\n` +
    `\`/ai-list\` - Show all models\n` +
    `\`/ai-serve <model_id>\` - Start serving a model\n` +
    `\`/ai-stop <model_id>\` - Stop serving\n\n` +
    `*Chat:*\n` +
    `\`/ai\` - Select model and chat`
  );
}
