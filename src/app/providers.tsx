'use client';

import { PrivyProvider } from '@privy-io/react-auth';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      // (optional) clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID}
      config={{
        // Create an embedded wallet automatically for users who log in without a wallet
        embeddedWallets: {
          solana: {
            createOnLogin: 'users-without-wallets'
          },
          ethereum: {
            createOnLogin: 'users-without-wallets'
          }
        },

        // Keep the UI dark & on-brand
        appearance: {
          theme: 'dark',
          accentColor: '#7C3AED', // Dial purple
          // walletList: [...] // if you later want to customize external wallets ordering
        },

        // Show a richer modal like the docs: email + socials + wallet
        // Note: some OAuth providers may not work in Telegram IAB; enable per your needs
        loginMethods: ['email', 'google', 'discord', 'wallet'],

        // Temporarily disable external wallets until config is finalized
        // externalWallets: { walletConnect: { enabled: true } },

        // If you use multiple chains, set these:
        // defaultChain: { id: 8453, rpcUrl: 'https://...' }, // Base
        // supportedChains: [{ id: 8453 }, { id: 42161 }],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
