"use client";

import BottomNav from "@/components/BottomNav";

export default function SpinPage() {
  return (
    <main className="min-h-[100dvh] flex items-stretch justify-center p-3 sm:p-4 overflow-hidden" style={{ background: "radial-gradient(80% 60% at 50% 0%, #0d1f14 0%, #08110c 40%, #050708 100%)", color: "#E7F8EC" }}>
      <div className="w-full max-w-md p-4 sm:p-5 rounded-3xl flex flex-col" style={{ background: "#0f1a12", border: "1px solid rgba(22,163,74,.35)", boxShadow: "0 10px 40px rgba(5,150,105,.25)" }}>
        <div className="flex-1 overflow-y-auto overscroll-contain">
        <h1 className="text-2xl font-extrabold">Spin</h1>
        <p className="text-sm mt-1" style={{ color: "#B5E1C2" }}>
          Gamified spinner (placeholder). Earn boosts and bonuses.
        </p>

        <div className="mt-6 grid place-items-center">
          <button className="px-6 py-3 rounded-full font-bold text-white active:scale-95" style={{ background: "#16A34A" }}>
            Spin
          </button>
        </div>

        </div>
        <BottomNav className="mt-2 shrink-0" />
      </div>
    </main>
  );
}


