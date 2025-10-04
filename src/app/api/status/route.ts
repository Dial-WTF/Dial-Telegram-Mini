import { NextRequest, NextResponse } from "next/server";
import { RequestNetwork } from "@requestnetwork/request-client.js";
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
        return NextResponse.json({ status: paid ? 'paid' : 'pending', balance: paid ? { balance: '1' } : { balance: '0' } });
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

    const status =
      balance?.balance && BigInt(balance.balance) > BigInt(0) ? "paid" : "pending";

    return NextResponse.json({ status, balance });
  } catch (e: any) {
    return NextResponse.json({ status: "error", error: e.message });
  }
}
