"use client";

import { useEffect, useRef } from "react";

export function useTelegramWebApp() {
  const tgRef = useRef<any>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (typeof window === "undefined") return;
      const mod = await import("@twa-dev/sdk");
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

  return tgRef;
}


