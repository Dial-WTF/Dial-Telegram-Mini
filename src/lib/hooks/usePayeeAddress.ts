"use client";

import { useWallets } from "@privy-io/react-auth";

export function usePayeeAddress() {
  const { wallets } = useWallets();
  const isHex = (v: unknown) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

  async function waitForPayeeAddress(maxMs = 5000): Promise<string | undefined> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const addr = wallets?.[0]?.address;
      if (isHex(addr)) return addr as string;
      await new Promise((r) => setTimeout(r, 150));
    }
    return wallets?.[0]?.address && isHex(wallets?.[0]?.address)
      ? (wallets?.[0]?.address as string)
      : undefined;
  }

  return { wallets, waitForPayeeAddress };
}


