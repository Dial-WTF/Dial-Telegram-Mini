/**
 * Admin configuration for DevOps dashboard and privileged operations
 * Centralized admin wallet management to avoid code duplication
 */

export const ADMIN_WALLETS = [
  '0x3fd4e6B0505E90C285e16248e736472B53fcEe49'.toLowerCase(),
  '0x99dbD6011c4b34787e372FEE22EBb7F3c9D06879'.toLowerCase(),
  '0xab78dce9CD712267b634d8320bC39BB9A7d9FfFB'.toLowerCase(),
];

/**
 * Check if a wallet address has admin privileges
 * @param address - Wallet address to check
 * @returns boolean indicating if address is an admin
 */
export function isAdminWallet(address: string | null | undefined): boolean {
  if (!address) return false;
  return ADMIN_WALLETS.includes(address.toLowerCase());
}

/**
 * Require admin authentication for API routes
 * @param userAddress - User address from authentication headers
 * @throws Error if user is not an admin
 */
export function requireAdminAccess(userAddress: string | null | undefined): void {
  if (!isAdminWallet(userAddress)) {
    throw new Error(`Unauthorized - Admin access required. Address: ${userAddress || 'null'}`);
  }
}

/**
 * Get admin configuration for logging/debugging
 */
export function getAdminConfig() {
  return {
    adminWallets: ADMIN_WALLETS,
    totalAdmins: ADMIN_WALLETS.length,
  };
}
