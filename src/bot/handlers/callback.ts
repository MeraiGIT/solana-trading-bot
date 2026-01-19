/**
 * Callback query handlers for inline keyboards.
 */

import { BotContext } from '../bot.js';
import { showMainMenu, showHelp } from '../commands/start.js';
import {
  showWalletMenu,
  showCreateWalletConfirm,
  createWallet,
  showImportWalletPrompt,
  showDepositAddress,
  showBalance,
  refreshBalance,
  showExportKeyConfirm,
  exportPrivateKey,
  showWithdrawPrompt,
} from '../commands/wallet.js';

/**
 * Register callback handlers on the bot.
 */
export function registerCallbackHandlers(bot: BotContext['api']['config']['botInfo']['constructor']['prototype']['api']['config']['botInfo']['constructor']['prototype']['api']['raw']['constructor']['prototype']['api']['raw']['sendMessage']): void {
  // This is a placeholder - handlers are registered in index.ts
}

/**
 * Handle callback queries.
 */
export async function handleCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;

  if (!data) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Answer callback to remove loading state
  await ctx.answerCallbackQuery();

  // Route to appropriate handler
  try {
    // Menu navigation
    if (data === 'menu:main') {
      await showMainMenu(ctx);
      return;
    }

    if (data === 'menu:wallet') {
      await showWalletMenu(ctx);
      return;
    }

    if (data === 'menu:help') {
      await showHelp(ctx);
      return;
    }

    // Wallet actions
    if (data === 'wallet:create') {
      await showCreateWalletConfirm(ctx);
      return;
    }

    if (data === 'wallet:confirm_create') {
      await createWallet(ctx);
      return;
    }

    if (data === 'wallet:import') {
      await showImportWalletPrompt(ctx);
      return;
    }

    if (data === 'wallet:deposit') {
      await showDepositAddress(ctx);
      return;
    }

    if (data === 'wallet:balance') {
      await showBalance(ctx);
      return;
    }

    if (data === 'wallet:refresh') {
      await refreshBalance(ctx);
      return;
    }

    if (data === 'wallet:export') {
      await showExportKeyConfirm(ctx);
      return;
    }

    if (data === 'wallet:confirm_export') {
      await exportPrivateKey(ctx);
      return;
    }

    if (data === 'wallet:withdraw') {
      await showWithdrawPrompt(ctx);
      return;
    }

    // Trade actions (placeholder for Phase 2)
    if (data === 'menu:trade') {
      await ctx.editMessageText(
        '📈 *Trading*\n\n_Coming soon! Trading functionality is being developed._',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Positions (placeholder for Phase 3)
    if (data === 'menu:positions') {
      await ctx.editMessageText(
        '📊 *Positions*\n\n_Coming soon! Position tracking is being developed._',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Orders (placeholder for Phase 3)
    if (data === 'menu:orders') {
      await ctx.editMessageText(
        '📋 *Orders*\n\n_Coming soon! Order management is being developed._',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Settings (placeholder)
    if (data === 'menu:settings') {
      await ctx.editMessageText(
        '⚙️ *Settings*\n\n_Coming soon! Settings are being developed._',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Unknown callback
    console.log('Unknown callback:', data);
  } catch (error) {
    console.error('Error handling callback:', error);
    await ctx.reply('❌ An error occurred. Please try again.');
  }
}
