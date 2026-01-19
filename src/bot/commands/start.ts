/**
 * /start command handler.
 */

import { BotContext, getUserId } from '../bot.js';
import { mainMenuKeyboard, walletMenuKeyboard, confirmCreateWalletKeyboard } from '../keyboards/menus.js';
import { db } from '../../services/database.js';

/**
 * Handle /start command.
 */
export async function handleStart(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);
  const firstName = ctx.from?.first_name || 'there';

  // Check if user has a wallet
  const hasWallet = await db.hasWallet(userId);

  if (!hasWallet) {
    // New user - prompt to create wallet
    const message = `
👋 Welcome to *Solana Trading Bot*, ${firstName}!

I'm your personal trading assistant for Solana tokens. I can help you:

• 💰 Create a secure wallet
• 📈 Buy tokens instantly
• 📊 Track your positions
• 🛑 Set stop-loss orders
• 🎯 Set take-profit orders

*Let's get started!*

You don't have a wallet yet. Would you like to create one or import an existing wallet?
    `.trim();

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: walletMenuKeyboard(false),
    });
  } else {
    // Existing user - show main menu
    const message = `
👋 Welcome back, ${firstName}!

What would you like to do today?
    `.trim();

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });
  }
}

/**
 * Show main menu.
 */
export async function showMainMenu(ctx: BotContext): Promise<void> {
  const message = `
🏠 *Main Menu*

Choose an option below:
  `.trim();

  // Try to edit existing message, or send new one
  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });
  }
}

/**
 * Show help message.
 */
export async function showHelp(ctx: BotContext): Promise<void> {
  const message = `
❓ *Help & Commands*

*Basic Commands:*
/start - Start the bot
/wallet - Manage your wallet
/trade - Buy or sell tokens
/positions - View your holdings
/settings - Configure preferences
/help - Show this help

*How to Trade:*
1️⃣ Create or import a wallet
2️⃣ Deposit SOL to your wallet
3️⃣ Paste a token address to buy
4️⃣ Set your stop-loss and take-profit

*Tips:*
• Always use stop-loss to protect your investment
• Start with small amounts to test
• Check liquidity before buying

*Need Support?*
Contact the developer for assistance.
  `.trim();

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });
  }
}
