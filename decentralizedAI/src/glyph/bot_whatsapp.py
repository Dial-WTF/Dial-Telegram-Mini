from __future__ import annotations

"""
WhatsApp Bot Interface for Glyph
---------------------------------
Provides a WhatsApp frontend for the Glyph decentralized AI network.

REQUIREMENTS:
Option 1 (Recommended for Production):
- WhatsApp Business API account
- Official Meta Cloud API or On-Premises API

Option 2 (For Testing Only - Against WhatsApp ToS):
- whatsapp-web.js Node.js library
- QR code scanning for authentication

This implementation uses a REST API wrapper around whatsapp-web.js for simplicity.
For production, migrate to official WhatsApp Business API.
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


class WhatsAppBot:
    def __init__(
        self,
        gateway_url: str,
        whatsapp_api_url: str = "http://localhost:3000",
        max_tokens: int = 256,
        temperature: float = 0.7,
        poll_interval: int = 2,
    ):
        """
        Initialize WhatsApp bot.
        
        Args:
            gateway_url: Glyph gateway URL
            whatsapp_api_url: WhatsApp API wrapper URL
            max_tokens: Max tokens for AI generation
            temperature: Temperature for AI generation
            poll_interval: Seconds between polling for new messages
        """
        self.gateway_url = gateway_url.rstrip("/")
        self.whatsapp_api_url = whatsapp_api_url.rstrip("/")
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.poll_interval = poll_interval
        
        # User session storage
        self.user_pubkeys = {}  # whatsapp_id -> pubkey
        self.processed_messages = set()  # Track processed message IDs
    
    def _get_or_create_user_pubkey(self, user_id: str) -> str:
        """Get or create a pubkey for a WhatsApp user."""
        if user_id not in self.user_pubkeys:
            pubkey, _ = generate_identity()
            self.user_pubkeys[user_id] = pubkey
        return self.user_pubkeys[user_id]
    
    async def send_message(self, chat_id: str, message: str):
        """Send a WhatsApp message."""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # Split long messages (WhatsApp has a ~4096 char limit)
                if len(message) > 4000:
                    chunks = [message[i:i+4000] for i in range(0, len(message), 4000)]
                    for chunk in chunks:
                        await client.post(
                            f"{self.whatsapp_api_url}/sendMessage",
                            json={
                                "chatId": chat_id,
                                "message": chunk
                            }
                        )
                        await asyncio.sleep(0.5)
                else:
                    await client.post(
                        f"{self.whatsapp_api_url}/sendMessage",
                        json={
                            "chatId": chat_id,
                            "message": message
                        }
                    )
        except Exception as e:
            logger.error(f"Error sending WhatsApp message: {e}")
    
    async def handle_command(self, chat_id: str, command: str, args: list):
        """Handle bot commands."""
        command = command.lower()
        
        if command == "start" or command == "help":
            await self.send_message(
                chat_id,
                "👋 *Welcome to Glyph AI Network!*\n\n"
                "*Commands:*\n"
                "/help - Show this message\n"
                "/register <eth_address> - Register for rewards\n"
                "/stats - View your stats\n"
                "/balance - Check token balance\n\n"
                "Just send any message to chat with the AI!"
            )
        
        elif command == "register":
            if not args:
                await self.send_message(
                    chat_id,
                    "⚠️ Please provide your Ethereum address.\n\n"
                    "Usage: /register 0xYourEthereumAddress"
                )
                return
            
            eth_address = args[0]
            
            if not eth_address.startswith("0x") or len(eth_address) != 42:
                await self.send_message(
                    chat_id,
                    "❌ Invalid Ethereum address format."
                )
                return
            
            user_pubkey = self._get_or_create_user_pubkey(chat_id)
            
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
                            chat_id,
                            f"✅ *Registration successful!*\n\n"
                            f"Address: {eth_address}\n\n"
                            f"You'll receive GLYPH tokens as rewards!"
                        )
                    else:
                        await self.send_message(chat_id, f"❌ Registration failed")
            except Exception as e:
                logger.error(f"Error registering: {e}")
                await self.send_message(chat_id, "❌ Network error")
        
        elif command == "stats":
            user_pubkey = self._get_or_create_user_pubkey(chat_id)
            await self.send_message(
                chat_id,
                f"📊 *Your Stats*\n\n"
                f"User ID: {user_pubkey[:16]}...\n\n"
                f"Use /register to set your Ethereum address!"
            )
        
        elif command == "balance":
            await self.send_message(
                chat_id,
                "💰 Token balance check coming soon!"
            )
        
        else:
            await self.send_message(
                chat_id,
                f"❓ Unknown command: /{command}\n\nUse /help for available commands."
            )
    
    async def handle_message(self, chat_id: str, message: str):
        """Handle incoming messages."""
        # Check if it's a command
        if message.startswith("/"):
            parts = message[1:].split()
            command = parts[0] if parts else ""
            args = parts[1:] if len(parts) > 1 else []
            await self.handle_command(chat_id, command, args)
            return
        
        # Process as AI prompt
        user_pubkey = self._get_or_create_user_pubkey(chat_id)
        
        # Send typing indicator (if supported by API)
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    f"{self.whatsapp_api_url}/sendSeen",
                    json={"chatId": chat_id}
                )
        except:
            pass
        
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
                    await self.send_message(chat_id, ai_response)
                elif response.status_code == 402:
                    await self.send_message(
                        chat_id,
                        "❌ Insufficient GLYPH balance."
                    )
                else:
                    await self.send_message(chat_id, "❌ Error processing request")
        
        except httpx.TimeoutException:
            await self.send_message(chat_id, "⏱️ Request timed out. Please try again.")
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            await self.send_message(chat_id, "❌ An error occurred")
    
    async def poll_messages(self):
        """Poll for new WhatsApp messages."""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(
                    f"{self.whatsapp_api_url}/getMessages"
                )
                
                if response.status_code == 200:
                    messages = response.json()
                    
                    for msg in messages:
                        msg_id = msg.get("id", {}).get("id")
                        
                        # Skip already processed messages
                        if msg_id in self.processed_messages:
                            continue
                        
                        self.processed_messages.add(msg_id)
                        
                        # Clean up old processed messages (keep last 1000)
                        if len(self.processed_messages) > 1000:
                            oldest = list(self.processed_messages)[:500]
                            self.processed_messages -= set(oldest)
                        
                        chat_id = msg.get("from")
                        text = msg.get("body", "")
                        is_from_me = msg.get("fromMe", False)
                        
                        # Skip messages from bot itself
                        if is_from_me:
                            continue
                        
                        if chat_id and text:
                            logger.info(f"Received message from {chat_id}: {text[:50]}...")
                            await self.handle_message(chat_id, text)
        
        except Exception as e:
            logger.error(f"Error polling messages: {e}")
    
    async def run(self):
        """Run the WhatsApp bot."""
        logger.info(f"Starting WhatsApp bot")
        logger.info(f"Connected to gateway: {self.gateway_url}")
        logger.info(f"WhatsApp API: {self.whatsapp_api_url}")
        
        # Test connection
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(f"{self.whatsapp_api_url}/status")
                if response.status_code != 200:
                    logger.warning("WhatsApp API may not be ready")
        except Exception as e:
            logger.error(f"WhatsApp API not reachable: {e}")
            logger.error("Make sure whatsapp-web.js API is running and authenticated")
            logger.info("You may need to scan a QR code to authenticate")
        
        logger.info("WhatsApp bot started. Polling for messages...")
        
        while True:
            try:
                await self.poll_messages()
                await asyncio.sleep(self.poll_interval)
            except KeyboardInterrupt:
                logger.info("Shutting down WhatsApp bot...")
                break
            except Exception as e:
                logger.error(f"Error in main loop: {e}")
                await asyncio.sleep(self.poll_interval)


def main(
    gateway_url: Optional[str] = None,
    whatsapp_api_url: Optional[str] = None,
):
    """Main entry point for the WhatsApp bot."""
    gateway_url = gateway_url or os.getenv("GLYPH_GATEWAY_URL", "http://localhost:8080")
    whatsapp_api_url = whatsapp_api_url or os.getenv("WHATSAPP_API_URL", "http://localhost:3000")
    
    bot = WhatsAppBot(
        gateway_url=gateway_url,
        whatsapp_api_url=whatsapp_api_url
    )
    
    asyncio.run(bot.run())


if __name__ == "__main__":
    main()
