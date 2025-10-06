'use client';

import { useEffect, useState } from 'react';
import { ReferralLeaderboard as LeaderboardType } from '@/types/referral';

export default function ReferralLeaderboard() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch('/api/referral/leaderboard?limit=10');
      const data = await response.json();

      if (data.ok && data.result) {
        setLeaderboard(data.result);
      }
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRankEmoji = (rank: number) => {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return `#${rank}`;
    }
  };

  const getTierEmoji = (tier: string) => {
    switch (tier) {
      case 'diamond': return '💎';
      case 'platinum': return '⚪';
      case 'gold': return '🥇';
      case 'silver': return '🥈';
      default: return '🥉';
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
          Top Referrers
        </h3>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 animate-pulse"
            >
              <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (leaderboard.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
          Top Referrers
        </h3>
        <p className="text-gray-500 text-center py-8">
          No leaderboard data yet. Be the first!
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
      <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
        Top Referrers 🏆
      </h3>

      <div className="space-y-2">
        {leaderboard.map((entry) => (
          <div
            key={entry.walletAddress}
            className={`
              flex items-center justify-between p-4 rounded-lg
              ${entry.rank <= 3
                ? 'bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 border border-yellow-200 dark:border-yellow-800'
                : 'bg-gray-50 dark:bg-gray-700'
              }
            `}
          >
            <div className="flex items-center gap-3 flex-1">
              <div className="text-2xl font-bold w-12 text-center">
                {getRankEmoji(entry.rank)}
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-gray-900 dark:text-white">
                    {formatAddress(entry.walletAddress)}
                  </span>
                  <span className="text-xs">
                    {getTierEmoji(entry.tier)}
                  </span>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {entry.referralCode}
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="text-lg font-bold text-green-600 dark:text-green-400">
                ${(entry.totalEarned / 100).toFixed(2)}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {entry.totalReferrals} referrals
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-center">
        <button
          onClick={fetchLeaderboard}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
