import { NextRequest, NextResponse } from "next/server";
import { appConfig } from "#/lib/config";
import { parseEther, Interface } from "ethers";
import { parseRequest } from "#/lib/parse";
import {
  isValidHexAddress,
  normalizeHexAddress,
  resolveEnsToHex,
} from "#/lib/addr";
import { tg } from "#/lib/telegram";
import { fetchPayCalldata, extractForwarderInputs } from "#/lib/requestApi";
import {
  createAddressActivityWebhook,
  updateWebhookAddresses,
} from "#/lib/alchemyWebhooks";
import { bpsToPercentString } from "#/lib/fees";
import {
  buildEthereumUri,
  decodeProxyDataAndValidateValue,
} from "#/lib/ethUri";
import { formatCaptionRich, formatEthTrimmed } from "#/lib/format";
import {
  buildForwarderInitCode,
  predictCreate2AddressCreateX,
} from "#/lib/create2x";
import ForwarderArtifact from "#/lib/contracts/DepositForwarderMinimal/DepositForwarderMinimal.json";
import { keccak256, toHex } from "viem";
import { estimateGasAndPrice } from "#/lib/gas";
import { buildQrForRequest } from "#/lib/qrUi";
import { isValidEthereumAddress } from "#/lib/utils";
import {
  requestContextById,
  predictContextByAddress,
  requestIdByPredictedAddress,
} from "#/lib/mem";
import type { BotResponse } from "@bot/ui-kit";
// Optional dependency: Privy disabled in this build
async function getPrivyClient() {
  return null as any;
}
// Enable S3 writes using our internal client util
async function loadS3() {
  try {
    const { s3 } = await import("#/services/s3");
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { PATH_INVOICES } = await import("#/services/s3/filepaths");
    const { AWS_S3_BUCKET } = await import("#/config/constants");
    async function writeS3File(
      key: string,
      opts: { Body: Buffer; ContentType: string }
    ) {
      await s3.send(
        new PutObjectCommand({ Bucket: AWS_S3_BUCKET, Key: key, ...opts })
      );
      return true;
    }
    return {
      s3,
      PutObjectCommand,
      PATH_INVOICES,
      AWS_S3_BUCKET,
      writeS3File,
    } as const;
  } catch {
    return null as any;
  }
}

// Ephemeral, in-memory state for DM follow-ups (resets on deploy/restart)
// Stores ETH amounts (not USD)
const pendingAddressByUser = new Map<
  number,
  { ethAmount: number; note: string }
>();

async function resolveEnsOrAddress(input: string): Promise<string | undefined> {
  return resolveEnsToHex(input, process.env.RPC_URL);
}

export const runtime = "nodejs";

const DEBUG = process.env.DEBUG_BOT === "1";
const DRY = process.env.BOT_DRY_RUN === "1";

async function tgCall(method: string, payload: any): Promise<any> {
  if (DRY) {
    try {
      console.log(`[BOT_DRY_RUN] ${method}`, payload);
    } catch {}
    return { ok: true, result: { message_id: 1 } } as any;
  }
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  try {
    const json = await res.json();
    if (DEBUG) {
      try {
        console.log(`[TG] ${method} ->`, json);
      } catch {}
    }
    return json;
  } catch {
    if (DEBUG) {
      try {
        console.log(`[TG] ${method} http=${res.status} ok=${res.ok}`);
      } catch {}
    }
    return { ok: res.ok };
  }
}

// Privy usage disabled; remove to avoid optional dependency resolution

// Minimal webhook endpoint for Telegram bot commands via Bot API webhook
// Set this path as your webhook URL: <PUBLIC_BASE_URL>/api/bot
export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Telegram may occasionally send empty body or invalid JSON; treat as noop
      body = {};
    }
    // Swarm heartbeat: periodically register this node and its models
    try {
      const serverBase = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
      const { ensureSwarmHeartbeat } = await import("@/lib/swarm-init");
      ensureSwarmHeartbeat(serverBase);
    } catch {}
    // Handle callback queries for status refresh
    const callback = body?.callback_query;
    if (
      callback &&
      callback.id &&
      callback.message &&
      typeof callback.data === "string"
    ) {
      const chatIdCb = callback.message.chat?.id;
      const messageIdCb = callback.message.message_id;
      const data = callback.data as string;
      // Data may be very short; derive reqId from original message entities/URLs
      if (data === "sr" && chatIdCb && messageIdCb) {
        // Derive requestId from message content
        let reqId = "";
        try {
          const entities =
            (callback.message as any).caption_entities ||
            callback.message.entities ||
            [];
          const text: string =
            callback.message.caption || callback.message.text || "";
          for (const ent of entities) {
            const t = ent.type;
            if (t === "text_link" && ent.url) {
              const m = ent.url.match(/\/pay\/([^/?#]+)/);
              if (m) {
                reqId = m[1];
                break;
              }
            }
          }
          if (!reqId) {
            const m2 = text.match(/https?:\/\/[^\s]+\/pay\/([^\s]+)/);
            if (m2) reqId = m2[1];
          }
          // Fallback: scan reply_markup button URLs
          if (!reqId) {
            try {
              const rm: any = (callback.message as any)?.reply_markup;
              const rows: any[] = Array.isArray(rm?.inline_keyboard)
                ? rm.inline_keyboard
                : [];
              for (const row of rows) {
                for (const btn of row) {
                  const u: string | undefined = btn?.url;
                  if (u && typeof u === "string") {
                    let m = u.match(/\/pay\/([^\/?#]+)/);
                    if (m) {
                      reqId = m[1];
                      break;
                    }
                    m = u.match(/scan\.request\.network\/request\/([^\/?#]+)/);
                    if (m) {
                      reqId = m[1];
                      break;
                    }
                  }
                }
                if (reqId) break;
              }
            } catch {}
          }
          if (!reqId) throw new Error("request id not found");
        } catch (err: any) {
          // Fallback: look up requestId by chatId/messageId from S3 index (optional)
          try {
            const s3env = await loadS3();
            if (!s3env) throw new Error("S3 not configured");
            const { s3, GetObjectCommand, AWS_S3_BUCKET, PATH_INVOICES } =
              s3env as any;
            const key = `${PATH_INVOICES}by-message/${chatIdCb}/${messageIdCb}.json`;
            const obj = await s3.send(
              new GetObjectCommand({ Bucket: AWS_S3_BUCKET, Key: key })
            );
            const text = await (obj.Body as any).transformToString();
            const rec = JSON.parse(text || "{}");
            const rid = rec?.requestId || rec?.id;
            if (rid && typeof rid === "string") {
              reqId = rid;
            } else {
              throw new Error("request id not found");
            }
          } catch (e) {
            await tg.answerCallback(callback.id, "Unable to refresh status");
            return NextResponse.json({ ok: false });
          }
        }
        try {
          const base = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
          const url = `${base}/api/status?id=${encodeURIComponent(reqId)}`;
          let s: any = null;
          try {
            const resp = await fetch(url);
            const txt = await resp.text();
            try {
              s = JSON.parse(txt);
            } catch {
              s = {
                status: resp.ok ? "pending" : "error",
                error: txt.slice(0, 200),
              };
            }
          } catch (netErr: any) {
            throw new Error(
              `status fetch failed: ${netErr?.message || "network"}`
            );
          }
          const status = String(s?.status || "pending");
          const emoji =
            status === "paid" ? "✅" : status === "pending" ? "🟡" : "❌";
          const newStatusText = `Click for Status: ${emoji} ${status
            .charAt(0)
            .toUpperCase()}${status.slice(1)}`;
          // If markup already has identical Status button text, skip editing to avoid 400 not-modified
          let prevStatusText = "";
          try {
            const rm: any = (callback.message as any)?.reply_markup;
            const rows: any[] = Array.isArray(rm?.inline_keyboard)
              ? rm.inline_keyboard
              : [];
            for (const row of rows) {
              for (const btn of row) {
                if (
                  btn &&
                  typeof btn.text === "string" &&
                  btn.text.startsWith("Status:")
                ) {
                  prevStatusText = btn.text;
                  break;
                }
              }
              if (prevStatusText) break;
            }
          } catch {}
          const kb = {
            inline_keyboard: [
              [{ text: "Open invoice", url: `${base}/pay/${reqId}` }],
              [
                {
                  text: "View on Request Scan",
                  url: `https://scan.request.network/request/${reqId}`,
                },
              ],
              [{ text: newStatusText, callback_data: "sr" }],
            ],
          } as any;
          if (status === "paid") {
            // Try to fetch last-known payment details to enrich caption
            let pretty = "✅ PAID";
            try {
              const s2 = await fetch(
                `${base}/api/status?id=${encodeURIComponent(reqId)}`
              ).then((r) => r.json());
              const amt = (
                s2?.balance?.paidAmount ||
                s2?.amount ||
                ""
              ).toString();
              const currency = (s2?.currency || "ETH").toString().toUpperCase();
              const tsIso = (
                s2?.timestamp || new Date().toISOString()
              ).toString();
              const d = new Date(tsIso);
              const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
              const dd = String(d.getUTCDate()).padStart(2, "0");
              const yy = String(d.getUTCFullYear()).slice(-2);
              const hh = String(d.getUTCHours()).padStart(2, "0");
              const mi = String(d.getUTCMinutes()).padStart(2, "0");
              const net = (s2?.network || "mainnet").toString();
              const netName = net.charAt(0).toUpperCase() + net.slice(1);
              pretty = `✅ ${
                amt || ""
              } ${currency} paid on ${mm}/${dd}/${yy} @ ${hh}:${mi} UTC\nOn ${netName}\nPowered by Request Network`;
            } catch {}
            const mediaUrl = `${base}/Dial.letters.transparent.bg.crop.png`;
            try {
              await tg.editMedia(
                chatIdCb,
                messageIdCb,
                { type: "photo", media: mediaUrl, caption: pretty },
                kb
              );
            } catch {
              // If media unchanged or fails, still attempt markup edit when different
              if (prevStatusText !== newStatusText) {
                await tg.editReplyMarkup(chatIdCb, messageIdCb, kb);
              }
            }
          } else if (prevStatusText !== newStatusText) {
            await tg.editReplyMarkup(chatIdCb, messageIdCb, kb);
          }
          await tg.answerCallback(callback.id, newStatusText);
        } catch (e: any) {
          await tg.answerCallback(callback.id, e?.message || "Error");
        }
        return NextResponse.json({ ok: true });
      }
    }
    // Inline mode support: when users type @YourBot in any chat
    const inline = body?.inline_query;
    if (inline && inline.id) {
      const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
      const q: string = (inline.query || "").trim();
      const m = q.match(/\d+(?:\.\d+)?/);
      const amt = m ? Number(m[0]) : undefined;

      const results: any[] = [];

      // Open app quick action
      results.push({
        type: "article",
        id: "open-app",
        title: "Open Dial Pay",
        description: "Launch the mini app to request or send",
        input_message_content: { message_text: "Open Dial Pay" },
        reply_markup: {
          inline_keyboard: [[{ text: "Open app", web_app: { url: baseUrl } }]],
        },
      });

      const quick = [5, 10, 20, 50];
      for (const v of quick) {
        results.push({
          type: "article",
          id: `req-${v}`,
          title: `Request $${v}`,
          description: "Create an invoice for this amount",
          input_message_content: { message_text: `Request $${v}` },
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Create invoice",
                  web_app: { url: `${baseUrl}?amount=${v}` },
                },
              ],
            ],
          },
        });
      }

      if (amt && amt > 0) {
        results.unshift({
          type: "article",
          id: `req-custom-${amt}`,
          title: `Request $${amt}`,
          description: "Create an invoice for this amount",
          input_message_content: { message_text: `Request $${amt}` },
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Create invoice",
                  web_app: { url: `${baseUrl}?amount=${amt}` },
                },
              ],
            ],
          },
        });
      }

      await fetch(
        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/answerInlineQuery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inline_query_id: inline.id,
            results,
            cache_time: 1,
            is_personal: true,
          }),
        }
      );
      return NextResponse.json({ ok: true });
    }

    // Handle callback queries (inline button presses)
    const callbackQuery = body?.callback_query;
    if (callbackQuery) {
      const callbackData = callbackQuery.data;
      const callbackChatId = callbackQuery.message?.chat?.id;
      const callbackUserId = callbackQuery.from?.id;
      const callbackQueryId = callbackQuery.id;
      const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;

      // Answer callback query to remove loading state
      await tgCall("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
      });

      if (callbackData === "quick_invoice") {
        const keyboard = {
          inline_keyboard: [
            [
              { text: "💵 5 USDC", callback_data: "invoice_5_USDC" },
              { text: "💵 10 USDC", callback_data: "invoice_10_USDC" },
            ],
            [
              { text: "💵 20 USDC", callback_data: "invoice_20_USDC" },
              { text: "💵 50 USDC", callback_data: "invoice_50_USDC" },
            ],
            [{ text: "💰 Custom Amount", web_app: { url: baseUrl } }],
          ],
        };
        await tgCall("sendMessage", {
          chat_id: callbackChatId,
          text: "📨 *Quick Invoice*\n\nSelect an amount to create an invoice:",
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else if (callbackData === "quick_send") {
        await tgCall("sendMessage", {
          chat_id: callbackChatId,
          text: "⚡ *Quick Send*\n\nTo send crypto, use:\n`/send @username <amount> <asset>`\n\nExample:\n`/send @john 10 USDC`",
          parse_mode: "Markdown",
        });
      } else if (callbackData === "create_party") {
        await tgCall("sendMessage", {
          chat_id: callbackChatId,
          text: "🎉 *Create Party*\n\nTo create a party room, use:\n`/startparty`\n\nOr provide your wallet address:\n`/startparty 0xYourAddress`",
          parse_mode: "Markdown",
        });
      } else if (callbackData === "list_parties") {
        await tgCall("sendMessage", {
          chat_id: callbackChatId,
          text: "🔍 *Finding Parties*\n\n• List all parties: `/listparty`\n• Search parties: `/findparty <keyword>`\n\nExample:\n`/findparty room123`",
          parse_mode: "Markdown",
        });
      } else if (callbackData === "view_balance") {
        await tgCall("sendMessage", {
          chat_id: callbackChatId,
          text: "💳 *View Balance*\n\nUse `/balance` to view your wallet balance, or open the app to see detailed balances.",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💰 Open Dial Pay", web_app: { url: baseUrl } }],
            ],
          },
          parse_mode: "Markdown",
        });
      } else if (callbackData === "help") {
        const keyboard = {
          inline_keyboard: [
            [{ text: "💰 Open Dial Pay", web_app: { url: baseUrl } }],
          ],
        };
        await tgCall("sendMessage", {
          chat_id: callbackChatId,
          text: "❓ *Dial Pay Help*\n\n*💰 Payments:*\n• `/invoice <amount> <asset>` - Create invoice\n• `/send @user <amount> <asset>` - Send crypto\n• `/check <amount> <asset>` - Create voucher\n• `/balance` - View balance\n\n*🎉 Party Lines:*\n• `/startparty` - Create party\n• `/listparty` - List parties\n• `/findparty <keyword>` - Search\n\n*Assets:* USDT, USDC, ETH, BTC, TON, BNB, SOL",
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
      } else if (callbackData && callbackData.startsWith("invoice_")) {
        // Handle quick invoice creation (e.g., invoice_10_USDC)
        const parts = callbackData.split("_");
        const amount = parts[1];
        const asset = parts[2] || "USDC";

        await tgCall("sendMessage", {
          chat_id: callbackChatId,
          text: `Creating ${amount} ${asset} invoice...\n\nUse: \`/invoice ${amount} ${asset}\` to create it now!`,
          parse_mode: "Markdown",
        });
      } else if (callbackData && callbackData.startsWith("ai_chat_")) {
        // Handle AI model selection for chat
        const modelId = callbackData.replace("ai_chat_", "");

        // Start chat session
        const { getChatSession } = await import("@/lib/ai-chat-session");
        getChatSession(callbackUserId, callbackChatId, modelId);

        await tgCall("sendMessage", {
          chat_id: callbackChatId,
          text: `🤖 *Chat Session Started*\n\nModel: \`${modelId}\`\n\nSend me a message to chat with the AI.\n\nUse \`/ai-clear\` to end the session.`,
          parse_mode: "Markdown",
        });
      } else if (callbackData && callbackData.startsWith("ai_serve_")) {
        // Handle Serve & Chat: start model server then open chat session
        const modelId = callbackData.replace("ai_serve_", "");
        try {
          const apiBase = req.nextUrl.origin;
          const res = await fetch(`${apiBase}/api/ai/serve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelId }),
          });
          if (!res.ok) {
            const errText = await res.text();
            await tgCall("sendMessage", {
              chat_id: callbackChatId,
              text: `❌ Failed to start model: ${errText}`,
            });
          } else {
            // Start chat session immediately
            const { getChatSession } = await import("@/lib/ai-chat-session");
            getChatSession(callbackUserId, callbackChatId, modelId);
            await tgCall("sendMessage", {
              chat_id: callbackChatId,
              text: `✅ Model started.\n\n🤖 *Chat Session Started*\n\nModel: \`${modelId}\`\n\nSend me a message to chat with the AI.\n\nUse \`/ai-clear\` to end the session.`,
              parse_mode: "Markdown",
            });
          }
        } catch (err: any) {
          await tgCall("sendMessage", {
            chat_id: callbackChatId,
            text: `Error: ${err?.message || "unknown"}`,
          });
        }
      } else if (callbackData === "ai_setup_done") {
        // Next steps after installer
        const textMsg =
          "✅ *Installer Complete*\n\nNext steps:\n1) Download a sample model (DeepSeek R1 Qwen 1.5B)\n2) Watch progress with /ai-list\n3) Chat with the model via /ai (Serve & Chat)\n\nTap a button below to continue.";
        const userBase = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const keyboard = {
          inline_keyboard: [
            [
              {
                text: "⬇️ Download DeepSeek (recommended)",
                callback_data: "ai_dl_deepseek_r1_qwen15b",
              },
            ],
            [
              {
                text: "⬇️ Download Qwen2.5 1.5B (GGUF)",
                callback_data: "ai_dl_qwen25_1_5b_gguf",
              },
            ],
            [{ text: "📚 Show Models", callback_data: "ai_show_models" }],
            [
              {
                text: "💬 Chat Selector",
                callback_data: "ai_show_chat_selector",
              },
            ],
            [
              {
                text: "🧩 macOS: Copy Command Page",
                url: `${userBase}/ai/setup/mac`,
              },
            ],
            [
              {
                text: "⬇️ Linux Installer (.sh)",
                url: `${userBase}/api/ai/setup/download/linux`,
              },
            ],
            [
              {
                text: "⬇️ Linux GPU Installer (.sh)",
                url: `${userBase}/api/ai/setup/download/linux-gpu`,
              },
            ],
          ],
        } as any;
        await tgCall("sendMessage", {
          chat_id: callbackChatId,
          text: textMsg,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } else if (callbackData === "ai_dl_deepseek_r1_qwen15b") {
        // Trigger sample model download
        try {
          const url =
            "https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B";
          const msg =
            "🚀 Starting download: DeepSeek R1 Qwen 1.5B\n\n• This may take time depending on size and peers.\n• Use /ai-list to see progress.\n• When ready, use /ai to Serve & Chat.";
          const kb = {
            inline_keyboard: [
              [{ text: "📚 Show Models", callback_data: "ai_show_models" }],
            ],
          } as any;
          await tgCall("sendMessage", {
            chat_id: callbackChatId,
            text: msg,
            parse_mode: "Markdown",
            reply_markup: kb,
          });

          // Kick off background download without internal HTTP hop
          (async () => {
            try {
              const { addModelFromHuggingFace } = await import(
                "@/lib/ai-model-manager"
              );
              await addModelFromHuggingFace({
                huggingFaceUrl: url,
                createTorrent: true,
              });
            } catch (e) {
              try {
                console.error("[Bot] Background download error:", e);
              } catch {}
            }
          })();
        } catch (err: any) {
          await tgCall("sendMessage", {
            chat_id: callbackChatId,
            text: `Error: ${err?.message || "unknown"}`,
          });
        }
      } else if (callbackData === "ai_dl_qwen25_1_5b_gguf") {
        // Trigger Qwen2.5 1.5B Instruct GGUF sample download
        try {
          const url = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF";
          const msg =
            "🚀 Starting download: Qwen2.5 1.5B Instruct (GGUF)\n\n• This may take time depending on size and peers.\n• Use /ai-list to see progress.\n• When ready, use /ai to Serve & Chat.";
          const kb = {
            inline_keyboard: [
              [{ text: "📚 Show Models", callback_data: "ai_show_models" }],
            ],
          } as any;
          await tgCall("sendMessage", {
            chat_id: callbackChatId,
            text: msg,
            parse_mode: "Markdown",
            reply_markup: kb,
          });

          (async () => {
            try {
              const { addModelFromHuggingFace } = await import(
                "@/lib/ai-model-manager"
              );
              await addModelFromHuggingFace({
                huggingFaceUrl: url,
                createTorrent: true,
              });
            } catch (e) {
              try {
                console.error(
                  "[Bot] Background download error (Qwen2.5 GGUF):",
                  e
                );
              } catch {}
            }
          })();
        } catch (err: any) {
          await tgCall("sendMessage", {
            chat_id: callbackChatId,
            text: `Error: ${err?.message || "unknown"}`,
          });
        }
      } else if (callbackData === "ai_show_models") {
        const { handleAiListCommand } = await import("@/lib/bot/ai-commands");
        const message = handleAiListCommand();
        const kb = {
          inline_keyboard: [
            [
              {
                text: "💬 Chat Selector",
                callback_data: "ai_show_chat_selector",
              },
            ],
          ],
        } as any;
        await tgCall("sendMessage", {
          chat_id: callbackChatId,
          text: message,
          parse_mode: "Markdown",
          reply_markup: kb,
        });
      } else if (callbackData === "ai_show_chat_selector") {
        const { handleAiChatCommand } = await import("@/lib/bot/ai-commands");
        const { message, keyboard } = handleAiChatCommand();
        await tgCall("sendMessage", {
          chat_id: callbackChatId,
          text: message,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }

      return NextResponse.json({ ok: true });
    }

    const msg = body?.message;
    const text: string = msg?.text || "";
    const chatId = msg?.chat?.id;
    const chatType: string | undefined = msg?.chat?.type;
    const tgUserId = msg?.from?.id;

    if (!chatId || !tgUserId) return NextResponse.json({ ok: true });

    const reply = async (text: string) => {
      const r = await tg.sendMessage(chatId, text);
      return !!r?.ok;
    };

    if (DEBUG) {
      await reply(
        `dbg: chatType=${chatType} isCmd=${
          typeof text === "string" && text.startsWith("/")
        } text="${text}"`
      );
    }

    // Avoid spamming group chats: only act on slash commands. In DMs, allow normal flow.
    const isCommand = typeof text === "string" && text.startsWith("/");
    if (!isCommand && chatType !== "private") {
      return NextResponse.json({ ok: true });
    }

    // /ai-seeding, /ai_seeding, or /aiseeding - Show swarm seeding status and short codes
    if (/^\/ai[-_]?seeding\b/i.test(text)) {
      try {
        const { listAggregated } = await import("@/lib/swarm-client");
        const { getAllModels } = await import("@/lib/ai-model-storage");
        const serverBase = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const aggregated = await listAggregated(serverBase).catch(
          () => [] as any[]
        );

        let message = "🌐 *AI Seeding (Swarm)*\n\n";
        if (aggregated && aggregated.length > 0) {
          aggregated.slice(0, 25).forEach((e: any, idx: number) => {
            message += `${idx + 1}. ${e.name}  (\`${e.code}\`)\n`;
            message += `   Nodes: ${e.nodes}  Seeders: ${e.totalSeeders}  Peers: ${e.peers}\n`;
            const sample = e.examples
              ?.slice(0, 3)
              .map(
                (x: any) =>
                  `${x.status}${
                    typeof x.seeders === "number" ? `:${x.seeders}` : ""
                  }`
              )
              .join(", ");
            if (sample) message += `   Examples: ${sample}\n`;
            message += `\n`;
          });
          message +=
            "Use `/ask <message> #<code>` to target a model. Omit the code to auto-pick the most-seeded model.";
        } else {
          // Fallback to local-only list
          const models = getAllModels().filter(
            (m) => m.status === "serving" || m.status === "ready"
          );
          models.sort(
            (a, b) =>
              (a.status === "serving" ? -1 : 1) -
              (b.status === "serving" ? -1 : 1)
          );
          if (models.length === 0) {
            message +=
              "No models are currently serving or ready. Use `/ai-serve <model_id>` to start one.";
          } else {
            const { createHash } = await import("crypto");
            const codeFor = (m: any) => {
              if (m.infoHash)
                return String(m.infoHash).slice(0, 7).toLowerCase();
              const basis =
                m.repoId && m.fileName ? `${m.repoId}::${m.fileName}` : m.id;
              return createHash("sha1")
                .update(basis)
                .digest("hex")
                .slice(0, 7)
                .toLowerCase();
            };
            models.slice(0, 25).forEach((m, idx) => {
              const code = codeFor(m);
              message += `${idx + 1}. ${m.name || m.id}  (\`${code}\`)\n`;
              message += `   Status: ${m.status}  Peers: ${m.peers || 0}\n`;
              const prog =
                typeof m.downloadProgress === "number"
                  ? `  ${Math.round(m.downloadProgress)}%`
                  : "";
              message += `   Status: ${m.status}${prog}\n\n`;
            });
          }
        }

        await tgCall("sendMessage", {
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown",
        });
      } catch (err: any) {
        await tgCall("sendMessage", {
          chat_id: chatId,
          text: `Error: ${err?.message || "unknown"}`,
        });
      }
      return NextResponse.json({ ok: true });
    }

    // /miner - Dashboard of this node (hardware, OS, load, serving, seeding)
    if (/^\/miner\b/i.test(text)) {
      try {
        const { getServingModels, getAllModels, getServeStatus, formatBytes } =
          await import("@/lib/ai-model-storage");
        const { createHash } = await import("crypto");
        const { getPeerId } = await import("@/lib/swarm-client");
        const os = await import("os");
        const base = (
          process.env.PUBLIC_BASE_URL || req.nextUrl.origin
        ).replace(/\/$/, "");
        const peerId = getPeerId(base);

        // System / hardware
        const cpus = typeof os.cpus === "function" ? os.cpus() : ([] as any[]);
        const cpuModel = cpus[0]?.model || "Unknown CPU";
        const cores = cpus.length || 0;
        const arch = typeof os.arch === "function" ? os.arch() : process.arch;
        const platform =
          typeof os.platform === "function" ? os.platform() : process.platform;
        const release = typeof os.release === "function" ? os.release() : "";
        const totalMemB = typeof os.totalmem === "function" ? os.totalmem() : 0;
        const freeMemB = typeof os.freemem === "function" ? os.freemem() : 0;
        const load =
          typeof os.loadavg === "function" ? os.loadavg() : [0, 0, 0];
        const sysUptimeSec =
          typeof os.uptime === "function" ? Math.floor(os.uptime()) : 0;
        const nodeVer = process.versions?.node || "";
        const procUptimeSec = Math.floor(process.uptime());

        const serving = getServingModels();
        const allModels = getAllModels();
        const now = Date.now();
        const codeFor = (m: any) => {
          if (m.infoHash) return String(m.infoHash).slice(0, 7).toLowerCase();
          const basis =
            m.repoId && m.fileName ? `${m.repoId}::${m.fileName}` : m.id;
          return createHash("sha1")
            .update(basis)
            .digest("hex")
            .slice(0, 7)
            .toLowerCase();
        };

        const fmtUptime = (s: number) =>
          s < 3600
            ? `${Math.floor(s / 60)}m ${s % 60}s`
            : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

        let message = "";
        message += `⛏️ *Miner Dashboard*\n`;
        message += `Peer: \`${peerId}\`\n`;
        message += `Base: ${base}  Port: 3000\n\n`;

        message += `🖥️ *Hardware*\n`;
        message += `CPU: ${cpuModel}  Cores: ${cores}  Arch: ${arch}\n`;
        message += `Memory: ${formatBytes(totalMemB)} total, ${formatBytes(
          freeMemB
        )} free\n\n`;

        message += `🧰 *System*\n`;
        message += `OS: ${platform} ${release}  Node: v${nodeVer}\n`;
        message += `Load (1/5/15m): ${load
          .map((n) => n.toFixed(2))
          .join("/")}\n`;
        message += `Uptime: sys ${fmtUptime(sysUptimeSec)}  proc ${fmtUptime(
          procUptimeSec
        )}\n\n`;

        if (serving.length === 0) {
          message +=
            "No models are currently serving on this node.\n\nUse `/ai-serve <model_id>` to start one.";
        } else {
          let totalReq = 0;
          let totalUptimeSec = 0;
          let totalUploaded = 0;
          message += `🤖 *Serving* (${serving.length})\n`;
          for (const m of serving) {
            const st = getServeStatus(m.id);
            const startedAt = st?.startedAt || 0;
            const uptimeSec = startedAt
              ? Math.max(1, Math.floor((now - startedAt) / 1000))
              : 0;
            const req = st?.requestCount || 0;
            const err = st?.errorCount || 0;
            const rpm =
              uptimeSec > 0 ? (req / (uptimeSec / 60)).toFixed(2) : "0.00";
            const uploaded =
              typeof m.uploadedBytes === "number" ? m.uploadedBytes : 0;
            const code = codeFor(m);
            totalReq += req;
            totalUptimeSec += uptimeSec;
            totalUploaded += uploaded;
            const upPretty = fmtUptime(uptimeSec);
            message += `• ${m.name || m.id} (\`${code}\`)\n`;
            message += `   Uptime: ${upPretty}  Requests: ${req}  Errors: ${err}  Rate: ${rpm}/min\n`;
            message += `   Seeding: ${formatBytes(uploaded)}  Seeders: ${
              m.seeders || 0
            }\n`;
            message += `\n`;
          }
          const avgRpm =
            totalUptimeSec > 0
              ? (totalReq / (totalUptimeSec / 60)).toFixed(2)
              : "0.00";
          message += `📈 *Totals*\n`;
          message += `Compute rate (avg): ${avgRpm} req/min\n`;
          message += `Uploaded (all models): ${formatBytes(totalUploaded)}\n`;
          message += `\n`;
          message += `Note: compute rate is approximated from request counts and uptime. Token-level accounting will be added later.\n`;
        }

        await tgCall("sendMessage", {
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown",
        });
      } catch (err: any) {
        await tgCall("sendMessage", {
          chat_id: chatId,
          text: `Error: ${err?.message || "unknown"}`,
        });
      }
      return NextResponse.json({ ok: true });
    }

    // /ask <message> [#<7hex>] - Ask AI in any chat (group-friendly)
    if (/^\/ask\b/i.test(text)) {
      let question = text.replace(/^\/ask\b/i, "").trim();
      const codeMatch = question.match(/#([a-f0-9]{7})\b/i);
      const requestedCode = codeMatch?.[1]?.toLowerCase();
      if (requestedCode) {
        question = question.replace(/#([a-f0-9]{7})\b/i, "").trim();
      }
      if (!question) {
        await tgCall("sendMessage", {
          chat_id: chatId,
          text: "Usage: /ask <message>\n\nExample: /ask explain JSON in one sentence",
        });
        return NextResponse.json({ ok: true });
      }

      try {
        const {
          getActiveSession,
          getSessionMessages,
          addMessageToSession,
          getChatSession,
        } = await import("@/lib/ai-chat-session");
        const { getServingModels, getAllModels } = await import(
          "@/lib/ai-model-storage"
        );
        const { listAggregated, remoteChat } = await import(
          "@/lib/swarm-client"
        );
        const { chat } = await import("@/lib/ai-inference");
        const { createHash } = await import("crypto");

        // Append user message to session regardless of routing path
        const session = getChatSession(tgUserId, chatId, ""); // placeholder session, will set model below
        addMessageToSession(tgUserId, chatId, {
          role: "user",
          content: question,
        });
        const messages = getSessionMessages(tgUserId, chatId);

        const serverBase = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const aggregated = await listAggregated(serverBase).catch(
          () => [] as any[]
        );

        const norm = (u: string) => u.replace(/\/$/, "").toLowerCase();
        const isSelf = (u: string) => norm(u) === norm(serverBase);

        let answered = false;
        let chosenModelId: string | undefined;

        if (aggregated && aggregated.length > 0) {
          // If multiple peers can do next_token, use the composer
          try {
            const preferCode =
              (requestedCode && requestedCode.toLowerCase()) ||
              String(aggregated[0]?.code || "").toLowerCase();
            if (preferCode) {
              const entry = aggregated.find(
                (e: any) => String(e.code).toLowerCase() === preferCode
              );
              const examples = Array.isArray(entry?.examples)
                ? entry.examples
                : [];
              const capable = examples.filter(
                (ex: any) =>
                  ex &&
                  ex.status === "serving" &&
                  ex.publicUrl &&
                  (Array.isArray(ex.capabilities)
                    ? ex.capabilities.includes("next_token")
                    : true)
              );
              if (capable.length >= 2) {
                const compUrl = `${serverBase.replace(
                  /\/$/,
                  ""
                )}/api/swarm/relay/compose`;
                const res = await fetch(compUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    code: preferCode,
                    prompt: question,
                    maxTokens: 256,
                    temperature: 0.7,
                  }),
                  signal: AbortSignal.timeout(60000),
                });
                if (res.ok) {
                  const json = await res.json();
                  const aiResponse = String(json?.text || "");
                  if (aiResponse) {
                    addMessageToSession(tgUserId, chatId, {
                      role: "assistant",
                      content: aiResponse,
                    });
                    await tgCall("sendMessage", {
                      chat_id: chatId,
                      text: aiResponse,
                    });
                    answered = true;
                  }
                }
              }
            }
          } catch {}
          if (answered) {
            return NextResponse.json({ ok: true });
          }
          // Build a best-first list of candidate examples across entries
          const entries = requestedCode
            ? aggregated.filter(
                (e: any) => String(e.code).toLowerCase() === requestedCode
              )
            : [...aggregated].sort(
                (a: any, b: any) =>
                  b.nodes - a.nodes || b.totalSeeders - a.totalSeeders
              );

          const candidates: {
            publicUrl: string;
            modelId: string;
            status: string;
            seeders?: number;
          }[] = [];
          for (const e of entries) {
            const examples = Array.isArray(e.examples) ? [...e.examples] : [];
            examples.sort((a: any, b: any) => {
              const sA = a.status === "serving" ? 1 : 0;
              const sB = b.status === "serving" ? 1 : 0;
              if (sA !== sB) return sB - sA;
              return (b.seeders || 0) - (a.seeders || 0);
            });
            for (const ex of examples) {
              candidates.push({
                publicUrl: ex.publicUrl,
                modelId: ex.modelId,
                status: ex.status,
                seeders: ex.seeders,
              });
            }
          }

          // Try remote peers first (non-self), best-first; collect a local candidate as fallback
          for (const c of candidates) {
            if (!c.publicUrl) continue;
            if (isSelf(c.publicUrl)) {
              chosenModelId = chosenModelId || c.modelId;
              continue;
            }
            try {
              const result = await remoteChat(
                c.publicUrl,
                c.modelId,
                messages,
                512,
                0.7
              );
              const aiResponse = result.content || "No response";
              addMessageToSession(tgUserId, chatId, {
                role: "assistant",
                content: aiResponse,
              });
              await tgCall("sendMessage", {
                chat_id: chatId,
                text: aiResponse,
              });
              answered = true;
              break;
            } catch (e) {
              // Try next candidate on failure
              try {
                console.warn(
                  "[Swarm] remoteChat failed for",
                  c.publicUrl,
                  (e as any)?.message || e
                );
              } catch {}
              continue;
            }
          }
        }

        if (!answered) {
          // Local routing fallback
          let modelId = getActiveSession(tgUserId, chatId)?.modelId;
          const serving = getServingModels();

          // If registry gave us a local modelId, prioritize it
          if (!modelId && chosenModelId) modelId = chosenModelId;

          // If a short code is provided, try to match it locally
          if (!modelId && requestedCode) {
            const codeFor = (m: any) => {
              if (m.infoHash)
                return String(m.infoHash).slice(0, 7).toLowerCase();
              const basis =
                m.repoId && m.fileName ? `${m.repoId}::${m.fileName}` : m.id;
              return createHash("sha1")
                .update(basis)
                .digest("hex")
                .slice(0, 7)
                .toLowerCase();
            };
            const match =
              serving.find((m) => codeFor(m) === requestedCode) ||
              getAllModels().find((m) => codeFor(m) === requestedCode);
            if (match) modelId = match.id;
          }

          if (!modelId) {
            if (serving.length === 1) {
              modelId = serving[0].id;
            } else if (serving.length > 1) {
              modelId = serving[0]?.id;
            }
          }

          if (!modelId) {
            const { handleAiChatCommand } = await import(
              "@/lib/bot/ai-commands"
            );
            const { message, keyboard } = handleAiChatCommand();
            await tgCall("sendMessage", {
              chat_id: chatId,
              text:
                message +
                "\n\nTip: Use /ai-seeding to view codes, then `/ask <message> #<code>` or start a server with `/ai-serve <model_id>`.",
              parse_mode: "Markdown",
              reply_markup: keyboard,
            });
            return NextResponse.json({ ok: true });
          }

          // Ensure session exists on this user+chat+model and run locally
          getChatSession(tgUserId, chatId, modelId);
          const data = await chat({
            modelId,
            messages,
            maxTokens: 512,
            temperature: 0.7,
            stream: false,
          });
          const aiResponse = data.content || "No response";
          addMessageToSession(tgUserId, chatId, {
            role: "assistant",
            content: aiResponse,
          });
          await tgCall("sendMessage", { chat_id: chatId, text: aiResponse });
        }
      } catch (err: any) {
        await tgCall("sendMessage", {
          chat_id: chatId,
          text: `Error: ${err?.message || "unknown"}`,
        });
      }

      return NextResponse.json({ ok: true });
    }

    // If we are waiting for an address from this user in DM, handle it first
    if (
      chatType === "private" &&
      !isCommand &&
      pendingAddressByUser.has(tgUserId)
    ) {
      const ctx = pendingAddressByUser.get(tgUserId)!;
      const addr = await resolveEnsOrAddress(text);
      if (!addr) {
        await reply(
          "Could not parse that as an address or ENS. Please send a valid 0x address or ens name."
        );
        return NextResponse.json({ ok: true });
      }
      try {
        const apiBase = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const rest = await fetch(`${apiBase}/api/invoice`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "x-internal": process.env.INTERNAL_API_KEY || "",
          },
          body: JSON.stringify({
            payee: addr,
            amount: Number(ctx.ethAmount),
            note: ctx.note || "",
            kind: "request",
            initData: "",
          }),
        });
        if (!rest.ok) {
          const t = await rest.text();
          await reply(
            `Failed to create invoice: ${rest.status} ${rest.statusText}`
          );
          pendingAddressByUser.delete(tgUserId);
          return NextResponse.json({ ok: true, error: t });
        }
        const json = await rest.json();
        const id = json.requestId || json.requestID || json.id;
        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const openUrl = `${baseUrl}/pay/${id}`;
        const keyboard = {
          inline_keyboard: [[{ text: "Open", web_app: { url: openUrl } }]],
        } as any;
        await tg.sendMessage(
          chatId,
          `Request: ${formatEthTrimmed(BigInt(Math.round(ctx.ethAmount * 1e18)))} ETH${
            ctx.note ? ` — ${ctx.note}` : ""
          }`
        );
        pendingAddressByUser.delete(tgUserId);
        return NextResponse.json({ ok: true, id, payUrl: openUrl });
      } catch (err: any) {
        await reply(`Error creating request: ${err?.message || "unknown"}`);
        pendingAddressByUser.delete(tgUserId);
        return NextResponse.json({ ok: false });
      }
    }

    if (/^\/start\b/.test(text)) {
      const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;

      // Extract referral code from /start ref_DIAL-ABC123
      const refMatch = text.match(/ref[_-]?(DIAL-[A-Z0-9]{6})/i);
      const refCode = refMatch ? refMatch[1] : null;

      let message = `💎 *Dial Crypto Pay Bot*\n\nWelcome to Dial Pay - the easiest way to send and receive crypto on Telegram.\n\n*Commands:*\n• \`/invoice <amount> <asset>\` - Create invoice\n• \`/send @user <amount> <asset>\` - Send crypto\n• \`/balance\` - View wallet\n• \`/startparty\` - Create party room\n• \`/listparty\` - Browse parties\n\n*Supported:* USDT, USDC, ETH, BTC, TON, BNB, SOL`;

      // Add referral notice if code is present
      if (refCode) {
        message =
          `🎉 *You were referred!*\n\nReferral code: \`${refCode}\`\n\n` +
          message;
      }

      // In private chats, use web_app for native mini app experience
      // In groups, fall back to regular URL buttons
      const isPrivate = chatType === "private";

      // Add referral code to URLs if present
      const refParam = refCode ? `?ref=${refCode}` : "";
      const mainUrl = `${baseUrl}${refParam}`;
      const referralsUrl = `${baseUrl}/referrals${refParam}`;

      const keyboard = {
        inline_keyboard: [
          [
            isPrivate
              ? { text: "💰 Open Dial Pay", web_app: { url: mainUrl } }
              : { text: "💰 Open Dial Pay", url: mainUrl },
          ],
          [
            isPrivate
              ? {
                  text: "📨 Create Invoice",
                  web_app: {
                    url: `${baseUrl}?action=invoice${
                      refCode ? `&ref=${refCode}` : ""
                    }`,
                  },
                }
              : {
                  text: "📨 Create Invoice",
                  url: `${baseUrl}?action=invoice${
                    refCode ? `&ref=${refCode}` : ""
                  }`,
                },
            isPrivate
              ? {
                  text: "⚡ Send Payment",
                  web_app: {
                    url: `${baseUrl}?action=send${
                      refCode ? `&ref=${refCode}` : ""
                    }`,
                  },
                }
              : {
                  text: "⚡ Send Payment",
                  url: `${baseUrl}?action=send${
                    refCode ? `&ref=${refCode}` : ""
                  }`,
                },
          ],
          [
            isPrivate
              ? { text: "🤝 Referrals", web_app: { url: referralsUrl } }
              : { text: "🤝 Referrals", url: referralsUrl },
            isPrivate
              ? {
                  text: "🎉 Party Rooms",
                  web_app: { url: "https://staging.dial.wtf" },
                }
              : { text: "🎉 Party Rooms", url: "https://staging.dial.wtf" },
          ],
        ],
      };

      // Send photo with caption and inline keyboard
      const logoUrl = `${baseUrl}/phone.logo.no.bg.png`;
      const result = await tgCall("sendPhoto", {
        chat_id: chatId,
        photo: logoUrl,
        caption: message,
        reply_markup: keyboard,
        parse_mode: "Markdown",
      });

      if (DEBUG && !result.ok) {
        await reply(`Debug: sendPhoto failed - ${JSON.stringify(result)}`);
      }

      return NextResponse.json({ ok: true });
    }

    // /startparty - Create a new party room on dial.wtf
    if (/^\/startparty\b/i.test(text)) {
      const apiKey = process.env.PUBLIC_API_KEY_TELEGRAM;
      if (!apiKey) {
        await reply("Server missing PUBLIC_API_KEY_TELEGRAM");
        return NextResponse.json({ ok: false }, { status: 200 });
      }

      // Get user's wallet address
      let owner: string | undefined;
      const parts = text.split(/\s+/);
      const providedAddr = parts[1];

      // If user provided an address, use that
      if (providedAddr && /^0x[0-9a-fA-F]{40}$/i.test(providedAddr)) {
        owner = providedAddr.toLowerCase();
      } else {
        // Try to get from Privy
        try {
          const privy = await getPrivyClient();
          if (privy) {
            const user = await privy
              .users()
              .getByTelegramUserID({ telegram_user_id: tgUserId });
            const w = (user.linked_accounts || []).find(
              (a: any) =>
                a.type === "wallet" && typeof (a as any).address === "string"
            );
            const addr = (w as any)?.address as string | undefined;
            if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) owner = addr;
          }
        } catch (err: any) {
          if (DEBUG) {
            await reply(
              `dbg: Privy lookup failed: ${err?.message || "unknown"}`
            );
          }
        }
      }

      if (!owner) {
        await reply(
          "No wallet found. Usage: /startparty <your_wallet_address>\n\nExample: /startparty 0xaA64...337c"
        );
        return NextResponse.json({ ok: true });
      }

      try {
        const response = await fetch(
          "https://staging.dial.wtf/api/v1/party-lines",
          {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              owner,
              telegramUserId: String(tgUserId),
              telegramChatId: String(chatId),
            }),
          }
        );

        if (!response.ok) {
          const error = await response.text();
          await reply(
            `Failed to create party room: ${response.status} ${response.statusText}`
          );
          return NextResponse.json({ ok: false, error });
        }

        const apiResponse = await response.json();
        if (DEBUG) {
          await reply(`dbg: API response: ${JSON.stringify(apiResponse)}`);
        }

        const data = apiResponse.data || apiResponse;
        const joinUrl = data.joinUrl;
        const roomCode = data.roomCode;
        const partyId =
          data.id || data.partyLineId || data.contractAddress || data.address;

        if (!joinUrl && !partyId) {
          await reply(`⚠️ Party room created but no ID or joinUrl returned.`);
          return NextResponse.json({ ok: true, data: apiResponse });
        }

        // Replace dial.wtf with staging.dial.wtf in joinUrl
        const partyLineUrl = joinUrl
          ? joinUrl.replace("https://dial.wtf/", "https://staging.dial.wtf/")
          : `https://staging.dial.wtf/party/${roomCode || partyId}`;
        const message = `🎉 Party room created!\n\nOwner: ${owner}\nRoom Code: ${
          roomCode || "N/A"
        }`;
        const keyboard = {
          inline_keyboard: [[{ text: "Open Party Room", url: partyLineUrl }]],
        };
        await tgCall("sendMessage", {
          chat_id: chatId,
          text: message,
          reply_markup: keyboard,
        });
        return NextResponse.json({ ok: true, data: apiResponse });
      } catch (err: any) {
        await reply(`Error creating party room: ${err?.message || "unknown"}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /listparty - List all open party rooms
    if (/^\/listparty\b/i.test(text)) {
      const apiKey = process.env.PUBLIC_API_KEY_TELEGRAM;
      if (!apiKey) {
        await reply("Server missing PUBLIC_API_KEY_TELEGRAM");
        return NextResponse.json({ ok: false }, { status: 200 });
      }

      try {
        // Query all party lines (not just active ones)
        const response = await fetch(
          "https://staging.dial.wtf/api/v1/party-lines?limit=100",
          {
            method: "GET",
            headers: {
              "x-api-key": apiKey,
            },
          }
        );

        if (!response.ok) {
          const error = await response.text();
          await reply(
            `Failed to fetch party rooms: ${response.status} ${response.statusText}`
          );
          return NextResponse.json({ ok: false, error });
        }

        const apiResponse = await response.json();

        if (DEBUG) {
          const shortResp = JSON.stringify(apiResponse).slice(0, 500);
          await reply(`dbg: Raw response: ${shortResp}`);
        }

        // API returns: { success: true, data: { partyLines: [...], pagination: {...} } }
        const partyLines = apiResponse?.data?.partyLines || [];

        if (DEBUG) {
          await reply(`dbg: Found ${partyLines.length} party rooms`);
        }

        if (partyLines.length === 0) {
          await reply(
            "No open party rooms found. Use /startparty to create one!"
          );
          return NextResponse.json({ ok: true, data: [] });
        }

        let message = `🎊 Open Party Rooms (${partyLines.length}):\n\n`;
        partyLines.slice(0, 10).forEach((party: any, idx: number) => {
          const roomCode = party.roomCode || "N/A";
          const owner = party.owner || "Unknown";
          const joinUrl = party.joinUrl
            ? party.joinUrl.replace(
                "https://dial.wtf/",
                "https://staging.dial.wtf/"
              )
            : "";
          message += `${idx + 1}. ${roomCode}\n   Owner: ${owner.slice(
            0,
            10
          )}...${owner.slice(-6)}\n   ${joinUrl}\n\n`;
        });

        if (partyLines.length > 10) {
          message += `\n...and ${partyLines.length - 10} more`;
        }

        await reply(message);
        return NextResponse.json({ ok: true, data: partyLines });
      } catch (err: any) {
        await reply(`Error fetching party rooms: ${err?.message || "unknown"}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /findparty <keyword> - Search for a party room by keyword (name, room code, owner, or contract address)
    if (/^\/findparty\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const searchQuery = parts.slice(1).join(" ").trim();

      if (!searchQuery) {
        await reply(
          "Usage: /findparty <keyword>\n\nSearch by party name, room code, owner address, or contract address"
        );
        return NextResponse.json({ ok: true });
      }

      const apiKey = process.env.PUBLIC_API_KEY_TELEGRAM;
      if (!apiKey) {
        await reply("Server missing PUBLIC_API_KEY_TELEGRAM");
        return NextResponse.json({ ok: false }, { status: 200 });
      }

      try {
        // Use the API's search parameter for server-side filtering
        const searchUrl = `https://staging.dial.wtf/api/v1/party-lines?search=${encodeURIComponent(
          searchQuery
        )}&isActive=true&limit=50`;
        const response = await fetch(searchUrl, {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
          },
        });

        if (!response.ok) {
          const error = await response.text();
          await reply(
            `Failed to search party rooms: ${response.status} ${response.statusText}`
          );
          return NextResponse.json({ ok: false, error });
        }

        const apiResponse = await response.json();
        const partyLines = apiResponse?.data?.partyLines || [];

        if (partyLines.length === 0) {
          await reply(
            `No party rooms found matching: "${searchQuery}"\n\nTry searching by party name, room code, owner address, or contract address`
          );
          return NextResponse.json({ ok: true, data: [] });
        }

        let message = `🔍 Found ${partyLines.length} matching party room${
          partyLines.length > 1 ? "s" : ""
        }:\n\n`;
        partyLines.slice(0, 5).forEach((party: any, idx: number) => {
          const name = party.name || party.roomCode || "Unnamed";
          const roomCode = party.roomCode || "N/A";
          const owner = party.owner || "Unknown";
          const contractAddr = party.contractAddress || party.address || "N/A";
          const joinUrl = party.joinUrl
            ? party.joinUrl.replace(
                "https://dial.wtf/",
                "https://staging.dial.wtf/"
              )
            : "";

          message += `${idx + 1}. ${name}\n`;
          if (party.name && party.roomCode) message += `   Code: ${roomCode}\n`;
          message += `   Owner: ${owner.slice(0, 10)}...${owner.slice(-6)}\n`;
          if (contractAddr !== "N/A")
            message += `   Contract: ${contractAddr.slice(
              0,
              10
            )}...${contractAddr.slice(-6)}\n`;
          message += `   ${joinUrl}\n\n`;
        });

        if (partyLines.length > 5) {
          message += `\n...and ${partyLines.length - 5} more`;
        }

        await reply(message);
        return NextResponse.json({ ok: true, data: partyLines });
      } catch (err: any) {
        await reply(
          `Error searching party rooms: ${err?.message || "unknown"}`
        );
        return NextResponse.json({ ok: false });
      }
    }

    // /invoice <amount> <asset> [description] - Create crypto invoice
    if (/^\/invoice\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const amount = parseFloat(parts[1] || "0");
      const asset = (parts[2] || "USDC").toUpperCase();
      const description = parts.slice(3).join(" ") || undefined;

      if (!amount || amount <= 0) {
        await reply(
          "Usage: /invoice <amount> <asset> [description]\n\nExample: /invoice 10 USDC Payment for service\n\nAssets: USDT, USDC, ETH, BTC, TON, BNB, SOL"
        );
        return NextResponse.json({ ok: true });
      }

      const validAssets = [
        "USDT",
        "USDC",
        "ETH",
        "BTC",
        "TON",
        "BNB",
        "TRX",
        "LTC",
        "SOL",
      ];
      if (!validAssets.includes(asset)) {
        await reply(
          `Invalid asset: ${asset}\n\nSupported: ${validAssets.join(", ")}`
        );
        return NextResponse.json({ ok: true });
      }

      try {
        let payee: string | undefined;
        try {
          const privy = await getPrivyClient();
          if (privy) {
            const user = await privy
              .users()
              .getByTelegramUserID({ telegram_user_id: tgUserId });
            const w = (user.linked_accounts || []).find(
              (a: any) =>
                a.type === "wallet" && typeof (a as any).address === "string"
            );
            payee = (w as any)?.address as string | undefined;
          }
        } catch {}

        if (!payee) {
          const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
          await reply(
            "No wallet connected. Open the app to connect your wallet first."
          );
          return NextResponse.json({ ok: true });
        }

        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const res = await fetch(`${baseUrl}/api/crypto/invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currency_type: "crypto",
            asset,
            amount: String(amount),
            description,
            payee,
            telegram_user_id: tgUserId,
          }),
        });

        const data = await res.json();
        if (!data.ok || !data.result) {
          await reply(
            `Failed to create invoice: ${data.error || "unknown error"}`
          );
          return NextResponse.json({ ok: false });
        }

        const invoice = data.result;
        const assetEmojis: any = {
          USDT: "💵",
          USDC: "💵",
          ETH: "Ξ",
          BTC: "₿",
          TON: "💎",
          BNB: "🔶",
          SOL: "◎",
          TRX: "🔺",
          LTC: "Ł",
        };
        const emoji = assetEmojis[asset] || "💰";
        const message = `${emoji} Invoice Created\n\nAmount: ${amount} ${asset}\n${
          description ? `Description: ${description}\n` : ""
        }Status: Active`;

        const keyboard = {
          inline_keyboard: [[{ text: "Pay Invoice", url: invoice.pay_url }]],
        };

        await tgCall("sendMessage", {
          chat_id: chatId,
          text: message,
          reply_markup: keyboard,
        });
        return NextResponse.json({ ok: true, result: invoice });
      } catch (err: any) {
        await reply(`Error creating invoice: ${err?.message || "unknown"}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /send <user_id|@username> <amount> <asset> [comment] - Send crypto
    if (/^\/send\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const userTarget = parts[1];
      const amount = parseFloat(parts[2] || "0");
      const asset = (parts[3] || "USDC").toUpperCase();
      const comment = parts.slice(4).join(" ") || undefined;

      if (!userTarget || !amount || amount <= 0) {
        await reply(
          "Usage: /send <user_id|@username> <amount> <asset> [comment]\n\nExample: /send @john 5 USDC Thanks!\n\nAssets: USDT, USDC, ETH, BTC, TON, BNB, SOL"
        );
        return NextResponse.json({ ok: true });
      }

      const validAssets = [
        "USDT",
        "USDC",
        "ETH",
        "BTC",
        "TON",
        "BNB",
        "TRX",
        "LTC",
        "SOL",
      ];
      if (!validAssets.includes(asset)) {
        await reply(
          `Invalid asset: ${asset}\n\nSupported: ${validAssets.join(", ")}`
        );
        return NextResponse.json({ ok: true });
      }

      const targetUserId = userTarget.startsWith("@")
        ? null
        : parseInt(userTarget);
      if (!targetUserId && !userTarget.startsWith("@")) {
        await reply("Invalid user. Use user ID or @username");
        return NextResponse.json({ ok: true });
      }

      try {
        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const spendId = `spend_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 15)}`;

        const res = await fetch(`${baseUrl}/api/crypto/transfer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: targetUserId || 0,
            asset,
            amount: String(amount),
            spend_id: spendId,
            comment,
          }),
        });

        const data = await res.json();
        if (!data.ok || !data.result) {
          await reply(`Failed to send: ${data.error || "unknown error"}`);
          return NextResponse.json({ ok: false });
        }

        const transfer = data.result;
        const assetEmojis: any = {
          USDT: "💵",
          USDC: "💵",
          ETH: "Ξ",
          BTC: "₿",
          TON: "💎",
          BNB: "🔶",
          SOL: "◎",
          TRX: "🔺",
          LTC: "Ł",
        };
        const emoji = assetEmojis[asset] || "💰";
        await reply(
          `✅ ${emoji} Sent ${amount} ${asset} to ${userTarget}${
            comment ? `\n\n"${comment}"` : ""
          }`
        );
        return NextResponse.json({ ok: true, result: transfer });
      } catch (err: any) {
        await reply(`Error sending: ${err?.message || "unknown"}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /check <amount> <asset> [pin_to_user] - Create crypto voucher
    if (/^\/check\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const amount = parseFloat(parts[1] || "0");
      const asset = (parts[2] || "USDC").toUpperCase();
      const pinTo = parts[3];

      if (!amount || amount <= 0) {
        await reply(
          "Usage: /check <amount> <asset> [pin_to_user]\n\nExample: /check 10 USDC @john\n\nAssets: USDT, USDC, ETH, BTC, TON, BNB, SOL"
        );
        return NextResponse.json({ ok: true });
      }

      const validAssets = [
        "USDT",
        "USDC",
        "ETH",
        "BTC",
        "TON",
        "BNB",
        "TRX",
        "LTC",
        "SOL",
      ];
      if (!validAssets.includes(asset)) {
        await reply(
          `Invalid asset: ${asset}\n\nSupported: ${validAssets.join(", ")}`
        );
        return NextResponse.json({ ok: true });
      }

      try {
        const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
        const payload: any = { asset, amount: String(amount) };

        if (pinTo) {
          if (pinTo.startsWith("@")) {
            payload.pin_to_username = pinTo.substring(1);
          } else {
            payload.pin_to_user_id = parseInt(pinTo);
          }
        }

        const res = await fetch(`${baseUrl}/api/crypto/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!data.ok || !data.result) {
          await reply(
            `Failed to create check: ${data.error || "unknown error"}`
          );
          return NextResponse.json({ ok: false });
        }

        const check = data.result;
        const assetEmojis: any = {
          USDT: "💵",
          USDC: "💵",
          ETH: "Ξ",
          BTC: "₿",
          TON: "💎",
          BNB: "🔶",
          SOL: "◎",
          TRX: "🔺",
          LTC: "Ł",
        };
        const emoji = assetEmojis[asset] || "💰";
        const message = `🎁 ${emoji} Crypto Check Created\n\nAmount: ${amount} ${asset}\n${
          pinTo ? `Pinned to: ${pinTo}\n` : ""
        }Status: Active`;

        const keyboard = {
          inline_keyboard: [[{ text: "Claim Check", url: check.check_url }]],
        };

        await tgCall("sendMessage", {
          chat_id: chatId,
          text: message,
          reply_markup: keyboard,
        });
        return NextResponse.json({ ok: true, result: check });
      } catch (err: any) {
        await reply(`Error creating check: ${err?.message || "unknown"}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /balance - View wallet balance
    if (/^\/balance\b/i.test(text)) {
      try {
        let walletAddr: string | undefined;
        try {
          const privy = await getPrivyClient();
          if (privy) {
            const user = await privy
              .users()
              .getByTelegramUserID({ telegram_user_id: tgUserId });
            const w = (user.linked_accounts || []).find(
              (a: any) =>
                a.type === "wallet" && typeof (a as any).address === "string"
            );
            walletAddr = (w as any)?.address as string | undefined;
          }
        } catch {}

        if (!walletAddr) {
          await reply(
            "No wallet connected. Open the app to connect your wallet first."
          );
          return NextResponse.json({ ok: true });
        }

        await reply(
          `💰 Your Wallet\n\nAddress: ${walletAddr.slice(
            0,
            6
          )}...${walletAddr.slice(
            -4
          )}\n\nConnect your wallet in the app to view balances and manage crypto payments.`
        );
        return NextResponse.json({ ok: true });
      } catch (err: any) {
        await reply(`Error: ${err?.message || "unknown"}`);
        return NextResponse.json({ ok: false });
      }
    }

    // AI COMMANDS - Decentralized AI Model Serving

    // /ai <url> - Download model from HuggingFace
    if (/^\/ai\s+https?:\/\//i.test(text)) {
      const { handleAiDownloadCommand } = await import("@/lib/bot/ai-commands");
      const url = text.split(/\s+/).slice(1).join(" ");
      const message = await handleAiDownloadCommand(url);
      await tgCall("sendMessage", {
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      });

      // Trigger background download directly (no internal HTTP)
      try {
        (async () => {
          try {
            const { addModelFromHuggingFace } = await import(
              "@/lib/ai-model-manager"
            );
            await addModelFromHuggingFace({
              huggingFaceUrl: url,
              createTorrent: false,
            });
          } catch (e) {
            try {
              console.error("[Bot] AI download error:", e);
            } catch {}
          }
        })();
      } catch (err) {
        console.error("[Bot] Failed to trigger download:", err);
      }

      return NextResponse.json({ ok: true });
    }

    // /ai-list, /ai_list, or /ailist - List downloaded models
    if (/^\/ai[-_]?list\b/i.test(text)) {
      const { handleAiListCommand } = await import("@/lib/bot/ai-commands");
      const message = handleAiListCommand();
      await tgCall("sendMessage", {
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      });
      return NextResponse.json({ ok: true });
    }

    // /ai-serve, /ai_serve, or /aiserve <model_id> - Start serving a model
    if (/^\/ai[-_]?serve\b/i.test(text)) {
      const { handleAiServeCommand, getServeSelectionKeyboard } = await import(
        "@/lib/bot/ai-commands"
      );
      const parts = text.split(/\s+/);
      const modelId = parts[1];
      const message = handleAiServeCommand(modelId);

      if (!modelId) {
        const keyboard = getServeSelectionKeyboard();
        await tgCall("sendMessage", {
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
        return NextResponse.json({ ok: true });
      }

      await tgCall("sendMessage", {
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      });

      // Federated serving policy: if a remote peer is already serving this model code, don't start locally.
      try {
        const { getModelById } = await import("@/lib/ai-model-storage");
        const m = getModelById(modelId);
        if (m) {
          const serverBase = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
          const norm = (u: string) => u.replace(/\/$/, "").toLowerCase();
          const isSelf = (u: string) => norm(u) === norm(serverBase);
          const { listAggregated } = await import("@/lib/swarm-client");
          const { createHash } = await import("crypto");
          const code = m.infoHash
            ? String(m.infoHash).slice(0, 7).toLowerCase()
            : createHash("sha1")
                .update(
                  m.repoId && m.fileName ? `${m.repoId}::${m.fileName}` : m.id
                )
                .digest("hex")
                .slice(0, 7)
                .toLowerCase();
          const aggregated = await listAggregated(serverBase).catch(
            () => [] as any[]
          );
          const entry = aggregated.find(
            (e: any) => String(e.code).toLowerCase() === code
          );
          const remoteServing = entry?.examples?.find(
            (ex: any) =>
              ex.status === "serving" && ex.publicUrl && !isSelf(ex.publicUrl)
          );
          if (remoteServing) {
            await tgCall("sendMessage", {
              chat_id: chatId,
              text: `🤝 A peer is already serving this model (code: \`${code}\`).\n\nSkipping local server to federate. Use \`/ask <message> #${code}\` or just \`/ask ...\` to auto-route.`,
              parse_mode: "Markdown",
            });
            return NextResponse.json({ ok: true });
          }
        }
      } catch {}

      // Start serving directly and open chat session (no remote peer serving)
      try {
        const { startModelServer } = await import("@/lib/ai-inference");
        await startModelServer({ modelId });
        const { getChatSession } = await import("@/lib/ai-chat-session");
        getChatSession(tgUserId, chatId, modelId);
        await tgCall("sendMessage", {
          chat_id: chatId,
          text: `🤖 *Chat Session Started*\n\nModel: \`${modelId}\`\n\nSend me a message to chat with the AI.\n\nUse \`/ai-clear\` to end the session.`,
          parse_mode: "Markdown",
        });
      } catch (err: any) {
        console.error("[Bot] Failed to start serving/chat:", err);
        await tgCall("sendMessage", {
          chat_id: chatId,
          text: `❌ *Failed to start model server*\n\n${
            err?.message || "unknown error"
          }\n\nCheck:\n• Model file exists and is GGUF\n• LLAMA_SERVER_BIN is set in .env\n• Binary is executable`,
          parse_mode: "Markdown",
        });
      }

      return NextResponse.json({ ok: true });
    }

    // /ai-chat, /ai_chat, or /aichat <model_id> - Manually start a chat session with a serving model
    if (/^\/ai[-_]?chat\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const modelId = parts[1];
      if (!modelId) {
        await reply(
          "Usage: /ai-chat <model_id>\n\nUse /ai-list to see available models."
        );
        return NextResponse.json({ ok: true });
      }
      try {
        const { getModelById, getServeStatus } = await import(
          "@/lib/ai-model-storage"
        );
        const model = getModelById(modelId);
        if (!model) {
          await reply("❌ Model not found. Use /ai-list to see models.");
          return NextResponse.json({ ok: true });
        }
        const status = getServeStatus(modelId);
        if (!status?.isServing) {
          await reply(
            "❌ Model is not serving. Start it with /ai-serve <model_id> or use /ai."
          );
          return NextResponse.json({ ok: true });
        }
        const { getChatSession } = await import("@/lib/ai-chat-session");
        getChatSession(tgUserId, chatId, modelId);
        await reply(
          `🤖 *Chat Session Started*\n\nModel: \`${modelId}\`\n\nSend a message to chat.\nUse \`/ai-clear\` to end the session.`
        );
      } catch (err: any) {
        await reply(`Error: ${err?.message || "unknown"}`);
      }
      return NextResponse.json({ ok: true });
    }

    // /ai-stop, /ai_stop, or /aistop <model_id> - Stop serving a model
    if (/^\/ai[-_]?stop\b/i.test(text)) {
      const parts = text.split(/\s+/);
      const modelId = parts[1];

      if (!modelId) {
        await reply(
          "Usage: /ai-stop <model_id>\n\nUse /ai-list to see serving models."
        );
        return NextResponse.json({ ok: true });
      }

      try {
        const apiBase = req.nextUrl.origin;
        const res = await fetch(`${apiBase}/api/ai/serve?modelId=${modelId}`, {
          method: "DELETE",
        });

        if (res.ok) {
          await reply(`✅ Stopped serving model: \`${modelId}\``);
        } else {
          await reply(`❌ Failed to stop model: ${await res.text()}`);
        }
      } catch (err: any) {
        await reply(`Error: ${err?.message || "unknown"}`);
      }

      return NextResponse.json({ ok: true });
    }

    // /ai-help, /ai_help, or /aihelp - AI commands help
    if (/^\/ai[-_]?help\b/i.test(text)) {
      const { getAiHelpMessage } = await import("@/lib/bot/ai-commands");
      const message = getAiHelpMessage();
      await tgCall("sendMessage", {
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      });
      return NextResponse.json({ ok: true });
    }

    // /ai-setup, /ai_setup, or /aisetup - Provide one-click OS-specific installers
    if (/^\/ai[-_]?setup\b$/i.test(text)) {
      const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
      const macPkgUrl = process.env.MAC_INSTALLER_URL; // Signed & notarized PKG
      const message =
        `🛠️ *One-Click Installer*\n\n` +
        `Tap your OS to download the installer. Then double-click it to run.\n\n` +
        `This will:\n` +
        `• Install Node deps\n` +
        `• Build llama-server locally\n` +
        `• Configure .env for AI\n` +
        (macPkgUrl
          ? `\n✅ macOS link is signed & notarized to avoid Gatekeeper warnings.`
          : `\n⚠️ macOS .command may need right-click → Open on first run.`);
      const rows: any[] = [];
      // Quick confirm button
      rows.push([
        { text: "✅ I ran the installer", callback_data: "ai_setup_done" },
      ]);
      // macOS copy page (simplest path for users to copy command)
      rows.push([
        { text: "🧩 macOS: Copy Command Page", url: `${baseUrl}/ai/setup/mac` },
      ]);
      if (macPkgUrl) {
        rows.push([
          { text: "⬇️ macOS Installer (Signed PKG)", url: macPkgUrl },
        ]);
      } else {
        rows.push([
          {
            text: "⬇️ macOS Installer (.command)",
            url: `${baseUrl}/api/ai/setup/download/mac`,
          },
        ]);
      }
      rows.push([
        {
          text: "⬇️ Linux Installer (.sh)",
          url: `${baseUrl}/api/ai/setup/download/linux`,
        },
      ]);
      rows.push([
        {
          text: "⬇️ Linux GPU Installer (.sh)",
          url: `${baseUrl}/api/ai/setup/download/linux-gpu`,
        },
      ]);

      const keyboard = { inline_keyboard: rows } as any;
      await tgCall("sendMessage", {
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });

      // Also include the raw curl command for quick copy inside Telegram
      const curlCmd = `curl -fsSL ${baseUrl}/api/ai/setup/script | bash -s -- --auto`;
      const copyMsg = `macOS quick command:\n\n\`\`\`bash\n${curlCmd}\n\`\`\`\n\nAfter you run it, tap "I ran the installer" above.`;
      await tgCall("sendMessage", {
        chat_id: chatId,
        text: copyMsg,
        parse_mode: "Markdown",
      });
      return NextResponse.json({ ok: true });
    }

    // /ai-setup-gpu, /ai_setup_gpu, or /aisetupgpu - Highlight Linux GPU installer
    if (/^\/ai[-_]?setup[-_]?gpu\b$/i.test(text)) {
      const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
      const message =
        `🛠️ *One-Click GPU Installer (Linux CUDA)*\n\n` +
        `Tap to download, then double-click to run. If CUDA build fails, it falls back to CPU.\n`;
      const keyboard = {
        inline_keyboard: [
          [
            {
              text: "⬇️ Linux GPU Installer (.sh)",
              url: `${baseUrl}/api/ai/setup/download/linux-gpu`,
            },
          ],
        ],
      } as any;
      await tgCall("sendMessage", {
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
      return NextResponse.json({ ok: true });
    }

    // /ai - Chat with AI (show model selection or continue conversation)
    if (/^\/ai(?:@\S+)?\s*$/i.test(text)) {
      const { handleAiChatCommand } = await import("@/lib/bot/ai-commands");
      const { message, keyboard } = handleAiChatCommand();
      await tgCall("sendMessage", {
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
      return NextResponse.json({ ok: true });
    }

    // /ai-clear, /ai_clear, or /aiclear - Clear chat session
    if (/^\/ai[-_]?clear\b/i.test(text)) {
      const { clearSession } = await import("@/lib/ai-chat-session");
      clearSession(tgUserId, chatId);
      await reply(
        "🗑️ Chat session cleared. Use /ai to start a new conversation."
      );
      return NextResponse.json({ ok: true });
    }

    // Handle AI chat in private messages (if session is active)
    if (chatType === "private" && !isCommand) {
      const { getActiveSession, addMessageToSession, getSessionMessages } =
        await import("@/lib/ai-chat-session");
      const session = getActiveSession(tgUserId, chatId);

      if (session) {
        // User is in an active AI chat session
        try {
          // Add user message to session
          addMessageToSession(tgUserId, chatId, {
            role: "user",
            content: text,
          });

          // Get full conversation history
          const messages = getSessionMessages(tgUserId, chatId);

          // Send to AI
          const apiBase = req.nextUrl.origin;
          const res = await fetch(`${apiBase}/api/ai/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modelId: session.modelId,
              messages,
              maxTokens: 512,
              temperature: 0.7,
            }),
          });

          if (!res.ok) {
            await reply(
              `❌ AI error: ${await res.text()}\n\nUse /ai-clear to start over.`
            );
            return NextResponse.json({ ok: true });
          }

          const data = await res.json();
          const aiResponse = data.result?.content || "No response";

          // Add AI response to session
          addMessageToSession(tgUserId, chatId, {
            role: "assistant",
            content: aiResponse,
          });

          // Send response
          await reply(aiResponse);
          return NextResponse.json({ ok: true });
        } catch (err: any) {
          console.error("[Bot] AI chat error:", err);
          await reply(
            `Error: ${err?.message || "unknown"}\n\nUse /ai-clear to reset.`
          );
          return NextResponse.json({ ok: true });
        }
      }
    }

    // /request <amount> [note] [destination]
    if (/^\/request\b/i.test(text)) {
      // Construct bot-kit-compatible ctx object (before anything else)
      const ctx = {
        platform: "telegram",
        userId: String(msg?.from?.id),
        chatId: String(msg?.chat?.id),
        text: msg?.text || "",
        baseUrl: process.env.PUBLIC_BASE_URL || req.nextUrl.origin,
        locale: msg?.from?.language_code,
        meta: { msg, req, chatType: msg?.chat?.type },
        caps: {}, // TODO: fill in from real adapter
      };
      // Parse request command
      const parsed = parseRequest(ctx.text, process.env.BOT_USERNAME);
      const amt = parsed.amount as number;
      const note = parsed.memo;
      const explicitDest = parsed.payeeCandidate;
      if (!Number.isFinite(amt) || amt <= 0) {
        if (DEBUG) {
          await reply(`dbg: parse failed. raw="${ctx.text}"`);
        }
        await reply(
          "Usage: /request <eth_amount> [note] [destination]\n\nExample: /request 0.1 coffee vitalik.eth"
        );
        return NextResponse.json({ ok: true });
      }
      try {
        const apiBase = ctx.baseUrl;
        // Resolve payee: explicit destination > linked wallet > env fallback
        let payee: string | undefined;
        if (explicitDest) {
          const resolved = await resolveEnsOrAddress(explicitDest);
          if (resolved) payee = resolved;
        }
        if (!payee) {
          try {
            const privy = await getPrivyClient();
            if (privy) {
              const user = await privy
                .users()
                .getByTelegramUserID({ telegram_user_id: ctx.userId });
              const w = (user.linked_accounts || []).find(
                (a: any) =>
                  a.type === "wallet" && typeof (a as any).address === "string"
              );
              const addr = (w as any)?.address as string | undefined;
              if (addr && isValidEthereumAddress(addr)) payee = addr;
              else if ((w as any)?.id) {
                try {
                  const walletId = (w as any).id as string;
                  const details = await (privy as any)
                    .wallets()
                    .ethereum()
                    .get(walletId);
                  const a = details?.address as string | undefined;
                  if (a && isValidEthereumAddress(a)) payee = a;
                } catch {}
              }
            }
          } catch {}
        }
        if (!payee)
          payee =
            (process.env.PAYEE_ADDR as string | undefined) ||
            appConfig.payeeAddr ||
            undefined;
        if (!payee) {
          const baseUrl = ctx.baseUrl;
          const keyboard = {
            inline_keyboard: [
              [{ text: "Open app to link wallet", web_app: { url: baseUrl } }],
            ],
          } as any;
          pendingAddressByUser.set(Number(ctx.userId), {
            ethAmount: amt,
            note,
          });
          const combinedText =
            "No wallet linked. Open the app and sign in first, then retry /request.\n\nAlternatively, reply to this message with your receiving address or ENS.";
          await tgCall("sendMessage", {
            chat_id: ctx.chatId,
            text: combinedText,
            reply_markup: keyboard,
          });
          return NextResponse.json({ ok: true });
        }

        let rest: Response;
        try {
          if (DEBUG) {
            try {
              console.log("[BOT]/request -> POST", `${apiBase}/api/invoice`, {
                payee,
                amount: Number(amt),
                note,
              });
            } catch {}
          }
          rest = await fetch(`${apiBase}/api/invoice`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "x-internal": process.env.INTERNAL_API_KEY || "",
            },
            body: JSON.stringify({
              payee,
              amount: Number(amt),
              note,
              kind: "request",
              initData: "",
            }),
          });
        } catch (err: any) {
          if (DEBUG) {
            try {
              console.warn(
                "[BOT]/request fetch /api/invoice failed:",
                err?.message || err
              );
            } catch {}
          }
          throw err;
        }
        if (!rest.ok) {
          const t = await rest.text().catch(() => "");
          if (DEBUG) {
            try {
              console.warn(
                "[BOT]/request invoice non-OK:",
                rest.status,
                rest.statusText,
                t.slice(0, 300)
              );
            } catch {}
          }
          await reply(
            `Failed to create invoice: ${rest.status} ${rest.statusText}`
          );
          return NextResponse.json({ ok: true, error: t });
        }
        const json = await rest.json().catch(() => ({}) as any);
        if (DEBUG) {
          try {
            console.log(
              "[BOT]/request invoice OK response keys:",
              Object.keys(json || {})
            );
          } catch {}
        }
        const id = json.requestId || json.requestID || json.id;
        if (!id) {
          await reply("Invoice created but id missing");
          return NextResponse.json({ ok: true });
        }
        const baseUrl = ctx.baseUrl;
        const invUrl = `${baseUrl}/pay/${id}`;

        // Build QR using forwarder prediction (Create2) for improved wallet compatibility
        let ethUri: string | undefined;
        let lastEthWei: bigint | undefined = undefined;
        let lastNetworkId: string = "1";
        let savedInvoiceIndexKey: string | undefined;
        try {
          const feeAddress =
            process.env.FEE_ADDRESS || appConfig.feeAddr || undefined;
          const feePercentage = feeAddress
            ? bpsToPercentString(process.env.FEE_BPS || "50")
            : undefined;
          if (DEBUG) {
            try {
              console.log("[BOT]/request fetching pay calldata for id=", id);
            } catch {}
          }
          const payJson = await fetchPayCalldata(id, {
            feeAddress,
            feePercentage,
            apiKey: appConfig.request.apiKey || process.env.REQUEST_API_KEY,
          });
          if (DEBUG) {
            try {
              console.log(
                "[BOT]/request pay transactions:",
                Array.isArray((payJson as any)?.transactions)
                  ? (payJson as any).transactions.length
                  : 0
              );
            } catch {}
          }
          const fwd = extractForwarderInputs(payJson);
          if (DEBUG) {
            try {
              console.log("[BOT]/request forwarder inputs:", {
                proxy: fwd.requestProxy,
                to: fwd.beneficiary,
                feeAddress: fwd.feeAddress,
                feeAmountWei: String(fwd.feeAmountWei),
                hasAmount: typeof fwd.amountWei === "bigint",
              });
            } catch {}
          }

          // Compute network id and CreateX config
          const chainKey = String(appConfig.request.chain || "").toLowerCase();
          const NETWORK_ID_BY_CHAIN: Record<string, string> = {
            base: "8453",
            ethereum: "1",
            mainnet: "1",
            sepolia: "11155111",
          };
          const networkId = NETWORK_ID_BY_CHAIN[chainKey] || "1";
          lastNetworkId = networkId;
          lastEthWei =
            typeof fwd.amountWei === "bigint" ? fwd.amountWei : undefined;
          const createx = (
            process.env.CREATEX_ADDRESS ||
            process.env.CREATE_X ||
            ""
          ).trim() as `0x${string}`;
          if (!/^0x[0-9a-fA-F]{40}$/.test(createx))
            throw new Error("Missing CREATEX_ADDRESS");

          // Salt ties deposit address to request id and chain
          const salt = keccak256(
            toHex(`DIAL|${id}|${networkId}`)
          ) as `0x${string}`;
          const initCode = buildForwarderInitCode({
            requestProxy: fwd.requestProxy,
            beneficiary: fwd.beneficiary,
            paymentReferenceHex: fwd.paymentReferenceHex,
            feeAmountWei: fwd.feeAmountWei,
            feeAddress: fwd.feeAddress,
            bytecode: (ForwarderArtifact as any)?.bytecode as `0x${string}`,
          });
          if (DEBUG) {
            try {
              console.log("[BOT]/request predict input:", {
                networkId,
                createx,
                salt: salt.slice(0, 10) + "…",
                initCodeLen: initCode.length,
              });
            } catch {}
          }
          const predicted = predictCreate2AddressCreateX({
            deployer: createx,
            rawSalt: salt,
            initCode,
          });
          if (DEBUG) {
            try {
              console.log("[BOT]/request predicted address:", predicted);
            } catch {}
          }
          if (predicted && fwd.amountWei && fwd.amountWei > 0n) {
            const decVal = fwd.amountWei.toString(10);
            // Save predict context for webhook
            try {
              predictContextByAddress.set(String(predicted).toLowerCase(), {
                networkId,
                createx,
                salt,
                initCode,
              });
              requestIdByPredictedAddress.set(
                String(predicted).toLowerCase(),
                id
              );
            } catch {}
            // Persist invoice metadata to S3 for later lookup by predicted address (optional)
            try {
              const tgUserName: string = (
                ctx.meta.msg?.from?.username || ""
              ).toString();
              const lowerPred = String(predicted).toLowerCase();
              const fileName = `invoice-${lowerPred}-${
                tgUserName || "anon"
              }-${id}.json`;
              let s3Key = fileName;
              try {
                const s3env = await loadS3();
                if (!s3env) throw new Error("S3 not configured");
                const { PATH_INVOICES } = s3env as any;
                s3Key = `${PATH_INVOICES}${fileName}`;
              } catch {}
              savedInvoiceIndexKey = s3Key;
              const scanUrl = `https://scan.request.network/request/${id}`;
              const chainIdNum = Number(networkId) || 1;
              const payUri = buildEthereumUri({
                to: String(predicted),
                valueWeiDec: decVal,
                chainId: chainIdNum,
              });
              const record = {
                requestId: id,
                networkId,
                predictedAddress: String(predicted),
                salt,
                initCode,
                requestProxy: fwd.requestProxy,
                beneficiary: fwd.beneficiary,
                paymentReferenceHex: fwd.paymentReferenceHex,
                feeAmountWei: fwd.feeAmountWei.toString(),
                feeAddress: fwd.feeAddress,
                amountWei: decVal,
                ethereumUri: payUri,
                requestScanUrl: scanUrl,
                telegram: {
                  chatId: ctx.chatId,
                  chatType: ctx.meta.chatType,
                  userId: ctx.userId,
                  username: tgUserName || undefined,
                  commandText: ctx.text,
                },
                createdAt: new Date().toISOString(),
              } as const;
              const body = Buffer.from(JSON.stringify(record, null, 2));
              try {
                const s3env = await loadS3();
                if (s3env?.writeS3File) {
                  await (s3env as any).writeS3File(s3Key, {
                    Body: body,
                    ContentType: "application/json",
                  });
                }
              } catch {}
              if (DEBUG) {
                try {
                  console.log("[BOT]/request saved invoice json to S3:", s3Key);
                } catch {}
              }
            } catch (e) {
              if (DEBUG) {
                try {
                  console.warn(
                    "[BOT]/request failed to save invoice S3:",
                    (e as any)?.message || e
                  );
                } catch {}
              }
            }
            // Optional: Alchemy webhook integration removed (no-op if not configured)
            // Register address activity on Alchemy webhook (create once, then update addresses)
            try {
              const alchemyWebhookId = process.env.ALCHEMY_WEBHOOK_ID;
              if (alchemyWebhookId) {
                await updateWebhookAddresses({
                  webhookId: alchemyWebhookId,
                  add: [predicted as `0x${string}`],
                  remove: [],
                });
                if (DEBUG) {
                  try {
                    console.log(
                      "[BOT]/request alchemy: added address to webhook",
                      { webhookId: alchemyWebhookId, address: predicted }
                    );
                  } catch {}
                }
              } else {
                const created = await createAddressActivityWebhook({
                  addresses: [predicted as `0x${string}`],
                });
                if (DEBUG) {
                  try {
                    console.log(
                      "[BOT]/request alchemy: created webhook",
                      created
                    );
                  } catch {}
                }
              }
            } catch (e) {
              if (DEBUG) {
                try {
                  console.warn("[BOT] alchemy webhook setup failed", {
                    error: (e as any)?.message || e,
                  });
                } catch {}
              }
            }
            // Action registration temporarily disabled; focusing on alert only

            // Build direct ETH URI to pay predicted deposit address
            const chainIdNum = Number(networkId) || 1;
            ethUri = buildEthereumUri({
              to: predicted,
              valueWeiDec: decVal,
              chainId: chainIdNum,
            });
            if (DEBUG && ethUri) {
              try {
                console.log("[BOT] built ethUri (predict):", ethUri);
              } catch {}
            }
          }
        } catch (e) {
          if (DEBUG) {
            try {
              console.warn(
                "[BOT] forwarder predict failed; fallback to invoice link",
                (e as any)?.message || e
              );
            } catch {}
          }
        }
        // Build QR with ETH amount
        const ethWei = lastEthWei || BigInt(Math.round(amt * 1e18));
        const {
          qrUrl,
          caption,
          keyboard,
          payUrl: builtPayUrl,
        } = buildQrForRequest(baseUrl, id, ethUri, ethWei, note || "");

        // Build rich caption with ETH amount and network
        const netName =
          lastNetworkId === "1"
            ? "mainnet"
            : lastNetworkId === "8453"
              ? "base"
              : lastNetworkId === "11155111"
                ? "sepolia"
                : lastNetworkId;
        const richCaption = (() => {
          try {
            return formatCaptionRich({
              username:
                (ctx.meta.msg?.from?.username || "").toString() || undefined,
              ethWei,
              networkName: netName,
              note: note || "",
            });
          } catch {
            return caption;
          }
        })();

        // Build BotResponse object (bot-kit compatible)
        const botResponse: BotResponse = {
          body: richCaption,
          formatted_body: richCaption,
          format: "markdown" as const,
          images: [
            {
              url: qrUrl,
              caption: richCaption,
              captionMarkdown: true,
            },
          ],
          buttons: keyboard.inline_keyboard.flat().map((btn: any) => {
            if ("web_app" in btn) {
              return {
                id: btn.text,
                label: btn.text,
                webApp: { url: btn.web_app.url },
              };
            }
            if ("url" in btn) {
              return {
                id: btn.text,
                label: btn.text,
                url: btn.url,
              };
            }
            return { id: btn.text, label: btn.text };
          }),
          extensions: {
            "io.telegram": {
              parse_mode: "Markdown" as const,
              reply_markup: keyboard,
            },
          },
        };

        // Extract from botResponse for sending
        const imageToSend = botResponse.images?.[0];
        const captionToSend = imageToSend?.caption || botResponse.body || "";
        const keyboardToSend =
          botResponse.extensions?.["io.telegram"]?.reply_markup || keyboard;

        const sent = await tg.sendPhoto(
          ctx.chatId,
          imageToSend?.url || qrUrl,
          captionToSend,
          keyboardToSend
        );
        const messageId = sent?.result?.message_id as number | undefined;
        if (messageId) {
          try {
            requestContextById.set(id, {
              chatId: Number(ctx.chatId),
              messageId: Number(messageId),
              paidCaption: `✅ PAID — ${formatEthTrimmed(ethWei)} ETH${
                note ? ` — ${note}` : ""
              }`,
              replyMarkup: keyboard,
            });
          } catch {}
          // Write S3 indexes (optional)
          try {
            const s3env = await loadS3();
            if (s3env?.writeS3File) {
              const { PATH_INVOICES } = s3env as any;
              const idxKey = `${PATH_INVOICES}by-request/${id}.json`;
              const idxPayload = Buffer.from(
                JSON.stringify(
                  { chatId: ctx.chatId, messageId, requestId: id },
                  null,
                  2
                )
              );
              await (s3env as any).writeS3File(idxKey, {
                Body: idxPayload,
                ContentType: "application/json",
              });
              const byMsgKey = `${PATH_INVOICES}by-message/${ctx.chatId}/${messageId}.json`;
              const byMsgPayload = Buffer.from(
                JSON.stringify(
                  { chatId: ctx.chatId, messageId, requestId: id },
                  null,
                  2
                )
              );
              await (s3env as any).writeS3File(byMsgKey, {
                Body: byMsgPayload,
                ContentType: "application/json",
              });
            }
          } catch {}
        }

        return NextResponse.json({
          ok: true,
          id,
          payUrl: builtPayUrl || invUrl,
        });
      } catch (err: any) {
        await reply(`Error creating request: ${err?.message || "unknown"}`);
        return NextResponse.json({ ok: false });
      }
    }

    // /pay <toAddress> <amount>
    if (/^\/pay\b/.test(text)) {
      const parts = text.split(/\s+/);
      const to = parts[1];
      const amt = Number(parts[2] || "0");
      if (
        !to ||
        !/^0x[0-9a-fA-F]{40}$/.test(to) ||
        !Number.isFinite(amt) ||
        amt <= 0
      ) {
        await reply("Usage: /pay <toAddress> <amount>");
        return NextResponse.json({ ok: true });
      }

      // Find the Privy user by Telegram user id and get their wallet id
      const privy = await getPrivyClient();
      if (!privy) {
        await reply("Server wallet not configured.");
        return NextResponse.json({ ok: true });
      }
      const user = await privy
        .users()
        .getByTelegramUserID({ telegram_user_id: tgUserId });
      const wallet = user.linked_accounts.find(
        (a: any) => a.type === "wallet" && "id" in a
      );
      const walletId = (wallet as any)?.id;
      if (!walletId) {
        await reply("No wallet linked. Open the app and sign in first.");
        return NextResponse.json({ ok: true });
      }

      // Send a native transfer on Base (eip155:8453) @or USDC transfer if desired
      await privy
        .wallets()
        .ethereum()
        .sendTransaction(walletId, {
          caip2: "eip155:8453",
          params: {
            transaction: {
              to,
              value: "0x" + BigInt(Math.round(amt * 1e18)).toString(16),
            },
          },
        });

      await reply(`Sent ${amt} (native) to ${to}`);
      return NextResponse.json({ ok: true });
    }

    if (chatType === "private" && isCommand) {
      await reply("Unknown command. Try /pay or /request");
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "error" },
      { status: 200 }
    );
  }
}
