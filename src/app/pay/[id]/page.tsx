"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BottomNav from "@/components/BottomNav";

export default function PayPage({ params }: { params: { id: string } }) {
  const [status, setStatus] = useState<"pending" | "paid" | "error">("pending");
  const [balance, setBalance] = useState<string>("0");

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/status?id=${params.id}`).then((r) =>
          r.json()
        );
        if (r.error) {
          setStatus("error");
          return;
        }
        setStatus(r.status);
        setBalance(r.balance?.balance ?? "0");
      } catch {
        setStatus("error");
      }
    }, 4000);
    return () => clearInterval(t);
  }, [params.id]);

  const deepLink = `${location.origin}/pay/${params.id}`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
    deepLink
  )}`;

  return (
    <main className="min-h-[100dvh] flex items-stretch justify-center p-3 sm:p-4 overflow-hidden" style={{ background: "radial-gradient(80% 60% at 50% 0%, #0d1f14 0%, #08110c 40%, #050708 100%)", color: "#E7F8EC" }}>
      <div className="w-full max-w-md p-4 sm:p-5 rounded-3xl flex flex-col" style={{ background: "#0f1a12", border: "1px solid rgba(22,163,74,.35)", boxShadow: "0 10px 40px rgba(5,150,105,.25)" }}>
        <div className="flex-1 overflow-y-auto overscroll-contain">
        <h1 className="text-2xl font-extrabold mb-1">Pay Request</h1>
        <p className="text-sm" style={{ color: "#B5E1C2" }}>ID: {params.id}</p>

        <img src={qr} alt="QR" className="mx-auto my-4 rounded-xl" />
        <a className="block text-center underline" href={deepLink} target="_blank">
          Open payment link
        </a>

        <div className="text-center mt-4">
          <div className="text-lg font-bold">Status: {status}</div>
          <div className="text-sm opacity-70">Paid amount (detected): {balance}</div>
        </div>

        <div className="mt-4 text-center">
          <Link href="/" className="px-3 py-2 rounded-lg font-bold text-white" style={{ background: "#16A34A" }}>
            Back to Main
          </Link>
        </div>
        </div>
        <BottomNav className="mt-2 shrink-0" />
      </div>
    </main>
  );
}
