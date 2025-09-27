"use client";

import BottomNav from "@/components/BottomNav";

export default function HistoryPage() {
  return (
    <main className="min-h-[100dvh] flex items-stretch justify-center p-3 sm:p-4 overflow-hidden" style={{ background: "radial-gradient(80% 60% at 50% 0%, #0d1f14 0%, #08110c 40%, #050708 100%)", color: "#E7F8EC" }}>
      <div className="w-full max-w-md p-4 sm:p-5 rounded-3xl flex flex-col" style={{ background: "#0f1a12", border: "1px solid rgba(22,163,74,.35)", boxShadow: "0 10px 40px rgba(5,150,105,.25)" }}>
        <div className="flex-1 overflow-y-auto overscroll-contain">
        <h1 className="text-2xl font-extrabold">History</h1>
        <p className="text-sm mt-1" style={{ color: "#B5E1C2" }}>
          Recent requests and payments (placeholder).
        </p>

        <ul className="mt-4 space-y-2 text-sm">
          <li className="p-3 rounded-xl bg-white/5">$5.00 — Request — Pending</li>
          <li className="p-3 rounded-xl bg-white/5">$1.00 — Send — Paid</li>
        </ul>

        </div>
        <BottomNav className="mt-2 shrink-0" />
      </div>
    </main>
  );
}


