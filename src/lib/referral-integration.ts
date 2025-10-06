/**
 * Integration helpers for referral system
 * Use these functions to integrate referral tracking into your app
 */

/**
 * Track a payment completion
 * Call this when a user completes a payment
 */
export async function trackPaymentCompleted(
  walletAddress: string,
  amount: number, // in cents
  metadata?: {
    invoiceId?: string;
    currency?: string;
    network?: string;
  }
) {
  try {
    const response = await fetch('/api/referral/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        activityType: 'payment_completed',
        amount,
        metadata,
      }),
    });

    const data = await response.json();

    if (data.ok) {
      console.log('Payment tracked:', data.result);
      return data.result;
    } else {
      console.error('Failed to track payment:', data.error);
    }
  } catch (error) {
    console.error('Error tracking payment:', error);
  }
}

/**
 * Track wallet connection
 * Call this when a user connects their wallet for the first time
 */
export async function trackWalletConnected(
  walletAddress: string,
  referralCode?: string | null
) {
  try {
    // First, register the user with referral code if provided
    const response = await fetch('/api/referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        referredBy: referralCode || undefined,
      }),
    });

    const data = await response.json();

    if (data.ok) {
      console.log('User registered:', data.result);

      // Track the wallet connection activity
      await fetch('/api/referral/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          activityType: 'wallet_connected',
          amount: 0,
        }),
      });

      return data.result;
    } else {
      console.error('Failed to register user:', data.error);
    }
  } catch (error) {
    console.error('Error tracking wallet connection:', error);
  }
}

/**
 * Track invoice payment
 * Call this when an invoice is paid
 */
export async function trackInvoicePaid(
  walletAddress: string,
  invoiceId: string,
  amount: number, // in cents
  metadata?: {
    asset?: string;
    network?: string;
    txHash?: string;
  }
) {
  try {
    const response = await fetch('/api/referral/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        activityType: 'invoice_paid',
        amount,
        metadata: {
          invoiceId,
          ...metadata,
        },
      }),
    });

    const data = await response.json();

    if (data.ok) {
      console.log('Invoice payment tracked:', data.result);
      return data.result;
    } else {
      console.error('Failed to track invoice payment:', data.error);
    }
  } catch (error) {
    console.error('Error tracking invoice payment:', error);
  }
}

/**
 * Track subscription purchase
 * Call this when a user purchases a subscription
 */
export async function trackSubscriptionPurchased(
  walletAddress: string,
  amount: number, // in cents
  metadata?: {
    subscriptionId?: string;
    tier?: string;
    duration?: string;
  }
) {
  try {
    const response = await fetch('/api/referral/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        activityType: 'subscription_purchased',
        amount,
        metadata,
      }),
    });

    const data = await response.json();

    if (data.ok) {
      console.log('Subscription tracked:', data.result);
      return data.result;
    } else {
      console.error('Failed to track subscription:', data.error);
    }
  } catch (error) {
    console.error('Error tracking subscription:', error);
  }
}

/**
 * Get referral code from URL params
 * Call this on app load to check for referral codes
 */
export function getReferralCodeFromUrl(): string | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  return params.get('ref');
}

/**
 * Store referral code in local storage
 * Use this to persist referral codes before wallet connection
 */
export function storeReferralCode(code: string) {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem('dial_referral_code', code);
  } catch (error) {
    console.error('Failed to store referral code:', error);
  }
}

/**
 * Get stored referral code from local storage
 */
export function getStoredReferralCode(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    return localStorage.getItem('dial_referral_code');
  } catch (error) {
    console.error('Failed to get stored referral code:', error);
    return null;
  }
}

/**
 * Clear stored referral code
 * Call this after successful registration
 */
export function clearStoredReferralCode() {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem('dial_referral_code');
  } catch (error) {
    console.error('Failed to clear referral code:', error);
  }
}

/**
 * Verify a referral code
 * Call this to check if a referral code is valid before using it
 */
export async function verifyReferralCode(code: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/referral/verify?code=${encodeURIComponent(code)}`);
    const data = await response.json();

    return data.ok && data.result?.valid && data.result?.exists;
  } catch (error) {
    console.error('Error verifying referral code:', error);
    return false;
  }
}
