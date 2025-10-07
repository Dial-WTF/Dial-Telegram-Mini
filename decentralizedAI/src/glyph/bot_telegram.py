from __future__ import annotations

"""
Telegram Bot Interface for Glyph
---------------------------------
Provides a Telegram bot frontend for the Glyph decentralized AI network.

Users can:
- Send prompts directly via Telegram
- Register their Ethereum address for rewards
- Check their contribution stats
- View token balance (if enabled)
"""

import os
import logging
from typing import Optional
import httpx
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

from .crypto import generate_identity

# Enable logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)


class TelegramBot:
    def __init__(
        self,
        bot_token: str,
        gateway_url: str,
        max_tokens: int = 256,
        temperature: float = 0.7,
    ):
        self.bot_token = bot_token
        self.gateway_url = gateway_url.rstrip("/")
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.app = None
        
        # User session storage (in production, use Redis or database)
        self.user_pubkeys = {}  # telegram_user_id -> pubkey
        self.user_contexts = {}  # telegram_user_id -> conversation context
    
    def _get_or_create_user_pubkey(self, user_id: int) -> str:
        """Get or create a pubkey for a Telegram user."""
        if user_id not in self.user_pubkeys:
            pubkey, _ = generate_identity()
            self.user_pubkeys[user_id] = pubkey
        return self.user_pubkeys[user_id]
    
    async def start_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /start command."""
        user = update.effective_user
        await update.message.reply_html(
            f"👋 Welcome to <b>Glyph AI Network</b>, {user.mention_html()}!\n\n"
            f"I'm your gateway to decentralized AI powered by distributed compute.\n\n"
            f"<b>Commands:</b>\n"
            f"/help - Show available commands\n"
            f"/register - Register your Ethereum address for rewards\n"
            f"/stats - View your usage statistics\n"
            f"/balance - Check your GLYPH token balance\n\n"
            f"Just send me any message and I'll process it using the Glyph network!"
        )
    
    async def help_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /help command."""
        await update.message.reply_html(
            f"<b>Glyph AI Network Bot</b>\n\n"
            f"<b>Available Commands:</b>\n"
            f"/start - Welcome message\n"
            f"/help - Show this help message\n"
            f"/register [eth_address] - Register Ethereum address\n"
            f"/stats - View your contribution stats\n"
            f"/balance - Check GLYPH token balance\n"
            f"/clear - Clear conversation context\n\n"
            f"<b>Usage:</b>\n"
            f"Simply send any text message and I'll respond using the decentralized AI network.\n\n"
            f"<b>Examples:</b>\n"
            f"• Explain quantum computing\n"
            f"• Write a haiku about AI\n"
            f"• What is the meaning of life?"
        )
    
    async def register_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /register command to set Ethereum address."""
        user_id = update.effective_user.id
        
        if not context.args or len(context.args) == 0:
            await update.message.reply_text(
                "⚠️ Please provide your Ethereum address.\n\n"
                "Usage: /register 0xYourEthereumAddress"
            )
            return
        
        eth_address = context.args[0]
        
        # Basic validation
        if not eth_address.startswith("0x") or len(eth_address) != 42:
            await update.message.reply_text(
                "❌ Invalid Ethereum address format.\n"
                "Address must start with 0x and be 42 characters long."
            )
            return
        
        user_pubkey = self._get_or_create_user_pubkey(user_id)
        
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
                    await update.message.reply_html(
                        f"✅ <b>Registration successful!</b>\n\n"
                        f"Your Ethereum address has been registered:\n"
                        f"<code>{eth_address}</code>\n\n"
                        f"You'll receive GLYPH tokens as rewards for using the network!"
                    )
                else:
                    await update.message.reply_text(
                        f"❌ Registration failed: {response.text}"
                    )
        except Exception as e:
            logger.error(f"Error registering address: {e}")
            await update.message.reply_text(
                "❌ Error connecting to the network. Please try again later."
            )
    
    async def stats_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /stats command."""
        user_id = update.effective_user.id
        user_pubkey = self._get_or_create_user_pubkey(user_id)
        
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # Get node info (user acts as a contributor)
                response = await client.get(f"{self.gateway_url}/nodes")
                
                if response.status_code == 200:
                    nodes = response.json()
                    user_node = next((n for n in nodes if n["pubkey"] == user_pubkey), None)
                    
                    if user_node:
                        has_eth = user_node.get("has_eth_address", False)
                        eth_addr = user_node.get("eth_address", "Not set")
                        
                        await update.message.reply_html(
                            f"📊 <b>Your Statistics</b>\n\n"
                            f"User ID: <code>{user_pubkey[:16]}...</code>\n"
                            f"ETH Address: {'✅' if has_eth else '❌'} <code>{eth_addr}</code>\n\n"
                            f"Use the network to earn GLYPH tokens!"
                        )
                    else:
                        await update.message.reply_text(
                            "📊 No statistics available yet.\n"
                            "Start using the bot to generate stats!"
                        )
                else:
                    await update.message.reply_text("❌ Unable to fetch stats.")
        except Exception as e:
            logger.error(f"Error fetching stats: {e}")
            await update.message.reply_text("❌ Error connecting to the network.")
    
    async def balance_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /balance command."""
        await update.message.reply_text(
            "💰 Token balance check coming soon!\n\n"
            "This feature will show your GLYPH token balance once the ERC20 contract is deployed."
        )
    
    async def clear_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /clear command to reset conversation context."""
        user_id = update.effective_user.id
        if user_id in self.user_contexts:
            del self.user_contexts[user_id]
        await update.message.reply_text("🔄 Conversation context cleared!")
    
    async def handle_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle regular text messages."""
        user_id = update.effective_user.id
        user_pubkey = self._get_or_create_user_pubkey(user_id)
        prompt = update.message.text
        
        # Show typing indicator
        await update.message.chat.send_action("typing")
        
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                response = await client.post(
                    f"{self.gateway_url}/inference",
                    json={
                        "prompt": prompt,
                        "max_new_tokens": self.max_tokens,
                        "temperature": self.temperature,
                        "user_pubkey": user_pubkey
                    }
                )
                
                if response.status_code == 200:
                    result = response.json()
                    ai_response = result.get("text", "")
                    
                    # Send response (split if too long)
                    if len(ai_response) > 4096:
                        # Telegram message limit is 4096 characters
                        for i in range(0, len(ai_response), 4096):
                            await update.message.reply_text(ai_response[i:i+4096])
                    else:
                        await update.message.reply_text(ai_response)
                    
                elif response.status_code == 402:
                    await update.message.reply_text(
                        "❌ Insufficient GLYPH balance.\n"
                        "Please top up your account to continue using the network."
                    )
                else:
                    await update.message.reply_text(
                        f"❌ Error: {response.text}"
                    )
        
        except httpx.TimeoutException:
            await update.message.reply_text(
                "⏱️ Request timed out. The network might be busy. Please try again."
            )
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            await update.message.reply_text(
                "❌ An error occurred while processing your request. Please try again later."
            )
    
    async def error_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle errors."""
        logger.error(f"Update {update} caused error {context.error}")
    
    def build_application(self) -> Application:
        """Build the Telegram bot application."""
        application = Application.builder().token(self.bot_token).build()
        
        # Command handlers
        application.add_handler(CommandHandler("start", self.start_command))
        application.add_handler(CommandHandler("help", self.help_command))
        application.add_handler(CommandHandler("register", self.register_command))
        application.add_handler(CommandHandler("stats", self.stats_command))
        application.add_handler(CommandHandler("balance", self.balance_command))
        application.add_handler(CommandHandler("clear", self.clear_command))
        
        # Message handler
        application.add_handler(
            MessageHandler(filters.TEXT & ~filters.COMMAND, self.handle_message)
        )
        
        # Error handler
        application.add_error_handler(self.error_handler)
        
        self.app = application
        return application
    
    def run(self):
        """Run the bot."""
        if not self.app:
            self.build_application()
        
        logger.info(f"Starting Telegram bot connected to {self.gateway_url}")
        self.app.run_polling(allowed_updates=Update.ALL_TYPES)


def main(
    bot_token: Optional[str] = None,
    gateway_url: Optional[str] = None,
):
    """Main entry point for the Telegram bot."""
    bot_token = bot_token or os.getenv("TELEGRAM_BOT_TOKEN")
    gateway_url = gateway_url or os.getenv("GLYPH_GATEWAY_URL", "http://localhost:8080")
    
    if not bot_token:
        raise ValueError(
            "TELEGRAM_BOT_TOKEN environment variable not set. "
            "Get a token from @BotFather on Telegram."
        )
    
    bot = TelegramBot(bot_token=bot_token, gateway_url=gateway_url)
    bot.run()


if __name__ == "__main__":
    main()
