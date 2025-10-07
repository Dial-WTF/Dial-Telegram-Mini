from __future__ import annotations

"""
Reward Minter Service for GLYPH
--------------------------------
Builds and broadcasts ERC20 token mint transactions for the GLYPH token
based on finalized epoch snapshots produced by the gateway.

This module handles Web3 interactions with the GLYPH ERC20 token contract.
It expects:
- A configured GLYPH token contract address stored in the ledger settings
- A blockchain network (polygon, base, arbitrum, ethereum)
- An RPC URL for the network
- A private key for signing transactions (from environment or secure storage)
"""

import json
import os
from dataclasses import dataclass
from typing import List, Optional
from decimal import Decimal

from .ledger import Ledger


@dataclass
class Payout:
    eth_address: str
    amount: int  # Amount in wei (smallest unit)


class RewardMinter:
    def __init__(
        self, 
        ledger: Optional[Ledger] = None,
        private_key: Optional[str] = None,
        gas_limit: int = 300000,
        max_batch_size: int = 100
    ) -> None:
        self.ledger = ledger or Ledger()
        self.private_key = private_key or os.getenv("GLYPH_MINTER_PRIVATE_KEY")
        self.gas_limit = gas_limit
        self.max_batch_size = max_batch_size
        self._w3 = None
        self._contract = None

    def _get_web3(self):
        """Lazy initialization of Web3 instance."""
        if self._w3 is None:
            try:
                from web3 import Web3
            except ImportError:
                raise RuntimeError(
                    "web3 package not installed. Run: pip install web3"
                )
            
            rpc_url = self.ledger.get_rpc_url()
            if not rpc_url:
                # Default RPC URLs
                network = self.ledger.get_token_network()
                rpc_urls = {
                    "polygon": "https://polygon-rpc.com",
                    "mumbai": "https://rpc-mumbai.maticvigil.com",
                    "base": "https://mainnet.base.org",
                    "base-sepolia": "https://sepolia.base.org",
                    "arbitrum": "https://arb1.arbitrum.io/rpc",
                    "arbitrum-sepolia": "https://sepolia-rollup.arbitrum.io/rpc",
                    "ethereum": "https://eth.public-rpc.com",
                }
                rpc_url = rpc_urls.get(network)
                if not rpc_url:
                    raise RuntimeError(
                        f"No RPC URL configured for network {network}. "
                        "Set via ledger.set_rpc_url() or use a supported network."
                    )
            
            self._w3 = Web3(Web3.HTTPProvider(rpc_url))
            if not self._w3.is_connected():
                raise RuntimeError(f"Failed to connect to blockchain network at {rpc_url}")
        
        return self._w3

    def _get_contract(self):
        """Lazy initialization of contract instance."""
        if self._contract is None:
            w3 = self._get_web3()
            token_address = self.ledger.get_token_address()
            if not token_address:
                raise RuntimeError(
                    "Token contract address not configured. "
                    "Set via ledger.set_token_address('0x...')"
                )
            
            # Load contract ABI from the compiled contract
            abi = self._get_token_abi()
            self._contract = w3.eth.contract(
                address=w3.to_checksum_address(token_address),
                abi=abi
            )
        
        return self._contract

    def _get_token_abi(self) -> list:
        """Get the GLYPH token contract ABI."""
        # Minimal ABI for the functions we need
        return [
            {
                "inputs": [
                    {"name": "to", "type": "address"},
                    {"name": "amount", "type": "uint256"},
                    {"name": "epochId", "type": "string"}
                ],
                "name": "mintReward",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [
                    {"name": "recipients", "type": "address[]"},
                    {"name": "amounts", "type": "uint256[]"},
                    {"name": "epochId", "type": "string"}
                ],
                "name": "batchMintRewards",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "totalSupply",
                "outputs": [{"name": "", "type": "uint256"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "MAX_SUPPLY",
                "outputs": [{"name": "", "type": "uint256"}],
                "stateMutability": "view",
                "type": "function"
            }
        ]

    def get_config(self) -> dict:
        """Get current configuration."""
        token_address = self.ledger.get_token_address()
        if not token_address:
            raise RuntimeError(
                "Token contract address not configured. "
                "Set via ledger.set_token_address('0x...')"
            )
        network = self.ledger.get_token_network()
        rpc_url = self.ledger.get_rpc_url()
        
        return {
            "token_address": token_address,
            "network": network,
            "rpc_url": rpc_url or "default",
        }

    def select_epoch_payouts(self, epoch_id: str) -> List[Payout]:
        """Extract payouts from epoch snapshot."""
        snap = self.ledger.get_epoch(epoch_id)
        if not snap:
            raise RuntimeError("epoch not found")
        
        payouts = []
        for p in snap.get("payouts", []):
            addr = p.get("eth_address")
            amt = int(p.get("amount", 0))
            if addr and amt > 0:
                payouts.append(Payout(eth_address=addr, amount=amt))
        
        if not payouts:
            raise RuntimeError("no payouts to process")
        
        return payouts

    def mint_rewards(self, epoch_id: str, dry_run: bool = False) -> str:
        """
        Mint rewards for an epoch.
        
        Args:
            epoch_id: The epoch identifier
            dry_run: If True, only simulate the transaction
            
        Returns:
            Transaction hash if successful
        """
        if not self.private_key:
            raise RuntimeError(
                "No private key configured. Set GLYPH_MINTER_PRIVATE_KEY environment variable "
                "or pass private_key to RewardMinter constructor."
            )
        
        w3 = self._get_web3()
        contract = self._get_contract()
        account = w3.eth.account.from_key(self.private_key)
        
        payouts = self.select_epoch_payouts(epoch_id)
        
        # Split into batches if needed
        if len(payouts) > self.max_batch_size:
            return self._mint_rewards_batched(epoch_id, payouts, account, dry_run)
        
        # Prepare transaction
        recipients = [w3.to_checksum_address(p.eth_address) for p in payouts]
        amounts = [p.amount for p in payouts]
        
        # Build transaction
        tx = contract.functions.batchMintRewards(
            recipients,
            amounts,
            epoch_id
        ).build_transaction({
            'from': account.address,
            'nonce': w3.eth.get_transaction_count(account.address),
            'gas': self.gas_limit * len(payouts),  # Scale gas with batch size
            'maxFeePerGas': w3.eth.gas_price * 2,  # 2x current gas price for faster confirmation
            'maxPriorityFeePerGas': w3.to_wei(2, 'gwei'),
        })
        
        if dry_run:
            # Estimate gas
            estimated_gas = w3.eth.estimate_gas(tx)
            return f"DRY_RUN: Would use {estimated_gas} gas for {len(payouts)} recipients"
        
        # Sign and send transaction
        signed_tx = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
        tx_hash_hex = tx_hash.hex()
        
        # Wait for confirmation (optional, can be async)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
        
        if receipt.status == 1:
            # Success - anchor the epoch
            self.anchor_epoch(epoch_id, tx_hash_hex)
            return tx_hash_hex
        else:
            raise RuntimeError(f"Transaction failed: {tx_hash_hex}")

    def _mint_rewards_batched(
        self, 
        epoch_id: str, 
        payouts: List[Payout], 
        account, 
        dry_run: bool
    ) -> str:
        """Handle large payout lists by splitting into multiple transactions."""
        w3 = self._get_web3()
        tx_hashes = []
        
        for i in range(0, len(payouts), self.max_batch_size):
            batch = payouts[i:i + self.max_batch_size]
            batch_epoch_id = f"{epoch_id}_batch_{i // self.max_batch_size}"
            
            # Temporarily create a sub-epoch for this batch
            # (In production, you'd handle this differently)
            recipients = [w3.to_checksum_address(p.eth_address) for p in batch]
            amounts = [p.amount for p in batch]
            
            contract = self._get_contract()
            tx = contract.functions.batchMintRewards(
                recipients,
                amounts,
                batch_epoch_id
            ).build_transaction({
                'from': account.address,
                'nonce': w3.eth.get_transaction_count(account.address) + len(tx_hashes),
                'gas': self.gas_limit * len(batch),
                'maxFeePerGas': w3.eth.gas_price * 2,
                'maxPriorityFeePerGas': w3.to_wei(2, 'gwei'),
            })
            
            if not dry_run:
                signed_tx = account.sign_transaction(tx)
                tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
                tx_hashes.append(tx_hash.hex())
        
        if dry_run:
            return f"DRY_RUN: Would send {len(tx_hashes)} transactions"
        
        # Return the first tx hash (main one)
        if tx_hashes:
            self.anchor_epoch(epoch_id, tx_hashes[0])
            return tx_hashes[0]
        
        raise RuntimeError("No transactions sent")

    def get_token_supply(self) -> dict:
        """Get current and max token supply."""
        contract = self._get_contract()
        total_supply = contract.functions.totalSupply().call()
        max_supply = contract.functions.MAX_SUPPLY().call()
        
        return {
            "total_supply": total_supply,
            "total_supply_tokens": total_supply / 10**18,
            "max_supply": max_supply,
            "max_supply_tokens": max_supply / 10**18,
            "remaining": max_supply - total_supply,
            "remaining_tokens": (max_supply - total_supply) / 10**18,
        }

    def anchor_epoch(self, epoch_id: str, txid: str) -> None:
        """Record the transaction hash that minted rewards for an epoch."""
        self.ledger.set_epoch_anchor(epoch_id, txid)
        self.ledger.set_epoch_finalized(epoch_id)


