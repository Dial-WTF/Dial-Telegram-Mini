"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy, useWallets, useFundWallet } from "@privy-io/react-auth"; // embedded wallet & funding

// Dial theme tokens
const t = {
  bg: "#0a0612",
  card: "#141021",
  text: "#EDE9FE",
  sub: "#B8A6F8",
  accent1: "#7C3AED",
  accent2: "#C026D3",
  glow: "0 10px 40px rgba(124,58,237,.25)",
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
      // Open pay page (inside Telegram webview)
      tg?.openLink?.(data.payUrl);
    } catch (e: any) {
      alert(e.message ?? "Failed to create invoice");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: t.bg, color: t.text }}
    >
      <div
        className="w-full max-w-md relative p-6 rounded-2xl"
        style={{
          background: t.card,
          boxShadow: t.glow,
          border: "1px solid rgba(124,58,237,.25)",
        }}
      >
        {/* gradient border */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            padding: 1,
            background:
              "linear-gradient(135deg, rgba(56,189,248,.35), rgba(168,85,247,.30), rgba(217,70,239,.35))",
            WebkitMask:
              "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor" as any,
            maskComposite: "exclude" as any,
          }}
        />

        <header className="mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold">Dial Pay</h1>
              <p className="text-sm" style={{ color: t.sub }}>
                Request or Send — powered by Request Network
              </p>
            </div>
            <div className="flex items-center gap-2">
              {authenticated ? (
                <>
                  {user?.email?.address && (
                    <span className="text-xs opacity-70">{user.email.address}</span>
                  )}
                  <button
                    onClick={() => logout()}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold text-white"
                    style={{ background: t.accent2 }}
                  >
                    Sign out
                  </button>
                </>
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
              <button
                onClick={onFund}
                className="ml-2 px-2 py-0.5 rounded-md text-[10px] font-bold text-white"
                style={{ background: t.accent1 }}
              >
                Add funds
              </button>
            </p>
          ) : null}
        </header>

        <section className="mb-4 text-center">
          <div className="text-6xl font-black tracking-tight select-none">
            ${amount}
          </div>
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
          className="w-full p-3 rounded-xl mb-4 bg-black/30 outline-none"
          style={{ border: "1px solid #2a2142", color: t.text }}
        />

        <div className="grid grid-cols-2 gap-3">
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
