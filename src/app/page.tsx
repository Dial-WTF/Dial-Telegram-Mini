"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePrivy, useWallets, useFundWallet } from "@privy-io/react-auth"; // embedded wallet & funding
import BottomNav from "@/components/BottomNav";

// Dial theme tokens
const t = {
  bg: "radial-gradient(80% 60% at 50% 0%, #0d1f14 0%, #08110c 40%, #050708 100%)",
  card: "#0f1a12",
  text: "#E7F8EC",
  sub: "#B5E1C2",
  accent1: "#16A34A", // green
  accent2: "#059669", // teal
  glow: "0 10px 40px rgba(5, 150, 105, .25)",
  border: "1px solid rgba(22,163,74,.35)",
};

type Kind = "request" | "send";

export default function Home() {
  const [amount, setAmount] = useState<string>("1.00");
  const [note, setNote] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Telegram WebApp SDK ref (loaded dynamically)
  const tgRef = useRef<any>(null);

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

  // Load Telegram SDK only on the client
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (typeof window === "undefined") return;
      const mod = await import("@twa-dev/sdk"); // <-- dynamic import avoids SSR crash
      if (!mounted) return;
      tgRef.current = mod.default;
      tgRef.current.ready();
      tgRef.current.expand();
      tgRef.current.enableClosingConfirmation();
    })();
    return () => {
      mounted = false;
    };
  }, []);

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
      // Use the two-argument signature per Privy web docs
      await (fundWallet as any)(to, { asset: 'USDC' });
    } catch (e: any) {
      const msg = String(e?.message || e || '').toLowerCase();
      if (
        msg.includes('funding is not enabled') ||
        msg.includes('unable to initialize') ||
        msg.includes('not enabled')
      ) {
        const to = wallets?.[0]?.address || '';
        window.open(`/api/onramp/moonpay${to ? `?walletAddress=${to}` : ''}`, '_blank');
        return;
      }
      alert(e?.message || 'Unable to start funding');
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
                style={{ background: "#12331f", color: t.text, border: t.border }}
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
            className="drop-shadow-[0_10px_40px_rgba(5,150,105,.25)]"
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
