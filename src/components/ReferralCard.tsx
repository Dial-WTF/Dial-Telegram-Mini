'use client';

import { useState } from 'react';
import { ReferralStats } from '@/types/referral';

interface ReferralCardProps {
  stats: ReferralStats | null;
  referralLink: string;
  onShare: () => void;
}

export default function ReferralCard({ stats, referralLink, onShare }: ReferralCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleCopyCode = async () => {
    if (!stats?.referralCode) return;
    try {
      await navigator.clipboard.writeText(stats.referralCode);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  if (!stats) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <p className="text-gray-500">Loading referral data...</p>
      </div>
    );
  }

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'diamond': return 'text-blue-400';
      case 'platinum': return 'text-gray-300';
      case 'gold': return 'text-yellow-400';
      case 'silver': return 'text-gray-400';
      default: return 'text-orange-600';
    }
  };

  const getTierBg = (tier: string) => {
    switch (tier) {
      case 'diamond': return 'bg-blue-100 dark:bg-blue-900';
      case 'platinum': return 'bg-gray-100 dark:bg-gray-700';
      case 'gold': return 'bg-yellow-100 dark:bg-yellow-900';
      case 'silver': return 'bg-gray-100 dark:bg-gray-700';
      default: return 'bg-orange-100 dark:bg-orange-900';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Referral Program
        </h2>
        <div className={`px-3 py-1 rounded-full ${getTierBg(stats.tier)}`}>
          <span className={`text-sm font-semibold ${getTierColor(stats.tier)} uppercase`}>
            {stats.tier}
          </span>
        </div>
      </div>

      {/* Referral Code */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Your Referral Code
        </label>
        <div className="flex gap-2">
          <div
            className="flex-1 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 font-mono text-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
            onClick={handleCopyCode}
          >
            {stats.referralCode}
          </div>
          <button
            onClick={handleCopy}
            className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            Total Referrals
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {stats.totalReferrals}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {stats.directReferrals} direct, {stats.indirectReferrals} indirect
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            Total Earned
          </div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            ${(stats.totalEarned / 100).toFixed(2)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {stats.bonusMultiplier}x multiplier
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            Pending Rewards
          </div>
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
            ${(stats.pendingRewards / 100).toFixed(2)}
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            Paid Out
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            ${(stats.totalPaid / 100).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Level Breakdown */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Referral Levels
        </h3>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((level) => {
            const count = stats[`level${level}Count` as keyof ReferralStats] as number;
            return (
              <div key={level} className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">
                  Level {level}
                </span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Share Button */}
      <button
        onClick={onShare}
        className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all"
      >
        Share Referral Link
      </button>

      {/* Info Text */}
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
        Earn rewards when your referrals make payments or complete activities
      </p>
    </div>
  );
}
