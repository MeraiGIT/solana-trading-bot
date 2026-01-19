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
import {
  showTradeMenu,
  handleTokenInput,
  handleBuy,
  showPositions,
  showSellOptions,
  handleSell,
  showStopLossPrompt,
  showTakeProfitPrompt,
  showOrders,
  cancelOrder,
} from '../commands/trade.js';

/**
 * Register callback handlers on the bot.
 * Note: Handlers are registered directly in index.ts
 */
export function registerCallbackHandlers(): void {
  // Placeholder - handlers are registered in index.ts
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

    // Trade menu
    if (data === 'menu:trade') {
      await showTradeMenu(ctx);
      return;
    }

    // Positions
    if (data === 'menu:positions' || data === 'trade:positions') {
      await showPositions(ctx);
      return;
    }

    // Orders
    if (data === 'menu:orders' || data === 'trade:orders') {
      await showOrders(ctx);
      return;
    }

    // Token lookup (refresh)
    if (data.startsWith('token:')) {
      const tokenAddress = data.replace('token:', '');
      await handleTokenInput(ctx, tokenAddress);
      return;
    }

    // Buy actions
    if (data.startsWith('buy:')) {
      const parts = data.split(':');
      if (parts.length === 3) {
        const amount = parts[1];
        const tokenAddress = parts[2];
        await handleBuy(ctx, amount, tokenAddress);
      }
      return;
    }

    // Sell menu (show options for a position)
    if (data.startsWith('sell:') && data.split(':').length === 2) {
      const tokenAddress = data.replace('sell:', '');
      await showSellOptions(ctx, tokenAddress);
      return;
    }

    // Sell action with percentage
    if (data.startsWith('sell:') && data.split(':').length === 3) {
      const parts = data.split(':');
      const percentage = parseInt(parts[1], 10);
      const tokenAddress = parts[2];
      await handleSell(ctx, percentage, tokenAddress);
      return;
    }

    // Stop Loss prompt
    if (data.startsWith('sl:')) {
      const tokenAddress = data.replace('sl:', '');
      await showStopLossPrompt(ctx, tokenAddress);
      return;
    }

    // Take Profit prompt
    if (data.startsWith('tp:')) {
      const tokenAddress = data.replace('tp:', '');
      await showTakeProfitPrompt(ctx, tokenAddress);
      return;
    }

    // Cancel order
    if (data.startsWith('cancel_order:')) {
      const orderId = data.replace('cancel_order:', '');
      await cancelOrder(ctx, orderId);
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
