"use client";

import BottomNav from "#/components/BottomNav";

export default function ShopPage() {
  return (
    <main className="min-h-[100dvh] flex items-stretch justify-center p-3 sm:p-4 overflow-hidden" style={{ background: "radial-gradient(80% 60% at 50% 0%, #0b0713 0%, #0a0612 40%, #07040e 100%)", color: "#EDE9FE" }}>
      <div className="w-full max-w-md p-4 sm:p-5 rounded-3xl flex flex-col" style={{ background: "#141021", border: "1px solid rgba(124,58,237,.35)", boxShadow: "0 10px 40px rgba(124,58,237,.25)" }}>
        <div className="flex-1 overflow-y-auto overscroll-contain">
        <h1 className="text-2xl font-extrabold">Shop</h1>
        <p className="text-sm mt-1" style={{ color: "#B8A6F8" }}>
          Buy boosts and cosmetics (placeholder).
        </p>

        <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
          <div className="p-3 rounded-xl bg-white/5">Boost +10%</div>
          <div className="p-3 rounded-xl bg-white/5">Boost +25%</div>
          <div className="p-3 rounded-xl bg-white/5">Avatar Pack</div>
          <div className="p-3 rounded-xl bg-white/5">Theme Pack</div>
        </div>

        </div>
        <BottomNav className="mt-2 shrink-0" />
      </div>
    </main>
  );
}


