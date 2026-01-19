/**
 * Message handlers for text input.
 */

import { BotContext } from '../bot.js';
import { handlePrivateKeyImport } from '../commands/wallet.js';
import { WalletManager } from '../../wallet/manager.js';
import {
  handleTokenInput,
  handleBuy,
  createStopLoss,
  createTakeProfit,
} from '../commands/trade.js';

/**
 * Handle text messages based on current session state.
 */
export async function handleMessage(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text;

  if (!text) {
    return;
  }

  const state = ctx.session.state;

  // Handle based on current state
  switch (state) {
    case 'awaiting_private_key':
      await handlePrivateKeyImport(ctx, text.trim());
      break;

    case 'awaiting_token':
      await handleTokenInput(ctx, text.trim());
      ctx.session.state = undefined;
      break;

    case 'awaiting_amount':
    case 'awaiting_buy_amount':
      await handleBuyAmount(ctx, text.trim());
      break;

    case 'awaiting_sl_price':
      await handleSlPrice(ctx, text.trim());
      break;

    case 'awaiting_tp_price':
      await handleTpPrice(ctx, text.trim());
      break;

    case 'awaiting_withdraw_address':
      await handleWithdrawAddress(ctx, text.trim());
      break;

    case 'awaiting_withdraw_amount':
      await handleWithdrawAmount(ctx, text.trim());
      break;

    default:
      // No state - check if it's a token address
      await handlePotentialTokenAddress(ctx, text.trim());
  }
}

/**
 * Handle potential token address input.
 */
async function handlePotentialTokenAddress(ctx: BotContext, text: string): Promise<void> {
  // Check if it looks like a Solana address (32-44 base58 characters)
  const addressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  if (addressRegex.test(text)) {
    // Looks like a Solana address - show token info and buy options
    await handleTokenInput(ctx, text);
  }
  // Otherwise ignore the message
}

/**
 * Handle custom buy amount input.
 */
async function handleBuyAmount(ctx: BotContext, amountStr: string): Promise<void> {
  ctx.session.state = undefined;

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0 || amount > 100) {
    await ctx.reply('❌ Invalid amount. Please enter a number between 0.01 and 100 SOL.');
    return;
  }

  const tokenAddress = ctx.session.tradeToken?.address;
  if (!tokenAddress) {
    await ctx.reply('❌ Session expired. Please paste the token address again.');
    return;
  }

  await handleBuy(ctx, String(amount), tokenAddress);
}

/**
 * Handle stop loss price input.
 */
async function handleSlPrice(ctx: BotContext, priceStr: string): Promise<void> {
  ctx.session.state = undefined;

  const price = parseFloat(priceStr);
  if (isNaN(price) || price <= 0) {
    await ctx.reply('❌ Invalid price. Please enter a positive number.');
    return;
  }

  const tokenAddress = ctx.session.tradeToken?.address;
  if (!tokenAddress) {
    await ctx.reply('❌ Session expired. Please try again.');
    return;
  }

  await createStopLoss(ctx, tokenAddress, price);
}

/**
 * Handle take profit price input.
 */
async function handleTpPrice(ctx: BotContext, priceStr: string): Promise<void> {
  ctx.session.state = undefined;

  const price = parseFloat(priceStr);
  if (isNaN(price) || price <= 0) {
    await ctx.reply('❌ Invalid price. Please enter a positive number.');
    return;
  }

  const tokenAddress = ctx.session.tradeToken?.address;
  if (!tokenAddress) {
    await ctx.reply('❌ Session expired. Please try again.');
    return;
  }

  await createTakeProfit(ctx, tokenAddress, price);
}

/**
 * Handle withdraw address input.
 */
async function handleWithdrawAddress(ctx: BotContext, address: string): Promise<void> {
  // Validate address
  if (!WalletManager.isValidAddress(address)) {
    await ctx.reply('❌ Invalid Solana address. Please check and try again.');
    return;
  }

  // Store address and ask for amount
  ctx.session.state = 'awaiting_withdraw_amount';
  // Store the address temporarily (would need to extend session for this)

  await ctx.reply(
    '📤 *Withdraw Amount*\n\n' +
    'How much SOL do you want to withdraw?\n\n' +
    'Send the amount (e.g., `0.5` or `all`)',
    { parse_mode: 'Markdown' }
  );
}

/**
 * Handle withdraw amount input.
 */
async function handleWithdrawAmount(ctx: BotContext, _amount: string): Promise<void> {
  ctx.session.state = undefined;

  // TODO: Implement actual withdrawal (Phase 2)
  await ctx.reply(
    '🚧 *Withdrawal*\n\n' +
    '_Withdrawal functionality is coming soon!_',
    { parse_mode: 'Markdown' }
  );
}
