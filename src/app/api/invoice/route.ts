import { NextRequest, NextResponse } from "next/server";
import { validate } from "@telegram-apps/init-data-node";
import { RequestNetwork, Types } from "@requestnetwork/request-client.js";
import { appConfig } from "#/lib/config";
import { resolveEnsToHex, isValidHexAddress, normalizeHexAddress } from "#/lib/addr";
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { amount, note, kind, initData, payee } = await req.json();
    const DEBUG_REQ = process.env.DEBUG_REQUEST === '1';

    // Allow browser testing outside Telegram in dev, or trusted internal callers (bot)
    const allowBypass = appConfig.allowUnverifiedInitData;
    const internalHeader = req.headers.get('x-internal');
    const internalKey = process.env.INTERNAL_API_KEY || '';
    const isTrustedInternal = internalKey && internalHeader === internalKey;

    if (!allowBypass && !isTrustedInternal) {
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
      try {
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
          const txt = await resp.text().catch(() => '');
          if (DEBUG_REQ) { try { console.log('[REQ][REST] non-OK', resp.status, resp.statusText, txt.slice(0, 300)); } catch {} }
        } else {
          const json = await resp.json();
          if (DEBUG_REQ) { try { console.log('[REQ][REST] response', json); } catch {} }
          requestId = json.requestID || json.requestId;
          paymentReference = json.paymentReference;
          if (!requestId && !paymentReference) throw new Error('Missing requestId from Request REST response');
          const base = appConfig.publicBaseUrl || '';
          const payUrl = base ? `${base}/pay/${requestId}` : `/pay/${requestId}`;
          return NextResponse.json({ requestId, paymentReference, payUrl });
        }
      } catch (e: any) {
        if (DEBUG_REQ) { try { console.log('[REQ][REST] fetch failed; falling back to SDK:', e?.message || e); } catch {} }
        // fall through to SDK
      }
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
      // Sign the request as the same address as payee so invoice UI shows the input address
      signer: {
        type: Types.Identity.TYPE.ETHEREUM_ADDRESS,
        value: resolvedPayee!,
      },
      contentData: { note, kind, brand: "Dial" },
      // Use non-fee ERC20 proxy for now; later we can enable fee routes
      paymentNetwork: {
        id: Types.Extension.PAYMENT_NETWORK_ID.ERC20_PROXY_CONTRACT,
        parameters: {
          paymentNetworkName: chain as any,
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
