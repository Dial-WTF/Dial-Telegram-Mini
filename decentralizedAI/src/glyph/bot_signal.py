from __future__ import annotations

"""
Signal Bot Interface for Glyph
-------------------------------
Provides a Signal messenger frontend for the Glyph decentralized AI network.

REQUIREMENTS:
- signal-cli installed and configured (https://github.com/AsamK/signal-cli)
- signal-cli-rest-api Docker container running (recommended)
  OR signal-cli daemon mode

This implementation uses the signal-cli-rest-api HTTP interface.
Alternative: Use signal-cli directly via subprocess (more complex).
"""

import os
import logging
import asyncio
from typing import Optional
import httpx

from .crypto import generate_identity

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)


class SignalBot:
    def __init__(
        self,
        signal_number: str,
        gateway_url: str,
        signal_api_url: str = "http://localhost:8080",
        max_tokens: int = 256,
        temperature: float = 0.7,
        poll_interval: int = 2,
    ):
        """
        Initialize Signal bot.
        
        Args:
            signal_number: Your Signal phone number (e.g., +1234567890)
            gateway_url: Glyph gateway URL
            signal_api_url: signal-cli-rest-api URL
            max_tokens: Max tokens for AI generation
            temperature: Temperature for AI generation
            poll_interval: Seconds between polling for new messages
        """
        self.signal_number = signal_number
        self.gateway_url = gateway_url.rstrip("/")
        self.signal_api_url = signal_api_url.rstrip("/")
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.poll_interval = poll_interval
        
        # User session storage
        self.user_pubkeys = {}  # signal_number -> pubkey
        self.last_message_timestamp = 0
    
    def _get_or_create_user_pubkey(self, user_number: str) -> str:
        """Get or create a pubkey for a Signal user."""
        if user_number not in self.user_pubkeys:
            pubkey, _ = generate_identity()
            self.user_pubkeys[user_number] = pubkey
        return self.user_pubkeys[user_number]
    
    async def send_message(self, recipient: str, message: str):
        """Send a Signal message."""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # Split long messages
                if len(message) > 2000:
                    chunks = [message[i:i+2000] for i in range(0, len(message), 2000)]
                    for chunk in chunks:
                        await client.post(
                            f"{self.signal_api_url}/v2/send",
                            json={
                                "number": self.signal_number,
                                "recipients": [recipient],
                                "message": chunk
                            }
                        )
                        await asyncio.sleep(0.5)
                else:
                    await client.post(
                        f"{self.signal_api_url}/v2/send",
                        json={
                            "number": self.signal_number,
                            "recipients": [recipient],
                            "message": message
                        }
                    )
        except Exception as e:
            logger.error(f"Error sending Signal message: {e}")
    
    async def handle_command(self, sender: str, command: str, args: list):
        """Handle bot commands."""
        command = command.lower()
        
        if command == "start" or command == "help":
            await self.send_message(
                sender,
                "👋 Welcome to Glyph AI Network!\n\n"
                "Commands:\n"
                "/help - Show this message\n"
                "/register <eth_address> - Register for rewards\n"
                "/stats - View your stats\n"
                "/balance - Check token balance\n\n"
                "Just send any message to chat with the AI!"
            )
        
        elif command == "register":
            if not args:
                await self.send_message(
                    sender,
                    "⚠️ Please provide your Ethereum address.\n\n"
                    "Usage: /register 0xYourEthereumAddress"
                )
                return
            
            eth_address = args[0]
            
            if not eth_address.startswith("0x") or len(eth_address) != 42:
                await self.send_message(
                    sender,
                    "❌ Invalid Ethereum address format."
                )
                return
            
            user_pubkey = self._get_or_create_user_pubkey(sender)
            
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    response = await client.post(
                        f"{self.gateway_url}/set_eth_address",
                        json={
                            "node_pubkey": user_pubkey,
                            "eth_address": eth_address
                        }
                    )
                    
                    if response.status_code == 200:
                        await self.send_message(
                            sender,
                            f"✅ Registration successful!\n\n"
                            f"Address: {eth_address}\n\n"
                            f"You'll receive GLYPH tokens as rewards!"
                        )
                    else:
                        await self.send_message(sender, f"❌ Registration failed")
            except Exception as e:
                logger.error(f"Error registering: {e}")
                await self.send_message(sender, "❌ Network error")
        
        elif command == "stats":
            user_pubkey = self._get_or_create_user_pubkey(sender)
            await self.send_message(
                sender,
                f"📊 Your Stats\n\n"
                f"User ID: {user_pubkey[:16]}...\n\n"
                f"Use /register to set your Ethereum address!"
            )
        
        elif command == "balance":
            await self.send_message(
                sender,
                "💰 Token balance check coming soon!"
            )
        
        else:
            await self.send_message(
                sender,
                f"❓ Unknown command: /{command}\n\nUse /help for available commands."
            )
    
    async def handle_message(self, sender: str, message: str):
        """Handle incoming messages."""
        # Check if it's a command
        if message.startswith("/"):
            parts = message[1:].split()
            command = parts[0] if parts else ""
            args = parts[1:] if len(parts) > 1 else []
            await self.handle_command(sender, command, args)
            return
        
        # Process as AI prompt
        user_pubkey = self._get_or_create_user_pubkey(sender)
        
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                response = await client.post(
                    f"{self.gateway_url}/inference",
                    json={
                        "prompt": message,
                        "max_new_tokens": self.max_tokens,
                        "temperature": self.temperature,
                        "user_pubkey": user_pubkey
                    }
                )
                
                if response.status_code == 200:
                    result = response.json()
                    ai_response = result.get("text", "")
                    await self.send_message(sender, ai_response)
                elif response.status_code == 402:
                    await self.send_message(
                        sender,
                        "❌ Insufficient GLYPH balance."
                    )
                else:
                    await self.send_message(sender, "❌ Error processing request")
        
        except httpx.TimeoutException:
            await self.send_message(sender, "⏱️ Request timed out. Please try again.")
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            await self.send_message(sender, "❌ An error occurred")
    
    async def poll_messages(self):
        """Poll for new Signal messages."""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(
                    f"{self.signal_api_url}/v1/receive/{self.signal_number}"
                )
                
                if response.status_code == 200:
                    messages = response.json()
                    
                    for msg in messages:
                        envelope = msg.get("envelope", {})
                        source = envelope.get("source") or envelope.get("sourceNumber")
                        data_message = envelope.get("dataMessage", {})
                        text = data_message.get("message", "")
                        timestamp = envelope.get("timestamp", 0)
                        
                        # Skip old messages
                        if timestamp <= self.last_message_timestamp:
                            continue
                        
                        self.last_message_timestamp = max(self.last_message_timestamp, timestamp)
                        
                        if source and text:
                            logger.info(f"Received message from {source}: {text[:50]}...")
                            await self.handle_message(source, text)
        
        except Exception as e:
            logger.error(f"Error polling messages: {e}")
    
    async def run(self):
        """Run the Signal bot."""
        logger.info(f"Starting Signal bot for number {self.signal_number}")
        logger.info(f"Connected to gateway: {self.gateway_url}")
        logger.info(f"Signal API: {self.signal_api_url}")
        
        # Test connection
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(f"{self.signal_api_url}/v1/about")
                if response.status_code != 200:
                    logger.error("Failed to connect to signal-cli-rest-api")
                    return
        except Exception as e:
            logger.error(f"signal-cli-rest-api not reachable: {e}")
            logger.error("Make sure signal-cli-rest-api is running")
            return
        
        logger.info("Signal bot started. Polling for messages...")
        
        while True:
            try:
                await self.poll_messages()
                await asyncio.sleep(self.poll_interval)
            except KeyboardInterrupt:
                logger.info("Shutting down Signal bot...")
                break
            except Exception as e:
                logger.error(f"Error in main loop: {e}")
                await asyncio.sleep(self.poll_interval)


def main(
    signal_number: Optional[str] = None,
    gateway_url: Optional[str] = None,
    signal_api_url: Optional[str] = None,
):
    """Main entry point for the Signal bot."""
    signal_number = signal_number or os.getenv("SIGNAL_NUMBER")
    gateway_url = gateway_url or os.getenv("GLYPH_GATEWAY_URL", "http://localhost:8080")
    signal_api_url = signal_api_url or os.getenv("SIGNAL_API_URL", "http://localhost:8080")
    
    if not signal_number:
        raise ValueError(
            "SIGNAL_NUMBER environment variable not set. "
            "Use your registered Signal phone number (e.g., +1234567890)"
        )
    
    bot = SignalBot(
        signal_number=signal_number,
        gateway_url=gateway_url,
        signal_api_url=signal_api_url
    )
    
    asyncio.run(bot.run())


if __name__ == "__main__":
    main()
