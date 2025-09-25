import { NextRequest, NextResponse } from "next/server";
import { validate } from "@telegram-apps/init-data-node";
import { RequestNetwork, Types } from "@requestnetwork/request-client.js";
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { amount, note, kind, initData, payee } = await req.json();

    // Allow browser testing outside Telegram in dev
    const allowBypass =
      process.env.ALLOW_UNVERIFIED_INITDATA === "1" &&
      process.env.NODE_ENV !== "production";

    if (!allowBypass) {
      if (!initData || typeof initData !== "string" || !initData.includes("hash=")) {
        return NextResponse.json(
          { error: "Missing Telegram initData hash. Open via Telegram or set ALLOW_UNVERIFIED_INITDATA=1 in dev." },
          { status: 401 }
        );
      }
      validate(initData, process.env.BOT_TOKEN!);
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    // If REQUEST_API_KEY is set, use REST API fallback to avoid client bundling issues
    const useRest = !!process.env.REQUEST_API_KEY;
    let requestId: string | undefined;
    let paymentReference: string | undefined;
    if (useRest) {
      const apiBase = process.env.REQUEST_REST_BASE || 'https://api.request.network/v1';
      const payload = {
        payee: payee || process.env.PAYEE_ADDR!,
        amount: String(amt),
        invoiceCurrency: 'USD',
        paymentCurrency: 'USDC-base',
      };
      const resp = await fetch(`${apiBase}/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.REQUEST_API_KEY as string,
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Request REST error: ${resp.status} ${resp.statusText} ${txt}`);
      }
      const json = await resp.json();
      requestId = json.requestID;
      paymentReference = json.paymentReference;
      const idForUrl = paymentReference || requestId!;
      const payUrl = `${process.env.PUBLIC_BASE_URL}/pay/${idForUrl}`;
      return NextResponse.json({ requestId: idForUrl, payUrl });
    }

    const client = new RequestNetwork({
      nodeConnectionConfig: {
        baseURL:
          process.env.REQUEST_NODE_URL || "https://main.gateway.request.network",
      },
    });

    // Configuration via env
    const chain = (process.env.REQUEST_CHAIN || "base").toLowerCase();
    const DEFAULT_BASE_USDC = "0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913"; // official USDC on Base
    const erc20Address = (process.env.ERC20_TOKEN_ADDRESS || "").trim();
    const currencyValue = erc20Address !== "" ? erc20Address : DEFAULT_BASE_USDC;

    // USDC default decimals (6). If you change token, adjust decimals accordingly.
    const expectedAmount = BigInt(Math.round(amt * 1e6)).toString();

    const created = await client.createRequest({
      requestInfo: {
        currency: {
          type: Types.RequestLogic.CURRENCY.ERC20,
          value: currencyValue,
          network: chain as any,
        },
        expectedAmount,
        payee: {
          type: Types.Identity.TYPE.ETHEREUM_ADDRESS,
          value: payee || process.env.PAYEE_ADDR!,
        },
        timestamp: Math.floor(Date.now() / 1000),
      },
      // Server "signs" the request creation (identity). Keep this as your payee/org address.
      signer: {
        type: Types.Identity.TYPE.ETHEREUM_ADDRESS,
        value: process.env.PAYEE_ADDR!,
      },
      contentData: { note, kind, brand: "Dial" },
      paymentNetwork: {
        id: Types.Extension.PAYMENT_NETWORK_ID.ERC20_FEE_PROXY_CONTRACT,
        parameters: {
          paymentNetworkName: chain as any,
          feeAddress: process.env.FEE_ADDR || process.env.PAYEE_ADDR!,
          feeAmount: "0",
          paymentAddress: payee || process.env.PAYEE_ADDR!,
        },
      },
    });

    await created.waitForConfirmation();

    const requestIdClient = created.requestId;
    const payUrl = `${process.env.PUBLIC_BASE_URL}/pay/${requestIdClient}`;
    return NextResponse.json({ requestId: requestIdClient, payUrl });
  } catch (e: any) {
    console.error("Invoice error:", e);
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 400 });
  }
}
