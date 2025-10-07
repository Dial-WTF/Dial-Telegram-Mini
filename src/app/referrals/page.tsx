'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useSearchParams } from 'next/navigation';
import { useReferral } from '@/lib/hooks/useReferral';
import BottomNav from '@/components/BottomNav';
import { useState, useEffect, Suspense } from 'react';

// Match Dial theme
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

function ReferralsInner() {
  const { ready, authenticated, user, login } = usePrivy();
  const searchParams = useSearchParams();
  const refCode = searchParams.get('ref');
  const [copied, setCopied] = useState(false);
  const [forceShow, setForceShow] = useState(false);

  const walletAddress = user?.wallet?.address;

  // Force show after 3 seconds if Privy doesn't load
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!ready) {
        console.warn('Privy not ready after 3s, forcing display');
        setForceShow(true);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [ready]);

  const {
    stats,
    referralCode,
    referralLink,
    shareReferral,
  } = useReferral({
    walletAddress,
    referralCode: refCode,
    autoRegister: true,
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // Debug logging
  useEffect(() => {
    console.log('Referrals page state:', { ready, authenticated, walletAddress, stats, referralCode });
  }, [ready, authenticated, walletAddress, stats, referralCode]);

  if (!ready && !forceShow) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center" style={{ background: t.bg, color: t.text }}>
        <div className="text-center">
          <div style={{ color: t.sub }}>Loading Privy...</div>
          <div className="text-xs mt-2" style={{ color: t.sub }}>If this takes too long, try refreshing</div>
        </div>
      </main>
    );
  }

  if (!authenticated || !walletAddress) {
    return (
      <main className="min-h-[100dvh] flex items-stretch justify-center p-3" style={{ background: t.bg, color: t.text }}>
        <div className="w-full max-w-md relative p-3 rounded-3xl flex flex-col" style={{ background: t.card, boxShadow: t.glow, border: t.border }}>
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
            <div className="text-6xl">🤝</div>
            <h1 className="text-2xl font-bold" style={{ color: t.text }}>
              Referral Program
            </h1>
            <p style={{ color: t.sub }}>
              Connect your wallet to access your referral code and start earning rewards!
            </p>
            {refCode && (
              <div className="p-4 rounded-lg w-full" style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)' }}>
                <p className="text-sm" style={{ color: t.text }}>
                  🎉 You were referred with code:
                </p>
                <p className="text-lg font-bold mt-1" style={{ color: t.accent1 }}>
                  {refCode}
                </p>
              </div>
            )}
            <button
              onClick={() => login()}
              className="px-6 py-3 rounded-lg font-bold text-white transition-all active:scale-95"
              style={{ background: `linear-gradient(135deg, ${t.accent1} 0%, ${t.accent2} 100%)` }}
            >
              Connect Wallet
            </button>
          </div>
          <BottomNav className="mt-3 shrink-0" />
        </div>
      </main>
    );
  }

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'diamond': return '#60A5FA';
      case 'platinum': return '#D1D5DB';
      case 'gold': return '#FBBF24';
      case 'silver': return '#9CA3AF';
      default: return '#FB923C';
    }
  };

  return (
    <main className="min-h-[100dvh] flex items-stretch justify-center p-3" style={{ background: t.bg, color: t.text }}>
      <div className="w-full max-w-md relative p-3 rounded-3xl flex flex-col max-h-[100dvh]" style={{ background: t.card, boxShadow: t.glow, border: t.border }}>
        <div className="flex-1 overflow-y-auto overscroll-contain space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold" style={{ color: t.text }}>
              🤝 Referrals
            </h1>
            {stats && (
              <div className="px-3 py-1 rounded-full text-xs font-bold" style={{ background: `${getTierColor(stats.tier)}33`, color: getTierColor(stats.tier) }}>
                {stats.tier.toUpperCase()}
              </div>
            )}
          </div>

          {/* Your Referral Code */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(124,58,237,0.15)', border: t.border }}>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.sub }}>
              Your Referral Code
            </div>
            <div className="flex gap-2">
              <div
                className="flex-1 bg-black/30 rounded-lg px-4 py-3 font-mono text-lg font-bold text-center cursor-pointer"
                onClick={handleCopy}
                style={{ color: t.accent1 }}
              >
                {referralCode || '---'}
              </div>
              <button
                onClick={handleCopy}
                className="px-4 py-2 rounded-lg font-bold text-white transition-all active:scale-95"
                style={{ background: t.accent1 }}
              >
                {copied ? '✓' : '📋'}
              </button>
            </div>
            <button
              onClick={shareReferral}
              className="w-full py-2.5 rounded-lg font-bold text-white transition-all active:scale-95"
              style={{ background: `linear-gradient(135deg, ${t.accent1} 0%, ${t.accent2} 100%)` }}
            >
              📤 Share Link
            </button>
          </div>

          {/* Stats */}
          {stats && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl p-3" style={{ background: 'rgba(124,58,237,0.15)', border: t.border }}>
                  <div className="text-xs" style={{ color: t.sub }}>Total Referrals</div>
                  <div className="text-2xl font-bold mt-1" style={{ color: t.text }}>
                    {stats.totalReferrals}
                  </div>
                  <div className="text-[10px] mt-1" style={{ color: t.sub }}>
                    {stats.directReferrals} direct
                  </div>
                </div>
                <div className="rounded-xl p-3" style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.35)' }}>
                  <div className="text-xs" style={{ color: '#6EE7B7' }}>Total Earned</div>
                  <div className="text-2xl font-bold mt-1" style={{ color: '#10B981' }}>
                    ${(stats.totalEarned / 100).toFixed(2)}
                  </div>
                  <div className="text-[10px] mt-1" style={{ color: '#6EE7B7' }}>
                    {stats.bonusMultiplier}x multiplier
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl p-3" style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.35)' }}>
                  <div className="text-xs" style={{ color: '#FCD34D' }}>Pending</div>
                  <div className="text-xl font-bold mt-1" style={{ color: '#FBBF24' }}>
                    ${(stats.pendingRewards / 100).toFixed(2)}
                  </div>
                </div>
                <div className="rounded-xl p-3" style={{ background: 'rgba(124,58,237,0.15)', border: t.border }}>
                  <div className="text-xs" style={{ color: t.sub }}>Paid Out</div>
                  <div className="text-xl font-bold mt-1" style={{ color: t.text }}>
                    ${(stats.totalPaid / 100).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Levels */}
              <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(124,58,237,0.15)', border: t.border }}>
                <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.sub }}>
                  Referral Levels
                </div>
                {[1, 2, 3, 4, 5].map((level) => {
                  const count = stats[`level${level}Count` as keyof typeof stats] as number;
                  return (
                    <div key={level} className="flex items-center justify-between text-sm">
                      <span style={{ color: t.sub }}>Level {level}</span>
                      <span className="font-bold" style={{ color: t.text }}>{count}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* How It Works */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(124,58,237,0.15)', border: t.border }}>
            <div className="text-sm font-bold" style={{ color: t.text }}>
              💡 How It Works
            </div>
            <div className="space-y-2 text-xs" style={{ color: t.sub }}>
              <div className="flex gap-2">
                <span className="font-bold" style={{ color: t.accent1 }}>1.</span>
                <span>Share your referral link with friends</span>
              </div>
              <div className="flex gap-2">
                <span className="font-bold" style={{ color: t.accent1 }}>2.</span>
                <span>They connect their wallet using your link</span>
              </div>
              <div className="flex gap-2">
                <span className="font-bold" style={{ color: t.accent1 }}>3.</span>
                <span>Earn up to 5% on their payments</span>
              </div>
              <div className="flex gap-2">
                <span className="font-bold" style={{ color: t.accent1 }}>4.</span>
                <span>Get rewards from 5 levels deep</span>
              </div>
            </div>
          </div>

          {/* Commission Rates */}
          <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.35)' }}>
            <div className="text-sm font-bold" style={{ color: '#10B981' }}>
              💰 Commission Rates
            </div>
            <div className="space-y-1 text-xs">
              {[
                { level: 1, rate: '5%' },
                { level: 2, rate: '3%' },
                { level: 3, rate: '2%' },
                { level: 4, rate: '1%' },
                { level: 5, rate: '0.5%' },
              ].map(({ level, rate }) => (
                <div key={level} className="flex justify-between">
                  <span style={{ color: '#6EE7B7' }}>Level {level}{level === 1 ? ' (Direct)' : ''}</span>
                  <span className="font-bold" style={{ color: '#10B981' }}>{rate}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <BottomNav className="mt-3 shrink-0" />
      </div>
    </main>
  );
}

export default function ReferralsPage() {
  return (
    <Suspense fallback={
      <main className="min-h-[100dvh] flex items-center justify-center" style={{ background: t.bg, color: t.text }}>
        <div className="text-center">
          <div style={{ color: t.sub }}>Loading…</div>
        </div>
      </main>
    }>
      <ReferralsInner />
    </Suspense>
  );
}
