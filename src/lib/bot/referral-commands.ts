/**
 * Telegram Bot Commands for Referral System
 *
 * Add these command handlers to your bot route file
 */

import { getReferralUserByCode, getReferralStats } from '@/lib/referral-storage';
import { generateReferralLink } from '@/lib/referral-utils';

/**
 * Handle /referral command
 * Shows user's referral stats and code
 */
export async function handleReferralCommand(
  userId: number,
  walletAddress?: string
): Promise<string> {
  if (!walletAddress) {
    return `💰 *Your Referral Program*\n\n` +
      `Connect your wallet to access your referral code and start earning rewards!\n\n` +
      `Tap the button below to connect your wallet.`;
  }

  const stats = getReferralStats(walletAddress);

  if (!stats) {
    return `💰 *Your Referral Program*\n\n` +
      `You're not registered yet. Connect your wallet in the app to get started!`;
  }

  const referralLink = generateReferralLink(stats.referralCode);

  return (
    `💰 *Your Referral Stats*\n\n` +
    `🔑 Code: \`${stats.referralCode}\`\n` +
    `🔗 Link: ${referralLink}\n\n` +
    `👥 Total Referrals: *${stats.totalReferrals}*\n` +
    `├─ Direct: ${stats.directReferrals}\n` +
    `└─ Indirect: ${stats.indirectReferrals}\n\n` +
    `💵 Earnings:\n` +
    `├─ Total Earned: *$${(stats.totalEarned / 100).toFixed(2)}*\n` +
    `├─ Paid Out: $${(stats.totalPaid / 100).toFixed(2)}\n` +
    `└─ Pending: $${(stats.pendingRewards / 100).toFixed(2)}\n\n` +
    `🏆 Tier: *${stats.tier.toUpperCase()}* (${stats.bonusMultiplier}x)\n\n` +
    `Share your link to start earning rewards! 🚀`
  );
}

/**
 * Handle /myref or /mycode command
 * Shows just the user's referral code
 */
export async function handleMyCodeCommand(
  userId: number,
  walletAddress?: string
): Promise<string> {
  if (!walletAddress) {
    return `Connect your wallet to get your referral code! 👛`;
  }

  const stats = getReferralStats(walletAddress);

  if (!stats) {
    return `You're not registered yet. Open the app to get your referral code!`;
  }

  const referralLink = generateReferralLink(stats.referralCode);

  return (
    `🔑 *Your Referral Code*\n\n` +
    `Code: \`${stats.referralCode}\`\n` +
    `Link: ${referralLink}\n\n` +
    `Share this link to invite friends and earn rewards! 💰`
  );
}

/**
 * Handle /checkref <code> command
 * Verify a referral code
 */
export async function handleCheckRefCommand(
  code: string
): Promise<string> {
  const user = getReferralUserByCode(code);

  if (!user) {
    return `❌ Referral code \`${code}\` not found.`;
  }

  const stats = getReferralStats(user.walletAddress);

  if (!stats) {
    return `✅ Valid code: \`${code}\`\n\nBut stats are not available.`;
  }

  return (
    `✅ *Valid Referral Code*\n\n` +
    `Code: \`${code}\`\n` +
    `Referrer: \`${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}\`\n` +
    `Total Referrals: *${stats.totalReferrals}*\n` +
    `Tier: *${stats.tier.toUpperCase()}*\n\n` +
    `Use this code when connecting your wallet to support this referrer!`
  );
}

/**
 * Generate inline keyboard for referral commands
 */
export function getReferralKeyboard(baseUrl: string, referralCode?: string) {
  const buttons = [];

  if (referralCode) {
    const referralLink = generateReferralLink(referralCode, baseUrl);
    buttons.push([
      { text: '📤 Share Referral Link', url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join me on Dial Pay and earn rewards! 💰')}` }
    ]);
  }

  buttons.push([
    { text: '💰 Open Referrals Page', web_app: { url: `${baseUrl}/referrals` } }
  ]);

  return { inline_keyboard: buttons };
}

/**
 * Example bot command integration
 * Add this to your bot route.ts message handler
 */
export const REFERRAL_COMMAND_EXAMPLES = `
// In your bot route.ts, add these command handlers:

// Handle /referral command
if (text === '/referral' || text === '/ref') {
  const walletAddress = await getUserWalletAddress(userId); // Implement this
  const message = await handleReferralCommand(userId, walletAddress);
  const keyboard = getReferralKeyboard(baseUrl, stats?.referralCode);

  await tgCall('sendMessage', {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
  return NextResponse.json({ ok: true });
}

// Handle /myref or /mycode command
if (text === '/myref' || text === '/mycode') {
  const walletAddress = await getUserWalletAddress(userId);
  const message = await handleMyCodeCommand(userId, walletAddress);

  await tgCall('sendMessage', {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown'
  });
  return NextResponse.json({ ok: true });
}

// Handle /checkref <code> command
if (text.startsWith('/checkref ')) {
  const code = text.substring(10).trim();
  const message = await handleCheckRefCommand(code);

  await tgCall('sendMessage', {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown'
  });
  return NextResponse.json({ ok: true });
}
`;
