import { NextRequest, NextResponse } from "next/server";
import { validate } from "@telegram-apps/init-data-node";
import { RequestNetwork, Types } from "@requestnetwork/request-client.js";
import { appConfig } from "@/lib/config";
import { resolveEnsToHex, isValidHexAddress, normalizeHexAddress } from "@/lib/addr";
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { amount, note, kind, initData, payee } = await req.json();
    const DEBUG_REQ = process.env.DEBUG_REQUEST === '1';

    // Allow browser testing outside Telegram in dev
    const allowBypass = appConfig.allowUnverifiedInitData;

    if (!allowBypass) {
      if (!initData || typeof initData !== "string" || !initData.includes("hash=")) {
        return NextResponse.json(
          { error: "Missing Telegram initData hash. Open via Telegram or set ALLOW_UNVERIFIED_INITDATA=1 in dev." },
          { status: 401 }
        );
      }
      validate(initData, appConfig.telegram.botToken!);
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    // Resolve payee (supports ENS)
    let inputPayee: string | undefined = typeof payee === 'string' && payee.length > 0 ? String(payee) : appConfig.payeeAddr;
    let resolvedPayee: string | undefined = undefined;
    try {
      if (inputPayee) {
        if (isValidHexAddress(inputPayee)) {
          resolvedPayee = normalizeHexAddress(inputPayee);
        } else {
          resolvedPayee = await resolveEnsToHex(inputPayee, process.env.RPC_URL);
        }
      }
    } catch {}
    if (!resolvedPayee) {
      return NextResponse.json({ error: "Unable to resolve payee address" }, { status: 400 });
    }

    // If REQUEST_API_KEY is set, use REST API fallback to avoid client bundling issues
    const useRest = !!appConfig.request.apiKey;
    let requestId: string | undefined;
    let paymentReference: string | undefined;
    if (useRest) {
      const rawBase = (appConfig.request.restBase || 'https://api.request.network');
      const baseTrim = rawBase.replace(/\/$/, '');
      const endpoint = /\/v1$/.test(baseTrim)
        ? `${baseTrim}/request`
        : /\/v2$/.test(baseTrim)
        ? `${baseTrim}/request`
        : `${baseTrim}/v2/request`;
      const payload = {
        payee: resolvedPayee,
        amount: String(amt),
        invoiceCurrency: 'ETH-mainnet',
        paymentCurrency: 'ETH-mainnet',
        reference: note || '',
      };
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': appConfig.request.apiKey as string,
        'Accept': 'application/json',
      };
      if (DEBUG_REQ) {
        try {
          const masked = (k?: string) => (k ? `${k.slice(0, 5)}…${k.slice(-4)}` : '');
          console.log('[REQ][REST] endpoint=', endpoint);
          console.log('[REQ][REST] headers=', { ...headers, 'x-api-key': masked(headers['x-api-key']) });
          console.log('[REQ][REST] payload=', payload);
        } catch {}
      }
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        if (DEBUG_REQ) { try { console.log('[REQ][REST] error', resp.status, resp.statusText, txt); } catch {} }
        throw new Error(`Request REST error: ${resp.status} ${resp.statusText} ${txt}`);
      }
      const json = await resp.json();
      if (DEBUG_REQ) { try { console.log('[REQ][REST] response', json); } catch {} }
      requestId = json.requestID || json.requestId;
      paymentReference = json.paymentReference;
      const idForUrl = paymentReference || requestId;
      if (!idForUrl) throw new Error('Missing request id from Request REST response');
      const base = appConfig.publicBaseUrl || '';
      const payUrl = base ? `${base}/pay/${idForUrl}` : `/pay/${idForUrl}`;
      return NextResponse.json({ requestId: idForUrl, payUrl });
    }

    const client = new RequestNetwork({
      nodeConnectionConfig: {
        baseURL:
          appConfig.request.nodeUrl,
      },
    });

    // Configuration via env
    const chain = appConfig.request.chain;
    const erc20Address = (appConfig.request.erc20Address || "").trim();
    const currencyValue = erc20Address !== "" ? erc20Address : appConfig.request.defaultBaseUSDC;

    // USDC default decimals (6). If you change token, adjust decimals accordingly.
    const expectedAmount = BigInt(Math.round(amt * 1e6)).toString();

    if (DEBUG_REQ) {
      try {
        console.log('[REQ][SDK] config', {
          chain: appConfig.request.chain,
          nodeUrl: appConfig.request.nodeUrl,
          currency: appConfig.request.erc20Address || appConfig.request.defaultBaseUSDC,
          expectedAmount: BigInt(Math.round(amt * 1e6)).toString(),
          payee: resolvedPayee,
        });
      } catch {}
    }

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
          value: resolvedPayee!,
        },
        timestamp: Math.floor(Date.now() / 1000),
      },
      // Server "signs" the request creation (identity). Keep this as your payee/org address.
      signer: {
        type: Types.Identity.TYPE.ETHEREUM_ADDRESS,
        value: appConfig.payeeAddr!,
      },
      contentData: { note, kind, brand: "Dial" },
      paymentNetwork: {
        id: Types.Extension.PAYMENT_NETWORK_ID.ERC20_FEE_PROXY_CONTRACT,
        parameters: {
          paymentNetworkName: chain as any,
          feeAddress: appConfig.feeAddr || appConfig.payeeAddr!,
          feeAmount: "0",
          paymentAddress: resolvedPayee!,
        },
      },
    });

    await created.waitForConfirmation();

    const requestIdClient = created.requestId;
    const base = appConfig.publicBaseUrl || '';
    const payUrl = base ? `${base}/pay/${requestIdClient}` : `/pay/${requestIdClient}`;
    return NextResponse.json({ requestId: requestIdClient, payUrl });
  } catch (e: any) {
    console.error("Invoice error:", e);
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 400 });
  }
}
