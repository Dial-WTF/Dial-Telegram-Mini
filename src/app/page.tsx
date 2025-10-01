"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePrivy, useWallets, useFundWallet } from "@privy-io/react-auth"; // embedded wallet & funding
import BottomNav from "@/components/BottomNav";
import { useTelegramWebApp } from "@/lib/hooks/useTelegram";
import { usePayeeAddress } from "@/lib/hooks/usePayeeAddress";
import { OnrampModal } from "@/components/OnrampModal";

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

export default function Home() {
  // Preferred onramp provider from env (build-time). Set NEXT_PUBLIC_ONRAMP=COINBASE or MOONPAY
  const onrampEnv = (process.env.NEXT_PUBLIC_ONRAMP || "coinbase").toLowerCase();
  const preferredProvider = onrampEnv === "moonpay" ? "moonpay" : "coinbase";
  const onrampPath = preferredProvider === "moonpay" ? "/api/onramp/moonpay" : "/api/onramp/coinbase";
  const [onrampUrl, setOnrampUrl] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("1.00");
  const [note, setNote] = useState<string>("");
  const [loading, setLoading] = useState(false);

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
    try {
      setLoading(true);
      await ensureWallet();
      const currentPayee = await waitForPayeeAddress();
      const res = await fetch("/api/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          amount: Number(amount),
          note,
          initData: (tg && tg.initData) || "", // pass Telegram launch params if present
          payee: currentPayee, // Privy wallet (server will fallback if undefined)
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Share link back to chat (preferred), fallback to opening
      if (tg?.shareURL && typeof tg.shareURL === 'function') {
        const text = `Request: $${Number(amount).toFixed(2)}${note ? ` — ${note}` : ''}`;
        try {
          await tg.shareURL(data.payUrl, { text });
        } catch {
          tg?.openLink?.(data.payUrl);
        }
      } else {
        tg?.openLink?.(data.payUrl);
      }
    } catch (e: any) {
      alert(e.message ?? "Failed to create invoice");
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
        className="w-full max-w-md relative p-4 sm:p-5 rounded-3xl flex flex-col"
        style={{
          background: t.card,
          boxShadow: t.glow,
          border: t.border,
        }}
      >
        <div className="flex-1 overflow-y-auto overscroll-contain">
        <header className="mb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: "#2b1b4b", color: t.text, border: t.border }}
              >
                {(user?.email?.address?.[0] || "D").toUpperCase()}
              </div>
              <div className="text-sm">
                <div className="font-semibold">Profile</div>
                <div className="opacity-70" style={{ color: t.sub }}>
                  Dial Pay Mini App
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onFund}
                className="px-2.5 py-1 rounded-lg text-xs font-bold text-white"
                style={{ background: t.accent2 }}
              >
                Add funds
              </button>
              {authenticated ? (
                <button
                  onClick={() => logout()}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold text-white"
                  style={{ background: "#1f2937" }}
                >
                  Sign out
                </button>
              ) : (
                <button
                  onClick={() => login()}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold text-white"
                  style={{ background: t.accent1 }}
                >
                  Sign in
                </button>
              )}
            </div>
          </div>
          {payee ? (
            <p className="mt-1 text-xs opacity-70">
              Receiving to: {payee.slice(0, 6)}…{payee.slice(-4)}
            </p>
          ) : null}
        </header>

        <section className="flex flex-col items-center text-center select-none">
          <Image
            src="/phone.logo.no.bg.png"
            alt="Dial"
            width={170}
            height={170}
            priority
            className="drop-shadow-[0_10px_40px_rgba(124,58,237,.35)]"
          />

          <div className="text-[40px] sm:text-[56px] leading-none font-black tracking-tight mt-2">
            ${amount}
          </div>
          <p className="text-sm mt-2" style={{ color: t.sub }}>
            Request or send payments instantly in Telegram
          </p>

          <div className="flex justify-center gap-3 mt-3">
            <button
              onClick={() => bump(-1)}
              className="px-4 py-2 rounded-full font-bold text-white active:scale-95"
              style={{ background: t.accent1 }}
            >
              –1
            </button>
            <button
              onClick={() => bump(1)}
              className="px-4 py-2 rounded-full font-bold text-white active:scale-95"
              style={{ background: t.accent1 }}
            >
              +1
            </button>
          </div>
        </section>

        <input
          type="text"
          placeholder="Add note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full p-3 rounded-xl mt-3 bg-black/30 outline-none"
          style={{ border: "1px solid #163a29", color: t.text }}
        />

        <div className="grid grid-cols-2 gap-3 mt-3">
          <button
            disabled={loading}
            onClick={() => create("request")}
            className="py-3 rounded-xl font-bold text-white active:scale-95 disabled:opacity-60"
            style={{ background: t.accent1 }}
          >
            Request
          </button>
          <button
            disabled={loading}
            onClick={() => create("send")}
            className="py-3 rounded-xl font-bold text-white active:scale-95 disabled:opacity-60"
            style={{ background: t.accent2 }}
          >
            Send
          </button>
        </div>
        </div>

        <BottomNav className="mt-2 shrink-0" />

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



