# Network Selection Feature

## Overview
Users can now select which blockchain network they want to use for their crypto payments directly from the mini app interface.

## Supported Networks

### Layer 1
- **Ethereum (ETH)** - Ξ 🔵 - Main Ethereum network
- **BNB Chain** - 🟡 - Binance Smart Chain

### Layer 2 & Sidechains
- **Base** - 🔵 - Coinbase's L2 (Default)
- **Polygon** - 🟣 - Low-cost scaling solution
- **Arbitrum** - 🔷 - Optimistic rollup L2
- **Optimism** - 🔴 - Optimistic rollup L2

## UI/UX Features

### Main Page
- **Network selector grid** - 3 columns on mobile, 6 on desktop
- **Color-coded buttons** - Each network has its brand color
- **Emoji indicators** - Visual network identification
- **Active state** - Gradient background when selected
- **Default network** - BASE (optimized for low fees)

### Invoice Pages
- **Network badge** - Shows selected network with emoji
- **Network details** - Displayed in invoice information section

### Asset Compatibility
Different networks support different assets:
- **Stablecoins (USDC, USDT)** - Available on all EVM chains
- **Native tokens (ETH, BNB)** - Network-specific
- **Layer 2 bridged assets** - Available on respective L2s

## Technical Implementation

### Type System
```typescript
type SupportedNetwork = 'ETH' | 'BASE' | 'BNB' | 'POLYGON' | 'ARBITRUM' | 'OPTIMISM';
```

### Default Behavior
- If no network is specified, defaults to **BASE**
- BASE chosen for low transaction fees and fast confirmations

### Data Flow
1. User selects network in UI
2. Network stored in component state
3. Included in API calls for invoices/transfers/checks
4. Stored with transaction data
5. Displayed on payment pages

## Chain IDs (for Privy integration)
- Ethereum: 1
- Base: 8453
- BNB Chain: 56
- Polygon: 137
- Arbitrum: 42161
- Optimism: 10

## Future Enhancements
- [ ] Dynamic network fees display
- [ ] Asset availability per network
- [ ] Cross-chain bridge integration
- [ ] Network status indicators
- [ ] Gas price estimates
