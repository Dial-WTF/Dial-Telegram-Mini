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
  // Attempt ENS resolution. First try as-is to allow names like "0xdial.eth".
  const looksLikeDomain = /^[a-z0-9-_.]+\.[a-z]{2,}$/i.test(input);
  if (!looksLikeDomain || !rpcUrl) return undefined;
  try {
    const provider = new JsonRpcProvider(rpcUrl);
    // 1) Try resolving exactly as provided
    let resolved = await provider.resolveName(input);
    if (resolved && isValidHexAddress(resolved)) return normalizeHexAddress(resolved);

    // 2) Fallback: if user accidentally added 0x before an ENS, try without it
    if (input.startsWith('0x')) {
      const without0x = input.slice(2);
      if (/^[a-z0-9-_.]+\.[a-z]{2,}$/i.test(without0x)) {
        resolved = await provider.resolveName(without0x);
        if (resolved && isValidHexAddress(resolved)) return normalizeHexAddress(resolved);
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}


