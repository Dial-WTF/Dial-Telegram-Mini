import { NextRequest, NextResponse } from "next/server";
import { RequestNetwork } from "@requestnetwork/request-client.js";
import { s3 } from "#/services/s3/client";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { PATH_INVOICES } from "#/services/s3/filepaths";
import { AWS_S3_BUCKET } from "#/config/constants";
import { fetchPayCalldata, extractForwarderInputs } from "#/lib/requestApi";
import { buildForwarderInitCode } from "#/lib/create2x";
import ForwarderArtifact from "#/lib/contracts/DepositForwarderMinimal/DepositForwarderMinimal.json";
import { keccak256, toHex } from "viem";
import { appConfig } from "#/lib/config";
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    if (appConfig.request.apiKey) {
      const apiKey = appConfig.request.apiKey as string;
      const baseTrim = (appConfig.request.restBase || '').replace(/\/$/, '');
      const root = baseTrim.replace(/\/v[12]$/, '');
      // Try v2 first, then v1
      const candidates = [
        `${root}/v2/request/${id}`,
        `${root}/v1/request/${id}`,
        `${baseTrim}/request/${id}`,
      ];
      let data: any | undefined;
      let lastErr: string | undefined;
      for (const url of candidates) {
        try {
          const resp = await fetch(url, { headers: { 'x-api-key': apiKey, 'Accept': 'application/json' } });
          if (resp.ok) { data = await resp.json(); break; }
          lastErr = `REST ${resp.status}`;
        } catch (e: any) {
          lastErr = `REST error: ${e?.message || 'network'}`;
        }
      }
      if (data) {
        const paid = !!data?.hasBeenPaid;
        // try to attach ethereumUri by scanning invoices/<invoice-*-id.json>
        let ethereumUri: string | undefined;
        try {
          const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
          const list = await s3.send(new ListObjectsV2Command({ Bucket: AWS_S3_BUCKET, Prefix: `${PATH_INVOICES}invoice-` }));
          const match = (list?.Contents || []).find((o: any) => typeof o?.Key === 'string' && o.Key.endsWith(`-${id}.json`));
          if (match?.Key) {
            const obj2 = await s3.send(new GetObjectCommand({ Bucket: AWS_S3_BUCKET, Key: match.Key }));
            const txt2 = await (obj2.Body as any).transformToString();
            const rec2 = JSON.parse(txt2 || '{}');
            if (rec2?.ethereumUri) ethereumUri = String(rec2.ethereumUri);
          }
        } catch {}
        return NextResponse.json({ status: paid ? 'paid' : 'pending', balance: paid ? { balance: '1' } : { balance: '0' }, ethereumUri });
      }
      // Fallback to SDK if REST paths fail
      try {
        const client = new RequestNetwork({ nodeConnectionConfig: { baseURL: appConfig.request.nodeUrl } });
        const reqData = await client.fromRequestId(id);
        const balance = await (reqData as any).getBalance();
        const status = balance?.balance && BigInt(balance.balance) > BigInt(0) ? 'paid' : 'pending';
        return NextResponse.json({ status, balance });
      } catch {}
      return NextResponse.json({ status: 'error', error: lastErr || 'REST 404' });
    }
    const client = new RequestNetwork({
      nodeConnectionConfig: {
        baseURL: appConfig.request.nodeUrl,
      },
    });

    const reqData = await client.fromRequestId(id);
    // getBalance is available on the request instance; cast to any to satisfy types
    const balance = await (reqData as any).getBalance();

    const status = balance?.balance && BigInt(balance.balance) > BigInt(0) ? "paid" : "pending";

    // Try to compute ethereumUri if not found via S3/index
    let ethereumUri: string | undefined;
    try {
      const feeAddress = process.env.FEE_ADDRESS || appConfig.feeAddr || undefined;
      const feePercentage = feeAddress ? String(Number(process.env.FEE_BPS || '50') / 10000) : undefined;
      const payJson = await fetchPayCalldata(id, { feeAddress, feePercentage, apiKey: appConfig.request.apiKey || process.env.REQUEST_API_KEY });
      const fwd = extractForwarderInputs(payJson);
      const chainKey = String(appConfig.request.chain || '').toLowerCase();
      const NETWORK_ID_BY_CHAIN: Record<string, string> = { base: '8453', ethereum: '1', mainnet: '1', sepolia: '11155111' };
      const networkId = NETWORK_ID_BY_CHAIN[chainKey] || '1';
      const createx = (process.env.CREATEX_ADDRESS || process.env.CREATE_X || '').trim();
      if (/^0x[0-9a-fA-F]{40}$/.test(createx)) {
        const salt = keccak256(toHex(`DIAL|${id}|${networkId}`));
        const initCode = buildForwarderInitCode({
          requestProxy: fwd.requestProxy,
          beneficiary: fwd.beneficiary,
          paymentReferenceHex: fwd.paymentReferenceHex,
          feeAmountWei: fwd.feeAmountWei,
          feeAddress: fwd.feeAddress,
          bytecode: (ForwarderArtifact as any)?.bytecode as `0x${string}`,
        });
        // replicate predict address using same formula; we only need the URI here
        const decVal = fwd.amountWei ? fwd.amountWei.toString(10) : undefined;
        if (decVal) {
          const chainIdNum = Number(networkId) || 1;
          // we don't need the predicted address precisely for link if decVal missing; skip otherwise
          // reuse qr building at caller; here just set ethereumUri to be rebuilt elsewhere if needed
          // Without predicted address we cannot; leave undefined
        }
      }
    } catch {}

    return NextResponse.json({ status, balance, ethereumUri });
  } catch (e: any) {
    return NextResponse.json({ status: "error", error: e.message });
  }
}
