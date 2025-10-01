"use client";

import React from "react";

export function OnrampModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[92vw] max-w-xl h-[80vh] bg-black rounded-2xl overflow-hidden border" style={{ borderColor: '#163a29' }}>
        <div className="flex items-center justify-between px-3 py-2 text-xs" style={{ color: '#B8A6F8', background: '#0b1610' }}>
          <span>Secure funding</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!url) return;
                try { (window as any)?.Telegram?.WebApp?.openLink?.(url); return; } catch {}
                window.open(url, '_blank');
              }}
              className="px-2 py-1 rounded-md font-semibold"
              style={{ background: '#12331f', color: '#EDE9FE' }}
            >
              Open in browser
            </button>
            <button
              onClick={onClose}
              className="px-2 py-1 rounded-md font-semibold"
              style={{ background: '#1f2937', color: '#EDE9FE' }}
            >
              Close
            </button>
          </div>
        </div>
        <iframe key={url} src={url} title="Onramp" className="w-full h-full" allow="accelerometer; autoplay; camera; gyroscope; payment *; clipboard-write; encrypted-media" />
      </div>
    </div>
  );
}


