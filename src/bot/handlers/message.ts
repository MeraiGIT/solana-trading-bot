/**
 * Message handlers for text input.
 */

import { BotContext, getUserId } from '../bot.js';
import { handlePrivateKeyImport } from '../commands/wallet.js';
import { WalletManager } from '../../wallet/manager.js';
import { db } from '../../services/database.js';
import { appConfig } from '../../utils/env.js';
import {
  handleTokenInput,
  handleBuy,
  createStopLoss,
  createTakeProfit,
} from '../commands/trade.js';
import { handleSettingValue } from '../commands/settings.js';
import { walletMenuKeyboard } from '../keyboards/menus.js';

// Create wallet manager instance
const walletManager = new WalletManager(
  appConfig.masterEncryptionKey,
  appConfig.solanaRpcUrl
);

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

    case 'awaiting_withdraw_confirm':
      await handleWithdrawConfirm(ctx, text.trim());
      break;

    case 'awaiting_setting_value':
      await handleSettingValue(ctx, text.trim());
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
  ctx.session.withdrawAddress = address;
  ctx.session.state = 'awaiting_withdraw_amount';

  // Get current balance
  const userId = getUserId(ctx);
  const wallet = await db.getWallet(userId);

  let balanceText = '';
  if (wallet) {
    try {
      const balance = await walletManager.getBalance(wallet.publicAddress);
      balanceText = `\n\n*Available:* ${balance.sol.toFixed(4)} SOL`;
    } catch {
      // Ignore balance fetch error
    }
  }

  await ctx.reply(
    '📤 *Withdraw Amount*\n\n' +
    'How much SOL do you want to withdraw?\n\n' +
    'Send the amount (e.g., `0.5` or `all`)' + balanceText,
    { parse_mode: 'Markdown' }
  );
}

/**
 * Get default withdrawal settings.
 */
function getDefaultWithdrawSettings() {
  return {
    dailyWithdrawLimitSol: 10,
    withdrawDelayMinutes: 0,
    largeWithdrawThresholdSol: 5,
  };
}

/**
 * Handle withdraw amount input with security checks.
 */
async function handleWithdrawAmount(ctx: BotContext, amountStr: string): Promise<void> {
  const userId = getUserId(ctx);
  const wallet = await db.getWallet(userId);
  const destinationAddress = ctx.session.withdrawAddress;

  if (!wallet || !destinationAddress) {
    ctx.session.state = undefined;
    await ctx.reply('❌ Session expired. Please try again from /wallet.');
    return;
  }

  // Get balance
  let balance;
  try {
    balance = await walletManager.getBalance(wallet.publicAddress);
  } catch {
    ctx.session.state = undefined;
    await ctx.reply('❌ Failed to fetch balance. Please try again.');
    return;
  }

  // Parse amount
  let amountSol: number;
  const networkFee = 0.000005; // ~5000 lamports

  if (amountStr.toLowerCase() === 'all' || amountStr.toLowerCase() === 'max') {
    // Withdraw all minus network fee
    amountSol = Math.max(0, balance.sol - networkFee);
    if (amountSol <= 0) {
      ctx.session.state = undefined;
      await ctx.reply('❌ Insufficient balance for withdrawal.');
      return;
    }
  } else {
    amountSol = parseFloat(amountStr);
    if (isNaN(amountSol) || amountSol <= 0) {
      await ctx.reply('❌ Invalid amount. Please enter a positive number or "all".');
      return;
    }
  }

  // Check if enough balance
  if (amountSol + networkFee > balance.sol) {
    await ctx.reply(
      `❌ Insufficient balance.\n\n` +
      `*Requested:* ${amountSol.toFixed(4)} SOL\n` +
      `*Network fee:* ~${networkFee} SOL\n` +
      `*Available:* ${balance.sol.toFixed(4)} SOL`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Get user settings for withdrawal limits
  const settings = await db.getUserSettings(userId);
  const limits = settings || getDefaultWithdrawSettings();

  // Check daily withdrawal limit
  const todayWithdrawals = await db.getTodayWithdrawals(userId);
  const remainingLimit = limits.dailyWithdrawLimitSol - todayWithdrawals;

  if (amountSol > remainingLimit) {
    await ctx.reply(
      `⚠️ *Daily Withdrawal Limit Exceeded*\n\n` +
      `*Daily limit:* ${limits.dailyWithdrawLimitSol} SOL\n` +
      `*Already withdrawn today:* ${todayWithdrawals.toFixed(4)} SOL\n` +
      `*Remaining:* ${remainingLimit.toFixed(4)} SOL\n` +
      `*Requested:* ${amountSol.toFixed(4)} SOL\n\n` +
      `_You can adjust your daily limit in Settings → Withdrawal Limits_`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Check if this is a large withdrawal requiring extra warning
  const isLargeWithdrawal = amountSol >= limits.largeWithdrawThresholdSol;

  // Store amount and show confirmation
  ctx.session.withdrawAmount = amountSol;
  ctx.session.state = 'awaiting_withdraw_confirm';

  const shortDestination = `${destinationAddress.slice(0, 8)}...${destinationAddress.slice(-8)}`;

  let confirmMessage = `
📤 *Confirm Withdrawal*

*Amount:* ${amountSol.toFixed(4)} SOL
*Network fee:* ~${networkFee} SOL
*You will receive:* ~${(amountSol - networkFee).toFixed(4)} SOL

*To:* \`${shortDestination}\`
`;

  if (isLargeWithdrawal) {
    confirmMessage += `
🚨 *LARGE WITHDRAWAL WARNING*
This withdrawal exceeds your large withdrawal threshold (${limits.largeWithdrawThresholdSol} SOL).
Please double-check the destination address!
`;
  }

  confirmMessage += `
⚠️ *This action cannot be undone!*

Type \`CONFIRM\` to proceed or \`CANCEL\` to abort.`;

  await ctx.reply(confirmMessage.trim(), { parse_mode: 'Markdown' });
}

/**
 * Handle withdraw confirmation input.
 */
export async function handleWithdrawConfirm(ctx: BotContext, input: string): Promise<void> {
  const userId = getUserId(ctx);

  if (input.toUpperCase() === 'CANCEL') {
    ctx.session.state = undefined;
    ctx.session.withdrawAddress = undefined;
    ctx.session.withdrawAmount = undefined;
    await ctx.reply('❌ Withdrawal cancelled.', {
      reply_markup: walletMenuKeyboard(true),
    });
    return;
  }

  if (input.toUpperCase() !== 'CONFIRM') {
    await ctx.reply('⚠️ Type `CONFIRM` to proceed or `CANCEL` to abort.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const wallet = await db.getWallet(userId);
  const destinationAddress = ctx.session.withdrawAddress;
  const amountSol = ctx.session.withdrawAmount;

  if (!wallet || !destinationAddress || !amountSol) {
    ctx.session.state = undefined;
    await ctx.reply('❌ Session expired. Please try again from /wallet.');
    return;
  }

  // Clear session immediately
  ctx.session.state = undefined;
  ctx.session.withdrawAddress = undefined;
  ctx.session.withdrawAmount = undefined;

  // Show processing message
  const processingMsg = await ctx.reply('⏳ Processing withdrawal...');

  try {
    // Execute withdrawal
    const result = await walletManager.withdrawSol(wallet, destinationAddress, amountSol);

    // Record transaction
    await db.createTransaction({
      userId,
      type: 'withdraw',
      tokenAddress: null,
      tokenSymbol: 'SOL',
      amountTokens: null,
      amountSol: amountSol,
      priceUsd: null,
      txSignature: result.signature,
      dexUsed: null,
      status: 'success',
      errorMessage: null,
    });

    // Delete processing message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id);
    } catch {
      // Ignore
    }

    const shortSignature = `${result.signature.slice(0, 8)}...${result.signature.slice(-8)}`;

    const successMessage = `
✅ *Withdrawal Successful!*

*Amount:* ${amountSol.toFixed(4)} SOL
*Fee:* ~${result.fee.toFixed(6)} SOL

*Transaction:*
\`${shortSignature}\`

[View on Solscan](https://solscan.io/tx/${result.signature})
    `.trim();

    await ctx.reply(successMessage, {
      parse_mode: 'Markdown',
      reply_markup: walletMenuKeyboard(true),
    });
  } catch (error) {
    // Delete processing message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id);
    } catch {
      // Ignore
    }

    // Record failed transaction
    await db.createTransaction({
      userId,
      type: 'withdraw',
      tokenAddress: null,
      tokenSymbol: 'SOL',
      amountTokens: null,
      amountSol: amountSol,
      priceUsd: null,
      txSignature: null,
      dexUsed: null,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    await ctx.reply(
      `❌ *Withdrawal Failed*\n\n${error instanceof Error ? error.message : 'Unknown error'}`,
      {
        parse_mode: 'Markdown',
        reply_markup: walletMenuKeyboard(true),
      }
    );
  }
}
