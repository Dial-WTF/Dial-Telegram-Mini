"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSendTransaction } from "@privy-io/react-auth";
import Image from "next/image";
import { parseEther, parseUnits } from "viem";

const t = {
  bg: "radial-gradient(80% 60% at 50% 0%, #0b0713 0%, #0a0612 40%, #07040e 100%)",
  card: "#141021",
  text: "#EDE9FE",
  sub: "#B8A6F8",
  accent1: "#7C3AED",
  accent2: "#C026D3",
  glow: "0 10px 40px rgba(124,58,237,.25)",
  border: "1px solid rgba(124,58,237,.35)",
};

export default function CryptoPayPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params?.id as string;
  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const { authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();

  useEffect(() => {
    if (!invoiceId) return;
    
    // Fetch invoice details
    fetch(`/api/crypto/invoice?invoice_id=${invoiceId}`)
      .then(res => res.json())
      .then(data => {
        if (data.ok && data.result && data.result.length > 0) {
          setInvoice(data.result[0]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [invoiceId]);

  const handlePay = async () => {
    if (!authenticated) {
      await login();
      return;
    }

    if (!wallets || wallets.length === 0) {
      alert("No wallet connected. Please connect a wallet first.");
      return;
    }

    if (!invoice.payee_address) {
      alert("Invalid invoice: missing recipient address.");
      return;
    }

    setPaying(true);
    try {
      const wallet = wallets[0];
      const amount = invoice.amount;
      const asset = invoice.asset;
      const network = invoice.network || 'BASE';
      const recipientAddress = invoice.payee_address;
      
      // Handle different network types
      if (network === 'SOLANA') {
        // Solana transaction
        alert(`Solana payments coming soon! You would send ${amount} ${asset} to ${invoice.payee_address}`);
        setPaying(false);
        return;
      }
      
      if (network === 'BITCOIN' || network === 'LIGHTNING') {
        // Bitcoin/Lightning transaction
        alert(`${network} payments coming soon! You would send ${amount} ${asset} to ${invoice.payee_address}`);
        setPaying(false);
        return;
      }
      
      // EVM-based transaction
      let txHash;
      
      if (asset === 'ETH' || asset === 'BNB') {
        // Native token transfer
        const valueInWei = parseEther(amount);
        
        txHash = await sendTransaction({
          to: recipientAddress as `0x${string}`,
          value: valueInWei,
          chainId: getChainId(network),
        });
      } else {
        // ERC20 token transfer (USDC, USDT, etc.)
        const tokenAddress = getTokenAddress(asset, network);
        const decimals = 6; // USDC/USDT use 6 decimals
        const valueInUnits = parseUnits(amount, decimals);
        
        // ERC20 transfer function data
        const transferData = `0xa9059cbb${recipientAddress.slice(2).padStart(64, '0')}${valueInUnits.toString(16).padStart(64, '0')}`;
        
        txHash = await sendTransaction({
          to: tokenAddress as `0x${string}`,
          data: transferData as `0x${string}`,
          chainId: getChainId(network),
        });
      }
      
      // Update invoice status with transaction hash
      setInvoice({ ...invoice, status: 'paid', paid_at: Date.now(), tx_hash: txHash });
      
      // Show success message
      alert(`Payment successful! Transaction: ${txHash}`);
      
    } catch (error: any) {
      console.error('Payment error:', error);
      const errorMessage = error?.message || "Transaction was rejected or failed";
      alert("Payment failed: " + errorMessage);
      
      // Log detailed error for debugging
      if (error?.code) {
        console.error('Error code:', error.code);
      }
    } finally {
      setPaying(false);
    }
  };
  
  const getChainId = (network: string): number => {
    const chains: Record<string, number> = {
      ETH: 1,
      BASE: 8453,
      POLYGON: 137,
      BNB: 56,
      ARBITRUM: 42161,
      OPTIMISM: 10,
    };
    return chains[network] || 8453;
  };
  
  const getTokenAddress = (asset: string, network: string): string => {
    // Token addresses for different networks
    const tokens: Record<string, Record<string, string>> = {
      USDC: {
        BASE: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        ETH: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        POLYGON: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        ARBITRUM: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        OPTIMISM: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
      },
      USDT: {
        BASE: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
        ETH: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        POLYGON: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        ARBITRUM: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      },
    };
    return tokens[asset]?.[network] || tokens[asset]?.['BASE'] || '';
  };

  if (loading) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center" style={{ background: t.bg }}>
        <div className="text-center" style={{ color: t.text }}>
          <div className="text-2xl mb-2">💎</div>
          <div>Loading invoice...</div>
        </div>
      </main>
    );
  }

  if (!invoice) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center p-4" style={{ background: t.bg }}>
        <div className="text-center" style={{ color: t.text }}>
          <div className="text-4xl mb-4">❌</div>
          <h1 className="text-2xl font-bold mb-2">Invoice Not Found</h1>
          <p style={{ color: t.sub }}>This invoice doesn't exist or has been deleted.</p>
        </div>
      </main>
    );
  }

  const assetEmojis: any = { 
    USDT: '💵', USDC: '💵', ETH: 'Ξ', BTC: '₿', 
    TON: '💎', BNB: '🔶', SOL: '◎', TRX: '🔺', LTC: 'Ł' 
  };
  const emoji = assetEmojis[invoice.asset] || '💰';

  const isPaid = invoice.status === 'paid';
  const isExpired = invoice.expires_at && Date.now() > invoice.expires_at;

  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-4" style={{ background: t.bg, color: t.text }}>
      <div
        className="w-full max-w-md p-6 sm:p-8 rounded-3xl"
        style={{
          background: t.card,
          boxShadow: t.glow,
          border: t.border,
        }}
      >
        {/* Header */}
        <div className="text-center mb-6">
          <Image
            src="/phone.logo.no.bg.png"
            alt="Dial"
            width={100}
            height={100}
            className="mx-auto mb-4 drop-shadow-[0_10px_40px_rgba(124,58,237,.35)]"
          />
          <div className="inline-block px-4 py-1.5 rounded-full mb-3" 
            style={{ 
              background: isPaid ? 'rgba(34,197,94,0.2)' : isExpired ? 'rgba(239,68,68,0.2)' : 'rgba(124,58,237,0.2)',
              border: isPaid ? '1px solid rgba(34,197,94,0.4)' : isExpired ? '1px solid rgba(239,68,68,0.4)' : t.border
            }}>
            <span className="text-xs font-bold uppercase tracking-wider">
              {isPaid ? '✅ Paid' : isExpired ? '⏰ Expired' : '🟢 Active Invoice'}
            </span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: t.sub }}>
            Payment Request
          </h1>
        </div>

        <div className="space-y-5">
          {/* Amount Display */}
          <div className="text-center py-8 rounded-2xl" style={{ 
            background: 'linear-gradient(135deg, rgba(124,58,237,0.1), rgba(192,38,211,0.1))', 
            border: t.border 
          }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.sub }}>
              Amount Due
            </div>
            <div className="flex items-baseline justify-center gap-3">
              <div className="text-6xl font-black">
                {emoji}
              </div>
              <div>
                <div className="text-5xl font-black">{invoice.amount}</div>
                <div className="text-xl font-bold mt-1" style={{ color: t.accent1 }}>
                  {invoice.asset}
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          {invoice.description && (
            <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(124,58,237,0.2)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.sub }}>Description</div>
              <div className="text-sm leading-relaxed">{invoice.description}</div>
            </div>
          )}

          {/* Invoice Details */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.sub }}>Invoice Details</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(124,58,237,0.2)' }}>
                <div className="text-xs mb-1.5" style={{ color: t.sub }}>Status</div>
                <div className="font-bold text-sm">
                  {isPaid ? '✅ Paid' : isExpired ? '⏰ Expired' : '🟢 Active'}
                </div>
              </div>
              <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(124,58,237,0.2)' }}>
                <div className="text-xs mb-1.5" style={{ color: t.sub }}>Created</div>
                <div className="font-bold text-sm">
                  {new Date(invoice.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
            {invoice.network && (
              <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(124,58,237,0.2)' }}>
                <div className="text-xs mb-1.5" style={{ color: t.sub }}>Network</div>
                <div className="font-bold text-sm flex items-center gap-2">
                  {invoice.network === 'BASE' && '🔵'}
                  {invoice.network === 'ETH' && 'Ξ'}
                  {invoice.network === 'POLYGON' && '🟣'}
                  {invoice.network === 'BNB' && '🟡'}
                  {invoice.network === 'ARBITRUM' && '🔷'}
                  {invoice.network === 'OPTIMISM' && '🔴'}
                  {invoice.network === 'SOLANA' && '◎'}
                  {invoice.network === 'BITCOIN' && '₿'}
                  {invoice.network === 'LIGHTNING' && '⚡'}
                  <span>
                    {invoice.network === 'BNB' ? 'BNB Chain' : 
                     invoice.network === 'ETH' ? 'Ethereum' : 
                     invoice.network === 'SOLANA' ? 'Solana' :
                     invoice.network === 'BITCOIN' ? 'Bitcoin' :
                     invoice.network === 'LIGHTNING' ? 'Lightning Network' :
                     invoice.network}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Recipient Address */}
          {invoice.payee_address && (
            <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(124,58,237,0.2)' }}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: t.sub }}>Recipient</div>
              <div className="font-mono text-xs break-all" style={{ color: t.text }}>{invoice.payee_address}</div>
              <div className="text-[9px] mt-1" style={{ color: t.sub }}>Funds will be sent to this address</div>
            </div>
          )}

          {/* Payment Button */}
          {!isPaid && !isExpired && (
            <button
              onClick={handlePay}
              disabled={paying}
              className="w-full py-5 rounded-xl font-bold text-white text-lg active:scale-95 disabled:opacity-60 transition-all"
              style={{ 
                background: `linear-gradient(135deg, ${t.accent1}, ${t.accent2})`,
                boxShadow: paying ? 'none' : '0 8px 30px rgba(124,58,237,0.5)'
              }}
            >
              {paying ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⚡</span> Processing Payment...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <span>💳</span> Pay {invoice.amount} {invoice.asset}
                </span>
              )}
            </button>
          )}

          {/* Success Message */}
          {isPaid && invoice.hidden_message && (
            <div className="p-5 rounded-xl text-center" style={{ 
              background: 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(16,185,129,0.15))', 
              border: '1px solid rgba(34,197,94,0.4)' 
            }}>
              <div className="text-3xl mb-2">🎉</div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'rgb(134,239,172)' }}>Thank you!</div>
              <div className="text-sm leading-relaxed">{invoice.hidden_message}</div>
            </div>
          )}

          {isPaid && invoice.paid_btn_url && invoice.paid_btn_name && (
            <a
              href={invoice.paid_btn_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 rounded-xl font-bold text-white text-center"
              style={{ background: t.accent2 }}
            >
              {invoice.paid_btn_name === 'viewItem' && 'View Item'}
              {invoice.paid_btn_name === 'openChannel' && 'View Channel'}
              {invoice.paid_btn_name === 'openBot' && 'Open Bot'}
              {invoice.paid_btn_name === 'callback' && 'Return'}
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
