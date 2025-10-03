"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePrivy, useWallets, useFundWallet } from "@privy-io/react-auth"; // embedded wallet & funding
import BottomNav from "#/components/BottomNav";
import { useTelegramWebApp } from "#/lib/hooks/useTelegram";
import { usePayeeAddress } from "#/lib/hooks/usePayeeAddress";
import { OnrampModal } from "#/components/OnrampModal";

// Dial retro neon theme (purple)
const t = {
  bg: "radial-gradient(80% 60% at 50% 0%, #0b0713 0%, #0a0612 40%, #07040e 100%)",
  card: "#141021",
  text: "#EDE9FE",
  sub: "#B8A6F8",
  accent1: "#7C3AED", // purple
  accent2: "#C026D3", // fuchsia
  glow: "0 10px 40px rgba(124,58,237,.25)",
  border: "1px solid rgba(124,58,237,.35)",
};

type Kind = "request" | "send";
type Asset = "USDT" | "USDC" | "ETH" | "BTC" | "TON" | "BNB" | "SOL";
type Network = "ETH" | "BASE" | "BNB" | "POLYGON" | "ARBITRUM" | "OPTIMISM" | "SOLANA" | "BITCOIN" | "LIGHTNING";

const NETWORK_INFO: Record<Network, { name: string; emoji: string; color: string }> = {
  BASE: { name: "Base", emoji: "🔵", color: "#0052FF" },
  ETH: { name: "Ethereum", emoji: "Ξ", color: "#627EEA" },
  SOLANA: { name: "Solana", emoji: "◎", color: "#14F195" },
  POLYGON: { name: "Polygon", emoji: "🟣", color: "#8247E5" },
  BNB: { name: "BNB Chain", emoji: "🟡", color: "#F3BA2F" },
  ARBITRUM: { name: "Arbitrum", emoji: "🔷", color: "#28A0F0" },
  OPTIMISM: { name: "Optimism", emoji: "🔴", color: "#FF0420" },
  BITCOIN: { name: "Bitcoin", emoji: "₿", color: "#F7931A" },
  LIGHTNING: { name: "Lightning", emoji: "⚡", color: "#FFD700" },
};

export default function Home() {
  // Preferred onramp provider from env (build-time). Set NEXT_PUBLIC_ONRAMP=COINBASE or MOONPAY
  const onrampEnv = (process.env.NEXT_PUBLIC_ONRAMP || "coinbase").toLowerCase();
  const preferredProvider = onrampEnv === "moonpay" ? "moonpay" : "coinbase";
  const onrampPath = preferredProvider === "moonpay" ? "/api/onramp/moonpay" : "/api/onramp/coinbase";
  const [onrampUrl, setOnrampUrl] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("1.00");
  const [recipient, setRecipient] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [selectedAsset, setSelectedAsset] = useState<Asset>("USDC");
  const [selectedNetwork, setSelectedNetwork] = useState<Network>("BASE");

  // Telegram WebApp SDK
  const tgRef = useTelegramWebApp();

  // Privy embedded wallet (optional payee)
  const { wallets } = useWallets();
  const { authenticated, login, logout, user, ready } = usePrivy();
  const { fundWallet } = useFundWallet();
  const payee = wallets?.[0]?.address;

  const isHexAddress = (val: unknown) =>
    typeof val === 'string' && /^0x[0-9a-fA-F]{40}$/.test(val);

  async function waitForPayeeAddress(maxMs = 5000): Promise<string | undefined> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const addr = wallets?.[0]?.address;
      if (isHexAddress(addr)) return addr as string;
      await new Promise((r) => setTimeout(r, 150));
    }
    return wallets?.[0]?.address && isHexAddress(wallets?.[0]?.address)
      ? (wallets?.[0]?.address as string)
      : undefined;
  }

  // Telegram SDK loaded via hook

  const bump = (delta: number) => {
    setAmount((a) => {
      const n = Math.max(0, (Number(a || "0") || 0) + delta);
      return n.toFixed(2);
    });
  };

  async function ensureWallet() {
    if (!authenticated) {
      await login();
    }
  }

  function openDirectOnramp(addr?: string, opts?: { preferIframe?: boolean }) {
    try {
      // Best-effort close of Privy modal if open
      const closePrivyModalIfOpen = () => {
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' } as any)); } catch {}
        const candidates = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[];
        const closeBtn = candidates.find((el) => /close|dismiss/i.test(el.getAttribute('aria-label') || '') || /×|✕|close/i.test(el.textContent || ''));
        closeBtn?.click?.();
      };
      closePrivyModalIfOpen();
    } catch {}
    const url = `${onrampPath}${addr ? `?walletAddress=${addr}` : ''}`;
    if (opts?.preferIframe !== false) {
      setOnrampUrl(url);
      return;
    }
    const tg = tgRef.current;
    if (tg?.openLink && typeof tg.openLink === 'function') {
      try { tg.openLink(url); return; } catch {}
    }
    window.open(url, '_blank');
  }

  async function onFund() {
    try {
      if (!payee) {
        await ensureWallet();
      }
      const to = await waitForPayeeAddress();
      if (!to || !isHexAddress(to)) {
        alert('Wallet not ready yet. Please try again in a moment.');
        return;
      }
      let fallbackTriggered = false;
      const safeFallback = () => {
        if (fallbackTriggered) return;
        fallbackTriggered = true;
        openDirectOnramp(to, { preferIframe: true });
      };

      const watchdog = setTimeout(() => {
        // If nothing happened within a short window, assume widget couldn\'t initialize in IAB
        safeFallback();
      }, 2500);

      // Use object signature expected by Privy SDK and handle widget-level errors
      try {
        await (fundWallet as any)({
          address: to,
          chain: { id: 8453 },
          card: { preferredProvider },
          onError: () => {
            // If Privy widget fails to initialize (e.g., IAB/cookies), fall back to direct onramp
            clearTimeout(watchdog);
            safeFallback();
          },
          onExit: (_res: any) => {
            // Clear watchdog and decide based on result
            clearTimeout(watchdog);
            try {
              if (!_res?.status || String(_res.status).toLowerCase() !== 'success') {
                safeFallback();
              }
            } catch {
              safeFallback();
            }
          },
        });
      } catch {
        clearTimeout(watchdog);
        safeFallback();
        return;
      }
    } catch (e: any) {
      // Final catch fallback for non-widget errors
      const addr = wallets?.[0]?.address || '';
      openDirectOnramp(addr, { preferIframe: true });
    }
  }

  async function create(kind: Kind) {
    const tg = tgRef.current;
    setError("");
    
    // Validation
    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }
    
    // Validate recipient address for EVM chains
    if (recipient && ['ETH', 'BASE', 'POLYGON', 'BNB', 'ARBITRUM', 'OPTIMISM'].includes(selectedNetwork)) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
        setError("Please enter a valid address (0x...)");
        return;
      }
    }
    
    try {
      setLoading(true);
      await ensureWallet();
      const currentPayee = await waitForPayeeAddress();
      
      // Use new crypto invoice API
      const res = await fetch("/api/crypto/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currency_type: "crypto",
          asset: selectedAsset,
          amount: Number(amount),
          description: note || undefined,
          payee: recipient || currentPayee, // Use recipient if provided, otherwise use connected wallet
          network: selectedNetwork,
        }),
      });
      const data = await res.json();
      if (!data.ok || !data.result) {
        throw new Error(data.error || "Failed to create invoice");
      }
      
      const invoice = data.result;
      // Share link back to chat (preferred), fallback to opening
      if (tg?.shareURL && typeof tg.shareURL === 'function') {
        const assetEmojis: Record<Asset, string> = { USDT: '💵', USDC: '💵', ETH: 'Ξ', BTC: '₿', TON: '💎', BNB: '🔶', SOL: '◎' };
        const emoji = assetEmojis[selectedAsset] || '💰';
        const text = `${emoji} ${kind === 'request' ? 'Request' : 'Send'}: ${Number(amount).toFixed(2)} ${selectedAsset}${note ? ` — ${note}` : ''}`;
        try {
          await tg.shareURL(invoice.pay_url, { text });
        } catch {
          tg?.openLink?.(invoice.pay_url);
        }
      } else {
        tg?.openLink?.(invoice.pay_url);
      }
    } catch (e: any) {
      const errorMsg = e.message ?? "Failed to create invoice";
      setError(errorMsg);
      if (tg?.showAlert) {
        tg.showAlert(errorMsg);
      } else {
        alert(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="min-h-[100dvh] flex items-stretch justify-center p-3 sm:p-4 overflow-hidden"
      style={{ background: t.bg, color: t.text }}
    >
      <div
        className="w-full max-w-md relative p-3 rounded-3xl flex flex-col max-h-[100dvh]"
        style={{
          background: t.card,
          boxShadow: t.glow,
          border: t.border,
        }}
      >
        <div className="flex-1 overflow-y-auto overscroll-contain space-y-3">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: "linear-gradient(135deg, #2b1b4b, #1a0f2e)", color: t.text, border: t.border }}
            >
              {(user?.email?.address?.[0] || payee?.[2] || "D").toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-xs">Dial Pay</div>
              {payee && (
                <div className="text-[10px] font-mono" style={{ color: t.sub }}>
                  {payee.slice(0, 4)}...{payee.slice(-3)}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {authenticated ? (
              <>
                <button
                  onClick={onFund}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white transition-all active:scale-95"
                  style={{ background: t.accent2 }}
                >
                  +Add
                </button>
                <button
                  onClick={() => logout()}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
                  style={{ background: "rgba(255,255,255,0.1)", color: t.sub }}
                >
                  Out
                </button>
              </>
            ) : (
              <button
                onClick={() => login()}
                className="px-3 py-1 rounded-lg text-[10px] font-bold text-white transition-all active:scale-95"
                style={{ background: t.accent1 }}
              >
                Connect
              </button>
            )}
          </div>
        </header>

        {/* Amount Section */}
        <section className="space-y-2">
          <div className="text-center">
            <Image
              src="/phone.logo.no.bg.png"
              alt="Dial"
              width={80}
              height={80}
              priority
              className="mx-auto drop-shadow-[0_10px_40px_rgba(124,58,237,.35)]"
            />
          </div>

          {/* Amount Input */}
          <div className="text-center">
            <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: t.sub }}>
              Amount
            </label>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(124,58,237,0.3)' }}>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-3xl sm:text-4xl leading-none font-black tracking-tight bg-transparent outline-none text-center w-28 sm:w-36"
                style={{ color: '#1a0f2e' }}
                placeholder="Enter amount"
                step="0.01"
                min="0"
              />
              <div className="text-xl sm:text-2xl font-bold" style={{ color: t.accent1 }}>
                {selectedAsset}
              </div>
            </div>
          </div>

          {/* Quick Amount Buttons */}
          <div className="grid grid-cols-4 gap-1.5">
            {[1, 5, 10, 50].map((val) => (
              <button
                key={val}
                onClick={() => setAmount(String(val))}
                className="py-1.5 rounded-lg text-xs font-bold text-white transition-all active:scale-95"
                style={{ 
                  background: amount === String(val) ? t.accent1 : 'rgba(124,58,237,0.25)', 
                  border: amount === String(val) ? t.border : '1px solid rgba(124,58,237,0.3)' 
                }}
              >
                {val}
              </button>
            ))}
          </div>

          {/* Asset Selector */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: t.sub }}>
              Asset
            </label>
            <div className="relative">
              <select
                value={selectedAsset}
                onChange={(e) => setSelectedAsset(e.target.value as Asset)}
                className="w-full p-2.5 rounded-lg text-sm font-bold appearance-none cursor-pointer transition-all"
                style={{
                  background: 'rgba(124,58,237,0.15)',
                  border: '1px solid rgba(124,58,237,0.35)',
                  color: t.text,
                  paddingRight: '2.5rem',
                }}
              >
                {(['USDC', 'USDT', 'ETH', 'BTC', 'TON', 'BNB', 'SOL'] as Asset[]).map((asset) => {
                  const assetEmojis: Record<Asset, string> = { USDT: '💵', USDC: '💵', ETH: 'Ξ', BTC: '₿', TON: '💎', BNB: '🔶', SOL: '◎' };
                  return (
                    <option key={asset} value={asset}>
                      {assetEmojis[asset]} {asset}
                    </option>
                  );
                })}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: t.sub }}>
                ▼
              </div>
            </div>
          </div>

          {/* Network Selector */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: t.sub }}>
              Network
            </label>
            <div className="relative">
              <select
                value={selectedNetwork}
                onChange={(e) => setSelectedNetwork(e.target.value as Network)}
                className="w-full p-2.5 rounded-lg text-sm font-bold appearance-none cursor-pointer transition-all"
                style={{
                  background: 'rgba(124,58,237,0.15)',
                  border: '1px solid rgba(124,58,237,0.35)',
                  color: t.text,
                  paddingRight: '2.5rem',
                }}
              >
                {(['BASE', 'ETH', 'SOLANA', 'POLYGON', 'BNB', 'ARBITRUM', 'OPTIMISM', 'BITCOIN', 'LIGHTNING'] as Network[]).map((network) => {
                  const info = NETWORK_INFO[network];
                  return (
                    <option key={network} value={network}>
                      {info.emoji} {info.name}
                    </option>
                  );
                })}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: t.sub }}>
                ▼
              </div>
            </div>
          </div>
        </section>

        {/* Recipient Address Input */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: t.sub }}>
            Recipient Address (Optional)
          </label>
          <input
            type="text"
            placeholder="0x... or leave empty to use your wallet"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full p-2 rounded-lg bg-black/20 outline-none transition-all focus:bg-black/30 text-xs font-mono"
            style={{ 
              border: `1px solid rgba(124,58,237,0.3)`, 
              color: t.text,
              ...(recipient && !/^0x[0-9a-fA-F]{40}$/.test(recipient) && ['ETH', 'BASE', 'POLYGON', 'BNB', 'ARBITRUM', 'OPTIMISM'].includes(selectedNetwork) ? {
                borderColor: 'rgba(239,68,68,0.6)',
              } : {})
            }}
          />
          {recipient && !/^0x[0-9a-fA-F]{40}$/.test(recipient) && ['ETH', 'BASE', 'POLYGON', 'BNB', 'ARBITRUM', 'OPTIMISM'].includes(selectedNetwork) && (
            <div className="text-[9px] mt-1" style={{ color: '#fca5a5' }}>
              Invalid address format
            </div>
          )}
        </div>

        {/* Note Input */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: t.sub }}>
            Note (Optional)
          </label>
          <input
            type="text"
            placeholder="Payment for..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full p-2 rounded-lg bg-black/20 outline-none transition-all focus:bg-black/30 text-sm"
            style={{ border: `1px solid rgba(124,58,237,0.3)`, color: t.text }}
            maxLength={50}
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-2 rounded-lg text-xs text-center" style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5' }}>
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={loading || !amount || parseFloat(amount) <= 0}
            onClick={() => create("request")}
            className="py-2.5 rounded-lg text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ 
              background: `linear-gradient(135deg, ${t.accent1} 0%, ${t.accent1}dd 100%)`,
              boxShadow: loading ? 'none' : '0 4px 20px rgba(124,58,237,0.4)',
            }}
          >
            {loading ? '⚡ Creating...' : '📨 Request'}
          </button>
          <button
            disabled={loading || !amount || parseFloat(amount) <= 0}
            onClick={() => create("send")}
            className="py-2.5 rounded-lg text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ 
              background: `linear-gradient(135deg, ${t.accent2} 0%, ${t.accent2}dd 100%)`,
              boxShadow: loading ? 'none' : '0 4px 20px rgba(192,38,211,0.4)',
            }}
          >
            {loading ? '⚡ Creating...' : '⚡ Send'}
          </button>
        </div>
        </div>

        <BottomNav className="mt-1.5 shrink-0" />

        {onrampUrl ? (<OnrampModal url={onrampUrl} onClose={() => setOnrampUrl(null)} />) : null}
      </div>
    </main>
  );
}

function Pill({ label, bg }: { label: string; bg: string }) {
  return (
    <span
      className="px-3 py-1 rounded-full text-xs font-bold"
      style={{ background: bg, color: "#fff" }}
    >
      {label}
    </span>
  );
}



