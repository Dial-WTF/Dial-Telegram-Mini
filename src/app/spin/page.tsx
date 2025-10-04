"use client";

import { useEffect, useRef, useState } from "react";
import BottomNav from "#/components/BottomNav";

type Prize = { kind: string; label: string; amount?: number };

export default function SpinPage() {
  const [spinning, setSpinning] = useState(false);
  const [sliceIndex, setSliceIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<string>("");
  const [confetti, setConfetti] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<string[]>(new Array(12).fill(""));
  const [prizeKind, setPrizeKind] = useState<string>("");

  useEffect(() => {
    if (sliceIndex === null) return;
    const el = wheelRef.current;
    if (!el) return;
    const slices = 12;
    const degPer = 360 / slices;
    const targetDeg = 360 * 5 + (360 - sliceIndex * degPer) - degPer / 2;
    el.style.transition = "transform 2.2s cubic-bezier(.17,.67,.32,1.34)";
    el.style.transform = `rotate(${targetDeg}deg)`;
  }, [sliceIndex]);

  async function spin() {
    if (spinning) return;
    setMessage("");
    setSpinning(true);
    setConfetti(false);
    setSliceIndex(null);
    try {
      const tg = (window as any).Telegram?.WebApp;
      const initData = tg?.initData || "";
      const res = await fetch("/api/spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "spin failed");
      if (Array.isArray(res.wheel)) setLabels(res.wheel.map((w: any) => w.label));
      setSliceIndex(res.sliceIndex);
      const p: Prize = res.prize;
      setPrizeKind(p.kind);
      const text = p.kind === "none" ? "No prize — try again tomorrow" : `${p.label}${p.amount ? `: ${p.amount}` : ""}`;
      setTimeout(() => {
        setMessage(text);
        if (p.kind !== "none") setConfetti(true);
        setSpinning(false);
      }, 2300);
    } catch (e: any) {
      setMessage(e?.message || "Spin failed");
      setSpinning(false);
    }
  }

  return (
    <main className="min-h-[100dvh] flex items-stretch justify-center p-3 sm:p-4 overflow-hidden" style={{ background: "radial-gradient(80% 60% at 50% 0%, #0b0713 0%, #0a0612 40%, #07040e 100%)", color: "#EDE9FE" }}>
      <div className="w-full max-w-md p-4 sm:p-5 rounded-3xl flex flex-col" style={{ background: "#141021", border: "1px solid rgba(124,58,237,.35)", boxShadow: "0 10px 40px rgba(124,58,237,.25)" }}>
        <div className="flex-1 overflow-y-auto overscroll-contain">
        <h1 className="text-2xl font-extrabold">Spin</h1>
        <p className="text-sm mt-1" style={{ color: "#B5E1C2" }}>
          Daily spin for bonuses. Provably fair (deterministic seed per day/user). No wagering.
        </p>

        <div className="mt-6 grid place-items-center">
          <div className="relative w-[280px] h-[280px] rounded-full border-2" style={{
            borderColor: "rgba(124,58,237,.35)",
            boxShadow: "0 0 40px rgba(124,58,237,.15) inset, 0 10px 40px rgba(124,58,237,.25)",
            background: "radial-gradient(60% 60% at 50% 50%, #130e22 0%, #0b0816 100%)"
          }}>
            <div ref={wheelRef} className="absolute inset-0 rounded-full" style={{ background: "conic-gradient(#7C3AED 0 30deg, #2b1b4b 30deg 60deg, #7C3AED 60deg 90deg, #2b1b4b 90deg 120deg, #7C3AED 120deg 150deg, #2b1b4b 150deg 180deg, #7C3AED 180deg 210deg, #2b1b4b 210deg 240deg, #7C3AED 240deg 270deg, #2b1b4b 270deg 300deg, #7C3AED 300deg 330deg, #2b1b4b 330deg 360deg)" }} />

            {/* slice labels */}
            {labels.map((label, i) => {
              const slices = 12; const degPer = 360 / slices; const angle = i * degPer + degPer / 2;
              return (
                <div key={i} className="absolute left-1/2 top-1/2 text-[10px] sm:text-xs font-semibold opacity-80"
                  style={{ transform: `rotate(${angle}deg) translateY(-118px) rotate(${-angle}deg)`, color: "#d1fae5" }}>
                  {label}
                </div>
              );
            })}

            {/* pointer */}
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 h-0 w-0 border-l-8 border-r-8 border-b-[14px] border-l-transparent border-r-transparent" style={{ borderBottomColor: "#A855F7", filter: "drop-shadow(0 2px 4px rgba(168,85,247,.5))" }} />

            {/* prize badge */}
            {message && !spinning ? (
              <div className="absolute inset-0 grid place-items-center">
                <div className="px-3 py-1 rounded-full text-xs font-bold" style={{
                  background: prizeKind === 'none' ? 'rgba(100,116,139,.25)' : 'linear-gradient(90deg,#7C3AED,#C026D3)',
                  color: '#0b1110', boxShadow: '0 0 20px rgba(124,58,237,.25)'
                }}>
                  {message}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid place-items-center">
          <button onClick={spin} disabled={spinning} className="px-6 py-3 rounded-full font-bold text-white active:scale-95 disabled:opacity-50" style={{ background: "linear-gradient(90deg,#7C3AED,#C026D3)", boxShadow: "0 10px 25px rgba(124,58,237,.25)" }}>
            {spinning ? "Spinning…" : "Spin"}
          </button>
          {message ? <p className="mt-3 text-sm" style={{ color: "#B5E1C2" }}>{message}</p> : null}
        </div>

        {confetti ? (
          <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
            {[...Array(40)].map((_, i) => (
              <span key={i} className="absolute top-[-10px] w-1.5 h-2 rounded-sm" style={{
                left: `${(i * 97) % 100}%`,
                background: i % 3 === 0 ? '#22c55e' : i % 3 === 1 ? '#60a5fa' : '#f59e0b',
                opacity: .9,
                transform: `translate3d(0,0,0) rotate(${(i * 33) % 360}deg)`,
                animation: `fall ${2 + (i % 5) * .4}s linear ${i * .05}s forwards`
              }} />
            ))}
            <style jsx>{`
              @keyframes fall { to { transform: translate3d(0,100vh,0) rotate(360deg); opacity:.95 } }
            `}</style>
          </div>
        ) : null}

        </div>
        <BottomNav className="mt-2 shrink-0" />
      </div>
    </main>
  );
}


