"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import BottomNav from "@/components/BottomNav";

export default function PayPage() {
  const [status, setStatus] = useState<"pending" | "paid" | "error">("pending");
  const [balance, setBalance] = useState<string>("0");
  const [mounted, setMounted] = useState(false);
  const routeParams = useParams<{ id: string }>();
  const id = (routeParams?.id as string) || "";

  useEffect(() => {
    if (!id) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/status?id=${id}`).then((r) =>
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
  }, [id]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const deepLink = mounted && id
    ? `${window.location.origin}/pay/${id}`
    : "";
  const qr = mounted
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
        deepLink
      )}`
    : "";

  return (
    <main className="min-h-[100dvh] flex items-stretch justify-center p-3 sm:p-4 overflow-hidden" style={{ background: "radial-gradient(80% 60% at 50% 0%, #0b0713 0%, #0a0612 40%, #07040e 100%)", color: "#EDE9FE" }}>
      <div className="w-full max-w-md p-4 sm:p-5 rounded-3xl flex flex-col" style={{ background: "#141021", border: "1px solid rgba(124,58,237,.35)", boxShadow: "0 10px 40px rgba(124,58,237,.25)" }}>
        <div className="flex-1 overflow-y-auto overscroll-contain">
        <h1 className="text-2xl font-extrabold mb-1">Pay Request</h1>
        <p className="text-sm" style={{ color: "#B8A6F8" }}>ID: {id}</p>

        {mounted ? (
          <>
            <img src={qr} alt="QR" className="mx-auto my-4 rounded-xl" />
            <a className="block text-center underline" href={deepLink} target="_blank">
              Open payment link
            </a>
          </>
        ) : null}

        <div className="text-center mt-4">
          <div className="text-lg font-bold">Status: {status}</div>
          <div className="text-sm opacity-70">Paid amount (detected): {balance}</div>
        </div>

        <div className="mt-4 text-center">
          <Link href="/" className="px-3 py-2 rounded-lg font-bold text-white" style={{ background: "#7C3AED" }}>
            Back to Main
          </Link>
        </div>
        </div>
        <BottomNav className="mt-2 shrink-0" />
      </div>
    </main>
  );
}
