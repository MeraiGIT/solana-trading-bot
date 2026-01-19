/**
 * Message handlers for text input.
 */

import { BotContext, getUserId } from '../bot.js';
import { handlePrivateKeyImport } from '../commands/wallet.js';
import { WalletManager } from '../../wallet/manager.js';

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
      // TODO: Handle token address input (Phase 2)
      await ctx.reply('🚧 Trading functionality coming soon!');
      ctx.session.state = undefined;
      break;

    case 'awaiting_amount':
      // TODO: Handle custom amount input (Phase 2)
      await ctx.reply('🚧 Trading functionality coming soon!');
      ctx.session.state = undefined;
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
    // Looks like a Solana address - could be a token
    // TODO: Implement token lookup and buy flow (Phase 2)
    await ctx.reply(
      '🔍 *Token Address Detected*\n\n' +
      '🚧 _Trading functionality is coming soon!_\n\n' +
      'Once implemented, you\'ll be able to buy this token directly.',
      { parse_mode: 'Markdown' }
    );
  }
  // Otherwise ignore the message
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
async function handleWithdrawAmount(ctx: BotContext, amount: string): Promise<void> {
  ctx.session.state = undefined;

  // TODO: Implement actual withdrawal (Phase 2)
  await ctx.reply(
    '🚧 *Withdrawal*\n\n' +
    '_Withdrawal functionality is coming soon!_',
    { parse_mode: 'Markdown' }
  );
}
