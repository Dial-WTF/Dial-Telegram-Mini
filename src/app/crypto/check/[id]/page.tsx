"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import Image from "next/image";

const t = {
  bg: "radial-gradient(80% 60% at 50% 0%, #0b0713 0%, #0a0612 40%, #07040e 100%)",
  card: "#141021",
  text: "#EDE9FE",
  sub: "#B8A6F8",
  accent1: "#7C3AED",
  accent2: "#C026D3",
  glow: "0 10px 40px rgba(124,58,237,.25)",
  border: "1px solid rgba(124,58,237,.35)",
};

export default function CryptoCheckPage() {
  const params = useParams();
  const checkId = params?.id as string;
  const [check, setCheck] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const { authenticated, login } = usePrivy();

  useEffect(() => {
    if (!checkId) return;
    
    fetch(`/api/crypto/check?check_id=${checkId}`)
      .then(res => res.json())
      .then(data => {
        if (data.ok && data.result && data.result.length > 0) {
          setCheck(data.result[0]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [checkId]);

  const handleClaim = async () => {
    if (!authenticated) {
      await login();
      return;
    }

    setClaiming(true);
    try {
      alert("Claim functionality coming soon! This will transfer " + 
            check.amount + " " + check.asset + " to your wallet.");
      
      setTimeout(() => {
        setCheck({ ...check, status: 'activated', activated_at: Date.now() });
        setClaiming(false);
      }, 2000);
    } catch (error: any) {
      alert("Claim failed: " + (error?.message || "Unknown error"));
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center" style={{ background: t.bg }}>
        <div className="text-center" style={{ color: t.text }}>
          <div className="text-2xl mb-2">🎁</div>
          <div>Loading check...</div>
        </div>
      </main>
    );
  }

  if (!check) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center p-4" style={{ background: t.bg }}>
        <div className="text-center" style={{ color: t.text }}>
          <div className="text-4xl mb-4">❌</div>
          <h1 className="text-2xl font-bold mb-2">Check Not Found</h1>
          <p style={{ color: t.sub }}>This check doesn't exist or has been deleted.</p>
        </div>
      </main>
    );
  }

  const assetEmojis: any = { 
    USDT: '💵', USDC: '💵', ETH: 'Ξ', BTC: '₿', 
    TON: '💎', BNB: '🔶', SOL: '◎', TRX: '🔺', LTC: 'Ł' 
  };
  const emoji = assetEmojis[check.asset] || '💰';
  const isActivated = check.status === 'activated';

  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-4" style={{ background: t.bg, color: t.text }}>
      <div
        className="w-full max-w-md p-6 sm:p-8 rounded-3xl"
        style={{
          background: t.card,
          boxShadow: t.glow,
          border: t.border,
        }}
      >
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-7xl mb-4 animate-bounce">🎁</div>
          <div className="inline-block px-4 py-1.5 rounded-full mb-3" 
            style={{ 
              background: isActivated ? 'rgba(34,197,94,0.2)' : 'rgba(124,58,237,0.2)',
              border: isActivated ? '1px solid rgba(34,197,94,0.4)' : t.border
            }}>
            <span className="text-xs font-bold uppercase tracking-wider">
              {isActivated ? '✅ Claimed' : '🎁 Active Voucher'}
            </span>
          </div>
          <h1 className="text-2xl font-bold mb-2">
            {isActivated ? 'Check Claimed' : 'Crypto Voucher'}
          </h1>
          <p className="text-sm" style={{ color: t.sub }}>
            {isActivated ? 'This voucher has been redeemed' : 'Someone sent you crypto!'}
          </p>
        </div>

        <div className="space-y-5">
          {/* Amount Display */}
          <div className="text-center py-10 rounded-2xl" style={{ 
            background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(192,38,211,0.15))', 
            border: t.border 
          }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: t.sub }}>
              Voucher Value
            </div>
            <div className="flex items-baseline justify-center gap-3">
              <div className="text-6xl font-black">
                {emoji}
              </div>
              <div>
                <div className="text-6xl font-black">{check.amount}</div>
                <div className="text-2xl font-bold mt-2" style={{ color: t.accent1 }}>
                  {check.asset}
                </div>
              </div>
            </div>
          </div>

          {/* Check Details */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.sub }}>Voucher Details</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(124,58,237,0.2)' }}>
                <div className="text-xs mb-1.5" style={{ color: t.sub }}>Status</div>
                <div className="font-bold text-sm">
                  {isActivated ? '✅ Claimed' : '🟢 Available'}
                </div>
              </div>
              <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(124,58,237,0.2)' }}>
                <div className="text-xs mb-1.5" style={{ color: t.sub }}>Created</div>
                <div className="font-bold text-sm">
                  {new Date(check.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
            {check.network && (
              <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(124,58,237,0.2)' }}>
                <div className="text-xs mb-1.5" style={{ color: t.sub }}>Network</div>
                <div className="font-bold text-sm flex items-center gap-2">
                  {check.network === 'BASE' && '🔵'}
                  {check.network === 'ETH' && 'Ξ'}
                  {check.network === 'POLYGON' && '🟣'}
                  {check.network === 'BNB' && '🟡'}
                  {check.network === 'ARBITRUM' && '🔷'}
                  {check.network === 'OPTIMISM' && '🔴'}
                  {check.network === 'SOLANA' && '◎'}
                  {check.network === 'BITCOIN' && '₿'}
                  {check.network === 'LIGHTNING' && '⚡'}
                  <span>
                    {check.network === 'BNB' ? 'BNB Chain' : 
                     check.network === 'ETH' ? 'Ethereum' : 
                     check.network === 'SOLANA' ? 'Solana' :
                     check.network === 'BITCOIN' ? 'Bitcoin' :
                     check.network === 'LIGHTNING' ? 'Lightning Network' :
                     check.network}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Claim Button */}
          {!isActivated && (
            <button
              onClick={handleClaim}
              disabled={claiming}
              className="w-full py-5 rounded-xl font-bold text-white text-lg active:scale-95 disabled:opacity-60 transition-all"
              style={{ 
                background: `linear-gradient(135deg, ${t.accent1}, ${t.accent2})`,
                boxShadow: claiming ? 'none' : '0 8px 30px rgba(124,58,237,0.5)'
              }}
            >
              {claiming ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⚡</span> Claiming...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <span>🎁</span> Claim {check.amount} {check.asset}
                </span>
              )}
            </button>
          )}

          {/* Success State */}
          {isActivated && (
            <div className="p-6 rounded-2xl text-center" style={{ 
              background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.2))', 
              border: '1px solid rgba(34,197,94,0.4)' 
            }}>
              <div className="text-5xl mb-3">🎉</div>
              <div className="text-lg font-bold mb-2">Successfully Claimed!</div>
              <div className="text-sm leading-relaxed" style={{ color: 'rgb(134,239,172)' }}>
                {check.amount} {check.asset} has been transferred to your wallet
              </div>
              {check.activated_at && (
                <div className="text-xs mt-3" style={{ color: t.sub }}>
                  Claimed on {new Date(check.activated_at).toLocaleDateString()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
