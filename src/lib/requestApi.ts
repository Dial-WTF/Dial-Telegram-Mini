import { appConfig } from '@/lib/config';

export type RequestCreatePayload = {
  payee: string;
  amount: string; // human readable
  invoiceCurrency: string; // e.g. 'ETH-mainnet'
  paymentCurrency: string; // e.g. 'ETH-mainnet'
  reference?: string;
};

export type RequestCreateResponse = {
  requestId?: string;
  paymentReference?: string;
};

export type PayTransaction = {
  to: string;
  data?: string;
  value?: { hex?: string } | { type?: string; hex?: string };
};

export type PayResponse = {
  transactions: PayTransaction[];
  metadata?: any;
};

function buildEndpoint(base: string): string {
  const baseTrim = base.replace(/\/$/, '');
  if (/\/v1$/.test(baseTrim) || /\/v2$/.test(baseTrim)) return `${baseTrim}/request`;
  return `${baseTrim}/v2/request`;
}

export async function createRequestRest(payload: RequestCreatePayload, apiKey?: string) {
  const rawBase = (appConfig.request.restBase || 'https://api.request.network');
  const endpoint = buildEndpoint(rawBase);
  const key = apiKey || appConfig.request.apiKey || process.env.REQUEST_API_KEY;
  if (!key) throw new Error('Missing REQUEST_API_KEY');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'x-api-key': key as string },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Request REST error: ${res.status} ${res.statusText} ${txt}`);
  }
  const json = await res.json();
  const requestId = json.requestID || json.requestId || json.id;
  const paymentReference = json.paymentReference || json.reference || json.payment_reference;
  return { requestId, paymentReference } as RequestCreateResponse;
}

export async function fetchPayCalldata(requestId: string, opts?: { feeAddress?: string; feePercentage?: string; apiKey?: string }) {
  const rawBase = (appConfig.request.restBase || 'https://api.request.network');
  const baseTrim = rawBase.replace(/\/$/, '');
  const key = opts?.apiKey || appConfig.request.apiKey || process.env.REQUEST_API_KEY;
  if (!key) throw new Error('Missing REQUEST_API_KEY');
  const qs = new URLSearchParams();
  if (opts?.feeAddress) qs.set('feeAddress', opts.feeAddress);
  if (opts?.feeAddress && opts?.feePercentage) qs.set('feePercentage', opts.feePercentage);
  const url = `${baseTrim}/v2/request/${requestId}/pay${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json', 'x-api-key': key as string } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Request pay error: ${res.status} ${res.statusText} ${txt}`);
  }
  const json = await res.json();
  return json as PayResponse;
}


