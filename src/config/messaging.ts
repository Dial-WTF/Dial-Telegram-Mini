'use client';

/**
 * Messaging provider configuration
 * This file contains settings for the messaging providers
 */

// Available provider types
// Note: MOCK provider has been removed as part of messaging architecture migration
export enum MessagingProviderType {
  MATRIX = 'matrix',
}

// Configuration for messaging
export const MESSAGING_CONFIG = {
  // Set the active provider type here
  activeProvider: MessagingProviderType.MATRIX, // Using Matrix with dynamic authentication

  // Matrix configuration is now handled dynamically via:
  // - MatrixAuthManager for user authentication
  // - MatrixKeychainProvider for credential storage
  // - Environment-specific settings in MATRIX_ENVIRONMENTS

  // No hardcoded credentials needed - all handled via SIWE → Keychain flow
};
