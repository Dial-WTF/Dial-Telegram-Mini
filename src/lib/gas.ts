export async function estimateGasAndPrice(opts: { rpcUrl?: string; to: string; data?: string; valueWeiDec: string }): Promise<{ gas?: string; gasPrice?: string }> {
  const { rpcUrl, to, data, valueWeiDec } = opts;
  if (!rpcUrl) return {};
  try {
    const toHex = (n: bigint) => '0x' + n.toString(16);
    const valueHex = toHex(BigInt(valueWeiDec));
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_estimateGas', params: [{ to, data: data || undefined, value: valueHex }] })
    });
    const j = await res.json();
    let gas: string | undefined;
    if (typeof j?.result === 'string') {
      const g = BigInt(j.result);
      const padded = (g * 12n) / 10n;
      gas = padded.toString(10);
    }
    const gp = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_gasPrice', params: [] }) }).then(r => r.json());
    const gasPrice: string | undefined = typeof gp?.result === 'string' ? BigInt(gp.result).toString(10) : undefined;
    return { gas, gasPrice };
  } catch {
    return {};
  }
}


