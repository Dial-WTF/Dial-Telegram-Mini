export const decodeJwtToken = (token: string) => {
  try {
    // JWT tokens are made of three parts: header.payload.signature
    // We only need to decode the payload (middle part)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { error: 'Not a valid JWT token format' };
    }

    // The payload is base64 encoded
    const payload = parts[1];

    // Replace characters for base64Url to regular base64
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');

    // Decode the base64
    const jsonPayload = atob(base64);

    // Parse the JSON
    return JSON.parse(jsonPayload);
  } catch (error) {
    return {
      error: 'Failed to decode token',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

export const truncateAddress = (address: string, chars = 4): string => {
  if (!address) return '';

  // Check if the address is valid or if it's already truncated
  if (address.length < chars * 2 + 5) {
    return address;
  }

  // Format the address with a middle ellipsis
  try {
    return `${address.slice(0, chars)}...${address.slice(-chars)}`;
  } catch (e) {
    console.warn('Error truncating address:', e);
    return address;
  }
};

/**
 * Normalizes an Ethereum address by converting it to lowercase
 * This ensures case-insensitive address comparison
 * @param address The Ethereum address to normalize
 * @returns The normalized address (lowercase)
 */
export function normalizeAddress(address: string | undefined | null): string | undefined {
  if (!address) return undefined;
  return address.toLowerCase();
}

/**
 * Truncate text to a specific length and add ellipsis
 * @param text Text to truncate
 * @param maxLength Maximum length before truncation
 * @returns Truncated text with ellipsis if needed
 */
export function truncateText(text: string | undefined | null, maxLength: number = 55): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

/**
 * Validates if a string is a valid Ethereum address
 * @param address The address to validate
 * @returns True if the address is valid
 */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validates if a string is a valid Solana address (base58 encoded)
 * @param address The address to validate
 * @returns True if the address is valid
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    // Solana addresses are base58 encoded and are exactly 44 characters (32 bytes)
    // Some special addresses might be shorter, but most are 44 characters
    // Base58 alphabet: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

    if (!base58Regex.test(address)) {
      return false;
    }

    // Additional validation: ensure it's proper base58 by checking for invalid characters
    const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    for (const char of address) {
      if (!base58Alphabet.includes(char)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validates if a string is a valid Pump.fun contract address
 * @param address The contract address to validate
 * @returns True if the address is valid
 */
export function isValidPumpfunAddress(address: string): boolean {
  // Pump.fun contract addresses are Solana addresses
  return isValidSolanaAddress(address);
}

/**
 * Formats a Solana address for display (truncated with ellipsis)
 * @param address The Solana address to format
 * @param startChars Number of characters to show at the start (default: 4)
 * @param endChars Number of characters to show at the end (default: 4)
 * @returns Formatted address string
 */
export function formatSolanaAddress(
  address: string,
  startChars: number = 4,
  endChars: number = 4
): string {
  if (!address || address.length <= startChars + endChars) {
    return address;
  }

  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}
