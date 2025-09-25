"use client";

import { useEffect, useState } from "react";

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
    <main className="min-h-screen flex items-center justify-center p-6 bg-[#0a0612] text-[#EDE9FE]">
      <div className="w-full max-w-md p-6 rounded-2xl bg-[#141021] border border-purple-800">
        <h1 className="text-2xl font-extrabold mb-1">Pay Request</h1>
        <p className="text-sm text-purple-200 mb-4">ID: {params.id}</p>

        <img src={qr} alt="QR" className="mx-auto mb-4 rounded-xl" />
        <a
          className="block text-center underline mb-4"
          href={deepLink}
          target="_blank"
        >
          Open payment link
        </a>

        <div className="text-center">
          <div className="text-lg font-bold">Status: {status}</div>
          <div className="text-sm opacity-70">
            Paid amount (detected): {balance}
          </div>
        </div>
      </div>
    </main>
  );
}
