import { Interface, parseEther } from 'ethers';

export function buildEthereumUri(params: { to: string; valueWeiDec: string; data?: string; chainId?: number; gas?: string; gasPrice?: string; }) {
  const { to, valueWeiDec, data, chainId, gas, gasPrice } = params;
  const chainPart = chainId ? `@${chainId}` : '';
  const gasPart = gas ? `&gas=${gas}` : '';
  const gasPricePart = gasPrice ? `&gasPrice=${gasPrice}` : '';
  return `ethereum:${to}${chainPart}?value=${valueWeiDec}${data ? `&data=${data}` : ''}${gasPart}${gasPricePart}`;
}

export function decodeProxyDataAndValidateValue(data: string | undefined, valueWeiDec: string, requestedAmountEth?: number): { ok: boolean; reason?: string } {
  if (!data) return { ok: true };
  try {
    const abi = new Interface([
      'function transferWithReferenceAndFee(address to, bytes paymentReference, uint256 feeAmount, address feeAddress)',
      'function transferExactEthWithReferenceAndFee(address to, uint256 amount, bytes paymentReference, uint256 feeAmount, address feeAddress)'
    ]);
    let feeAmountWei: bigint | undefined;
    let amountWeiExact: bigint | undefined;
    try {
      const decoded = abi.decodeFunctionData('transferExactEthWithReferenceAndFee', data);
      amountWeiExact = BigInt(decoded[1].toString());
      feeAmountWei = BigInt(decoded[3].toString());
    } catch {
      try {
        const decoded2 = abi.decodeFunctionData('transferWithReferenceAndFee', data);
        feeAmountWei = BigInt(decoded2[2].toString());
      } catch {}
    }
    const valueWei = BigInt(valueWeiDec);
    const reqAmtWei = requestedAmountEth !== undefined ? BigInt(parseEther(String(requestedAmountEth)).toString()) : 0n;
    const expectedTotal = (amountWeiExact !== undefined ? amountWeiExact : reqAmtWei) + (feeAmountWei || 0n);
    if (expectedTotal !== 0n && valueWei !== expectedTotal) {
      return { ok: false, reason: `value ${valueWei} != expected ${expectedTotal}` };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}


