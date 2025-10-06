'use client';

import { useState, useEffect, useCallback } from 'react';
import { ReferralStats, CreateReferralResponse } from '@/types/referral';
import { generateReferralLink } from '@/lib/referral-utils';

interface UseReferralOptions {
  walletAddress?: string;
  telegramUserId?: number;
  referralCode?: string | null; // from URL params
  autoRegister?: boolean;
}

export function useReferral({
  walletAddress,
  telegramUserId,
  referralCode,
  autoRegister = true,
}: UseReferralOptions = {}) {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [userReferralCode, setUserReferralCode] = useState<string>('');
  const [referralLink, setReferralLink] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  // Register user and create referral code
  const register = useCallback(async (wallet: string, telegramId?: number, refCode?: string) => {
    if (!wallet) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: wallet,
          telegramUserId: telegramId,
          referredBy: refCode || undefined,
        }),
      });

      const data: CreateReferralResponse = await response.json();

      if (!data.ok) {
        throw new Error(data.error || 'Failed to register referral');
      }

      if (data.result) {
        setUserReferralCode(data.result.referralCode);
        setReferralLink(data.result.referralLink);
        setRegistered(true);

        // Fetch stats
        await fetchStats(wallet);
      }
    } catch (err: any) {
      console.error('Failed to register referral:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch referral stats
  const fetchStats = useCallback(async (wallet: string) => {
    if (!wallet) return;

    try {
      const response = await fetch(`/api/referral?wallet=${encodeURIComponent(wallet)}`);
      const data = await response.json();

      if (data.ok && data.result) {
        setStats(data.result);
        setUserReferralCode(data.result.referralCode);
        setReferralLink(generateReferralLink(data.result.referralCode));
        setRegistered(true);
      } else if (response.status === 404) {
        // User not registered yet
        setRegistered(false);
      }
    } catch (err: any) {
      console.error('Failed to fetch stats:', err);
      setError(err.message);
    }
  }, []);

  // Track activity
  const trackActivity = useCallback(async (
    activityType: string,
    amount?: number,
    metadata?: Record<string, any>
  ) => {
    if (!walletAddress) {
      console.warn('Cannot track activity: wallet not connected');
      return;
    }

    try {
      const response = await fetch('/api/referral/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          activityType,
          amount,
          metadata,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        // Refresh stats after tracking activity
        await fetchStats(walletAddress);
      }
    } catch (err: any) {
      console.error('Failed to track activity:', err);
    }
  }, [walletAddress, fetchStats]);

  // Share referral link
  const shareReferral = useCallback(async () => {
    if (!referralLink) return;

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Join Dial Pay',
          text: `Use my referral code ${userReferralCode} to get started with Dial Pay!`,
          url: referralLink,
        });
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(referralLink);
        alert('Referral link copied to clipboard!');
      }
    } catch (err: any) {
      console.error('Failed to share:', err);
    }
  }, [referralLink, userReferralCode]);

  // Auto-register when wallet is connected
  useEffect(() => {
    if (walletAddress && autoRegister && !registered && !loading) {
      register(walletAddress, telegramUserId, referralCode || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, autoRegister, registered, loading, telegramUserId, referralCode]);

  // Fetch stats when wallet changes
  useEffect(() => {
    if (walletAddress && registered) {
      fetchStats(walletAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, registered]);

  return {
    stats,
    referralCode: userReferralCode,
    referralLink,
    loading,
    error,
    registered,
    register,
    fetchStats,
    trackActivity,
    shareReferral,
  };
}
