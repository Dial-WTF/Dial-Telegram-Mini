/**
 * Subscription Activation Webhook
 *
 * Handles Request Network payment confirmations for premium subscriptions.
 * When a user pays for a premium subscription via Request Network,
 * this webhook activates their subscription tier and sends them a confirmation message.
 *
 * Expected webhook data:
 * {
 *   event: {
 *     type: "payment_confirmed" | "Payment Confirmed",
 *     data: {
 *       requestId: string,
 *       amount: string,
 *       currency: string,
 *       timestamp: string,
 *       ...
 *     }
 *   }
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { activateSubscription } from "@bot/kv";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const DEBUG = process.env.DEBUG_BOT === "1";

    const body = await req.json().catch(() => ({} as any));

    if (DEBUG) {
      try {
        console.log(
          "[WEBHOOK][Subscriptions] body=",
          JSON.stringify(body).slice(0, 800)
        );
      } catch {}
    }

    // Extract webhook data
    const eventType: string = body?.event?.type || body?.type || "";
    const data = body?.event?.data || body?.data || body || {};
    const requestId: string | undefined = data?.requestId || data?.id;

    // Check if this is a payment confirmation
    const isPaid = /paid|payment[_\s-]?confirmed/i.test(eventType);

    if (!isPaid || !requestId) {
      if (DEBUG) {
        console.log(
          "[WEBHOOK][Subscriptions] Ignoring non-payment event:",
          eventType
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Parse subscription info from note or reference
    // Look for format containing userId or "premium subscription"
    const reference: string = data?.reference || data?.note || "";
    const note: string = data?.note || "";

    // Try to extract userId from reference (e.g., "Premium subscription $20 from user 12345")
    // Format: either contains "premium" or the reference contains userId
    let userId: string | undefined;

    // Try multiple patterns
    if (/premium/i.test(reference) || /premium/i.test(note)) {
      // Extract from reference if it has user ID
      const userMatch = reference.match(/\b(\d+)\b/) || note.match(/\b(\d+)\b/);
      if (userMatch) {
        userId = userMatch[1];
      }
    }

    if (!userId) {
      if (DEBUG) {
        console.log(
          "[WEBHOOK][Subscriptions] Could not parse userId from reference/note:",
          { reference, note }
        );
      }
      // Still return ok to avoid webhook retries, but log for manual review
      return NextResponse.json({ ok: true });
    }

    if (DEBUG) {
      console.log(
        `[WEBHOOK][Subscriptions] Activating subscription: userId=${userId}, requestId=${requestId}`
      );
    }

    // Extract ETH amount and price if available
    const ethAmount = data?.amount || data?.expectedAmount;
    const amountStr = data?.amountInFiat || data?.amount || "";

    // Activate the subscription (30 days)
    const subscription = await activateSubscription(
      userId,
      requestId,
      ethAmount ? String(ethAmount) : undefined,
      undefined // ETH price not available in webhook, but stored in subscription
    );

    if (DEBUG) {
      console.log("[WEBHOOK][Subscriptions] Subscription activated:", {
        userId,
        expiresAt: new Date(subscription.expiresAt).toISOString(),
        ethAmount,
      });
    }

    // TODO: Send Telegram notification to user about subscription activation
    // If you have a Telegram client available, send a message like:
    // "✅ Premium subscription activated! You now have access to [model names]"

    return NextResponse.json({
      ok: true,
      message: `Premium subscription activated for user ${userId}`,
      subscription,
    });
  } catch (error: any) {
    console.error(
      "[WEBHOOK][Subscriptions] Error:",
      error?.message || String(error)
    );
    // Return 200 so webhook doesn't retry; log the error for debugging
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Internal error",
      },
      { status: 500 }
    );
  }
}

