from __future__ import annotations

import argparse
import os

from .gateway import main as gateway_main
from .node import main as node_main
from .client import main as client_main
from .reward_minter import RewardMinter
from .ledger import Ledger


def main():
    parser = argparse.ArgumentParser(prog="glyph", description="Glyph: Decentralized AI Network with ERC20 Rewards")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # Gateway command
    g = sub.add_parser("gateway", help="Run the Glyph gateway server")
    g.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    g.add_argument("--port", type=int, default=8080, help="Port to bind to")
    g.add_argument("--identity", default=None, help="Path to persist gateway identity (ed25519 secret in base64)")
    g.add_argument(
        "--dht-peer",
        action="append",
        default=None,
        help="Hivemind DHT initial peer multiaddr (can be specified multiple times)",
    )

    # Node command
    n = sub.add_parser("node", help="Run a Glyph compute node")
    n.add_argument("--model", required=True, help="Path to model or HuggingFace model ID")
    n.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    n.add_argument("--port", type=int, default=8090, help="Port to bind to")
    n.add_argument("--gateway", default=None, help="Gateway URL to register with")
    n.add_argument("--public-name", default=None, help="Public name for this node")
    n.add_argument("--identity", default=None, help="Path to persist node identity (ed25519 secret in base64)")
    n.add_argument(
        "--dht-peer",
        action="append",
        default=None,
        help="Hivemind DHT initial peer multiaddr (can be specified multiple times)",
    )

    # Client command
    c = sub.add_parser("client", help="Send a prompt to the gateway")
    c.add_argument("--gateway", required=True, help="Gateway URL")
    c.add_argument("--prompt", required=True, help="Prompt to send")

    # Minter command (ERC20)
    m = sub.add_parser("minter", help="Mint ERC20 rewards for an epoch")
    m.add_argument("--epoch-id", required=True, help="Epoch ID to mint rewards for")
    m.add_argument("--dry-run", action="store_true", help="Preview without executing")
    m.add_argument("--private-key", default=None, help="Private key for signing (or use GLYPH_MINTER_PRIVATE_KEY env)")

    # Configure token command
    tc = sub.add_parser("configure-token", help="Configure ERC20 token contract")
    tc.add_argument("--address", required=True, help="Token contract address (0x...)")
    tc.add_argument("--network", default="polygon", help="Network: polygon, base, arbitrum, ethereum")
    tc.add_argument("--rpc-url", default=None, help="Custom RPC URL (optional)")

    # Telegram bot command
    tb = sub.add_parser("bot-telegram", help="Run Telegram bot")
    tb.add_argument("--token", default=None, help="Telegram bot token (or use TELEGRAM_BOT_TOKEN env)")
    tb.add_argument("--gateway", default="http://localhost:8080", help="Gateway URL")

    # Signal bot command
    sb = sub.add_parser("bot-signal", help="Run Signal bot")
    sb.add_argument("--number", default=None, help="Signal phone number (or use SIGNAL_NUMBER env)")
    sb.add_argument("--gateway", default="http://localhost:8080", help="Gateway URL")
    sb.add_argument("--api-url", default="http://localhost:8080", help="signal-cli-rest-api URL")

    # WhatsApp bot command
    wb = sub.add_parser("bot-whatsapp", help="Run WhatsApp bot")
    wb.add_argument("--gateway", default="http://localhost:8080", help="Gateway URL")
    wb.add_argument("--api-url", default="http://localhost:3000", help="WhatsApp API URL")

    args = parser.parse_args()

    if args.cmd == "gateway":
        gateway_main(host=args.host, port=args.port, identity_path=args.identity, dht_peer=args.dht_peer)
    
    elif args.cmd == "node":
        node_main(
            model=args.model,
            host=args.host,
            port=args.port,
            gateway=args.gateway,
            public_name=args.public_name,
            identity=args.identity,
            dht_peer=args.dht_peer,
        )
    
    elif args.cmd == "client":
        client_main(["--gateway", args.gateway, "--prompt", args.prompt])
    
    elif args.cmd == "minter":
        # ERC20 minting
        minter = RewardMinter(private_key=args.private_key)
        try:
            tx_hash = minter.mint_rewards(args.epoch_id, dry_run=args.dry_run)
            if args.dry_run:
                print(f"Dry run result: {tx_hash}")
            else:
                print(f"✅ Rewards minted successfully!")
                print(f"Transaction hash: {tx_hash}")
        except Exception as e:
            print(f"❌ Error: {e}")
            exit(1)
    
    elif args.cmd == "configure-token":
        # Configure token contract
        ledger = Ledger()
        try:
            ledger.set_token_address(args.address)
            ledger.set_token_network(args.network)
            if args.rpc_url:
                ledger.set_rpc_url(args.rpc_url)
            print(f"✅ Token configuration saved:")
            print(f"  Address: {args.address}")
            print(f"  Network: {args.network}")
            if args.rpc_url:
                print(f"  RPC URL: {args.rpc_url}")
        except Exception as e:
            print(f"❌ Error: {e}")
            exit(1)
    
    elif args.cmd == "bot-telegram":
        # Run Telegram bot
        try:
            from .bot_telegram import main as telegram_main
            telegram_main(bot_token=args.token, gateway_url=args.gateway)
        except ImportError:
            print("❌ Telegram bot dependencies not installed.")
            print("Install with: pip install glyph[bots]")
            exit(1)
    
    elif args.cmd == "bot-signal":
        # Run Signal bot
        try:
            from .bot_signal import main as signal_main
            signal_main(
                signal_number=args.number,
                gateway_url=args.gateway,
                signal_api_url=args.api_url
            )
        except ImportError:
            print("❌ Signal bot dependencies not installed.")
            print("Install with: pip install glyph[bots]")
            exit(1)
    
    elif args.cmd == "bot-whatsapp":
        # Run WhatsApp bot
        try:
            from .bot_whatsapp import main as whatsapp_main
            whatsapp_main(
                gateway_url=args.gateway,
                whatsapp_api_url=args.api_url
            )
        except ImportError:
            print("❌ WhatsApp bot dependencies not installed.")
            print("Install with: pip install glyph[bots]")
            exit(1)


if __name__ == "__main__":
    main()


