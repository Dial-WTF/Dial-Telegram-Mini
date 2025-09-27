import { NextRequest, NextResponse } from "next/server";
import { RequestNetwork } from "@requestnetwork/request-client.js";
import { appConfig } from "@/lib/config";
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    if (appConfig.request.apiKey) {
      const apiBase = appConfig.request.restBase;
      const resp = await fetch(`${apiBase}/request/${id}`, {
        headers: { 'x-api-key': appConfig.request.apiKey as string, 'Accept': 'application/json' },
      });
      if (!resp.ok) {
        return NextResponse.json({ status: 'error', error: `REST ${resp.status}` });
      }
      const data = await resp.json();
      const paid = !!data?.hasBeenPaid;
      return NextResponse.json({ status: paid ? 'paid' : 'pending', balance: paid ? { balance: '1' } : { balance: '0' } });
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
