import { getAddress, isAddress } from 'viem';
import { JsonRpcProvider } from 'ethers';

export function isValidHexAddress(value: string | undefined): boolean {
  if (!value) return false;
  try { return isAddress(value); } catch { return false; }
}

export function normalizeHexAddress(value: string): string | undefined {
  try { return getAddress(value); } catch { return undefined; }
}

export async function resolveEnsToHex(nameOrHex: string, rpcUrl?: string): Promise<string | undefined> {
  const input = String(nameOrHex || '').trim();
  if (isValidHexAddress(input)) return normalizeHexAddress(input);
  const ens = input.startsWith('0x') && input.includes('.') ? input.slice(2) : input;
  if (!/^[a-z0-9-_.]+\.[a-z]{2,}$/i.test(ens)) return undefined;
  if (!rpcUrl) return undefined;
  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const addr = await provider.resolveName(ens);
    return addr && isValidHexAddress(addr) ? normalizeHexAddress(addr) : undefined;
  } catch {
    return undefined;
  }
}


