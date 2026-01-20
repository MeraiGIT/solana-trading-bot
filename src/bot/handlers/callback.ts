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
  showDeleteWalletConfirm,
  deleteWallet,
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
  showHistory,
} from '../commands/trade.js';
import {
  showSettingsMenu,
  showBuyAmountSettings,
  setBuyAmount,
  showCustomBuyPrompt,
  showSlippageSettings,
  setSlippage,
  showAutoSlSettings,
  setAutoSl,
  showAutoTpSettings,
  setAutoTp,
} from '../commands/settings.js';

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

    if (data === 'wallet:delete') {
      await showDeleteWalletConfirm(ctx);
      return;
    }

    if (data === 'wallet:confirm_delete') {
      await deleteWallet(ctx);
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

    // Transaction history
    if (data === 'menu:history') {
      await showHistory(ctx, 1);
      return;
    }

    if (data.startsWith('history:')) {
      const page = parseInt(data.replace('history:', ''), 10);
      await showHistory(ctx, page);
      return;
    }

    // Settings menu
    if (data === 'menu:settings') {
      await showSettingsMenu(ctx);
      return;
    }

    // Settings: Buy amount
    if (data === 'settings:buy_amount') {
      await showBuyAmountSettings(ctx);
      return;
    }

    if (data.startsWith('settings:set_buy:')) {
      const amount = parseFloat(data.replace('settings:set_buy:', ''));
      await setBuyAmount(ctx, amount);
      return;
    }

    if (data === 'settings:custom_buy') {
      await showCustomBuyPrompt(ctx);
      return;
    }

    // Settings: Slippage
    if (data === 'settings:slippage') {
      await showSlippageSettings(ctx);
      return;
    }

    if (data.startsWith('settings:slippage:')) {
      const slippage = parseInt(data.replace('settings:slippage:', ''), 10);
      await setSlippage(ctx, slippage);
      return;
    }

    // Settings: Auto SL
    if (data === 'settings:auto_sl') {
      await showAutoSlSettings(ctx);
      return;
    }

    if (data.startsWith('settings:set_auto_sl:')) {
      const percent = parseInt(data.replace('settings:set_auto_sl:', ''), 10);
      await setAutoSl(ctx, percent);
      return;
    }

    // Settings: Auto TP
    if (data === 'settings:auto_tp') {
      await showAutoTpSettings(ctx);
      return;
    }

    if (data.startsWith('settings:set_auto_tp:')) {
      const percent = parseInt(data.replace('settings:set_auto_tp:', ''), 10);
      await setAutoTp(ctx, percent);
      return;
    }

    // Unknown callback
    console.log('Unknown callback:', data);
  } catch (error) {
    console.error('Error handling callback:', error);
    await ctx.reply('❌ An error occurred. Please try again.');
  }
}
