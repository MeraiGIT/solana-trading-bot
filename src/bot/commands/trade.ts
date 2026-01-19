/**
 * Trade command handlers for buying and selling tokens.
 */

import { BotContext, getUserId, sendError } from '../bot.js';
import { db } from '../../services/database.js';
import { DexRouter, TokenInfo, formatPrice, formatNumber } from '../../trading/index.js';
import { WalletManager } from '../../wallet/manager.js';
import { appConfig } from '../../utils/env.js';

// Create instances
const walletManager = new WalletManager(
  appConfig.masterEncryptionKey,
  appConfig.solanaRpcUrl
);

const router = new DexRouter({
  rpcUrl: appConfig.solanaRpcUrl,
  defaultSlippageBps: 500, // 5%
  defaultPriorityFee: 100000, // 0.0001 SOL in lamports
});

/**
 * Buy amount options in SOL.
 */
const BUY_AMOUNTS = [0.1, 0.25, 0.5, 1];

/**
 * Sell percentage options.
 */
const SELL_PERCENTAGES = [25, 50, 75, 100];

/**
 * Show trade menu.
 */
export async function showTradeMenu(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);
  const hasWallet = await db.hasWallet(userId);

  if (!hasWallet) {
    await sendError(ctx, 'You need to create a wallet first! Use /wallet to get started.');
    return;
  }

  const message = `
📈 *Trading*

Send a *token address* to buy, or select an option below.

*Quick Actions:*
• Paste a token address to see info and buy
• Use /positions to view your holdings
• Use /orders to manage SL/TP
  `.trim();

  const keyboard = {
    inline_keyboard: [
      [{ text: '📊 My Positions', callback_data: 'trade:positions' }],
      [{ text: '📋 My Orders', callback_data: 'trade:orders' }],
      [{ text: '◀️ Back', callback_data: 'menu:main' }],
    ],
  };

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}

/**
 * Handle token address input - show token info and buy options.
 */
export async function handleTokenInput(ctx: BotContext, tokenAddress: string): Promise<void> {
  const userId = getUserId(ctx);

  // Check if user has wallet
  const hasWallet = await db.hasWallet(userId);
  if (!hasWallet) {
    await ctx.reply('❌ You need to create a wallet first! Use /wallet to get started.');
    return;
  }

  // Show loading
  const loadingMsg = await ctx.reply('🔍 Looking up token...');

  try {
    // Fetch token info
    const tokenInfo = await router.getTokenInfo(tokenAddress);

    if (!tokenInfo) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        '❌ Token not found or no liquidity. Please check the address and try again.'
      );
      return;
    }

    // Store token in session for buy flow
    ctx.session.tradeToken = {
      address: tokenAddress,
      symbol: tokenInfo.symbol,
      name: tokenInfo.name,
      decimals: tokenInfo.decimals,
      priceUsd: tokenInfo.priceUsd,
    };

    // Format token info message
    const message = formatTokenInfoMessage(tokenInfo);

    // Create buy buttons
    const keyboard = createBuyKeyboard(tokenAddress);

    // Edit loading message with token info
    await ctx.api.editMessageText(
      ctx.chat!.id,
      loadingMsg.message_id,
      message,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  } catch (error) {
    console.error('Error fetching token:', error);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      loadingMsg.message_id,
      '❌ Error fetching token info. Please try again.'
    );
  }
}

/**
 * Format token info message.
 */
function formatTokenInfoMessage(info: TokenInfo): string {
  const priceChange = info.priceChange24h >= 0
    ? `🟢 +${info.priceChange24h.toFixed(2)}%`
    : `🔴 ${info.priceChange24h.toFixed(2)}%`;

  const dexInfo = info.isPumpFun
    ? (info.onBondingCurve ? '🎰 PumpFun (Bonding Curve)' : '🎰 PumpFun (Graduated)')
    : `🔄 ${info.dexName}`;

  return `
*${info.name}* (${info.symbol})

💰 *Price:* ${formatPrice(info.priceUsd)}
📊 *24h:* ${priceChange}
💧 *Liquidity:* $${formatNumber(info.liquidity)}
📈 *Volume 24h:* $${formatNumber(info.volume24h)}
${info.marketCap ? `🏦 *Market Cap:* $${formatNumber(info.marketCap)}` : ''}

*DEX:* ${dexInfo}

\`${info.address}\`

*Select an amount to buy:*
  `.trim();
}

/**
 * Create buy keyboard with amount options.
 */
function createBuyKeyboard(tokenAddress: string) {
  const buyButtons = BUY_AMOUNTS.map(amount => ({
    text: `${amount} SOL`,
    callback_data: `buy:${amount}:${tokenAddress}`,
  }));

  return {
    inline_keyboard: [
      buyButtons.slice(0, 2),
      buyButtons.slice(2, 4),
      [{ text: '✏️ Custom Amount', callback_data: `buy:custom:${tokenAddress}` }],
      [{ text: '🔄 Refresh', callback_data: `token:${tokenAddress}` }],
      [{ text: '❌ Cancel', callback_data: 'menu:main' }],
    ],
  };
}

/**
 * Handle buy callback.
 */
export async function handleBuy(
  ctx: BotContext,
  amount: string,
  tokenAddress: string
): Promise<void> {
  const userId = getUserId(ctx);

  // Get wallet
  const wallet = await db.getWallet(userId);
  if (!wallet) {
    await sendError(ctx, 'Wallet not found. Please create one first.');
    return;
  }

  // Handle custom amount
  if (amount === 'custom') {
    ctx.session.state = 'awaiting_buy_amount';
    ctx.session.tradeToken = { address: tokenAddress, symbol: '', name: '', decimals: 9, priceUsd: 0 };

    await ctx.editMessageText(
      '✏️ *Custom Buy Amount*\n\nEnter the amount in SOL you want to spend (e.g., `0.5`)',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'menu:main' }]],
        },
      }
    );
    return;
  }

  const solAmount = parseFloat(amount);
  if (isNaN(solAmount) || solAmount <= 0) {
    await sendError(ctx, 'Invalid amount');
    return;
  }

  // Check balance
  try {
    const balance = await walletManager.getBalance(wallet.publicAddress);
    if (balance.sol < solAmount + 0.01) { // Reserve 0.01 SOL for fees
      await sendError(ctx, `Insufficient balance. You have ${balance.sol.toFixed(4)} SOL.`);
      return;
    }
  } catch {
    await sendError(ctx, 'Error checking balance. Please try again.');
    return;
  }

  // Show confirmation
  await ctx.editMessageText(
    `⏳ *Buying...*\n\nSpending ${solAmount} SOL on token...\n\n_Please wait, this may take a moment._`,
    { parse_mode: 'Markdown' }
  );

  try {
    // Get keypair for signing
    const keypair = walletManager.getKeypair(wallet);

    // Execute buy
    const result = await router.buy(tokenAddress, solAmount, keypair, {
      slippageBps: 1000, // 10% for safety
      priorityFee: 150000, // Higher priority
    });

    if (result.success) {
      // Get token info for position
      const tokenInfo = result.tokenInfo;

      // Save position to database
      if (tokenInfo) {
        await db.upsertPosition({
          userId,
          tokenAddress,
          tokenSymbol: tokenInfo.symbol,
          tokenDecimals: tokenInfo.decimals,
          amount: result.outputAmount ? Number(result.outputAmount) : 0,
          entryPriceUsd: tokenInfo.priceUsd,
          entrySol: solAmount,
        });
      }

      // Record transaction
      await db.createTransaction({
        userId,
        type: 'buy',
        tokenAddress,
        tokenSymbol: tokenInfo?.symbol || null,
        amountTokens: result.outputAmount ? Number(result.outputAmount) : null,
        amountSol: solAmount,
        priceUsd: tokenInfo?.priceUsd || null,
        txSignature: result.signature || null,
        dexUsed: result.dexUsed,
        status: 'success',
        errorMessage: null,
      });

      const successMsg = `
✅ *Buy Successful!*

*Token:* ${tokenInfo?.symbol || 'Unknown'}
*Spent:* ${solAmount} SOL
*Via:* ${result.dexUsed === 'jupiter' ? 'Jupiter' : 'PumpPortal'}
${result.signature ? `\n[View on Solscan](https://solscan.io/tx/${result.signature})` : ''}

Use /positions to view your holdings.
      `.trim();

      await ctx.editMessageText(successMsg, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📊 View Position', callback_data: 'trade:positions' }],
            [{ text: '🔄 Buy More', callback_data: `token:${tokenAddress}` }],
            [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
          ],
        },
      });
    } else {
      // Record failed transaction
      await db.createTransaction({
        userId,
        type: 'buy',
        tokenAddress,
        tokenSymbol: result.tokenInfo?.symbol || null,
        amountTokens: null,
        amountSol: solAmount,
        priceUsd: result.tokenInfo?.priceUsd || null,
        txSignature: null,
        dexUsed: result.dexUsed,
        status: 'failed',
        errorMessage: result.error || 'Unknown error',
      });

      await ctx.editMessageText(
        `❌ *Buy Failed*\n\n${result.error || 'Transaction failed'}\n\nPlease try again.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Try Again', callback_data: `token:${tokenAddress}` }],
              [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
            ],
          },
        }
      );
    }
  } catch (error) {
    console.error('Buy error:', error);
    await ctx.editMessageText(
      `❌ *Error*\n\n${(error as Error).message}\n\nPlease try again.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'menu:main' }]],
        },
      }
    );
  }
}

/**
 * Show user positions.
 */
export async function showPositions(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);

  const positions = await db.getPositions(userId);

  if (positions.length === 0) {
    const message = `
📊 *Your Positions*

_No open positions._

Paste a token address to start trading!
    `.trim();

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '◀️ Back', callback_data: 'menu:main' }]],
        },
      });
    } catch {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '◀️ Back', callback_data: 'menu:main' }]],
        },
      });
    }
    return;
  }

  // Build positions list with current prices
  let positionsList = '';
  const buttons: { text: string; callback_data: string }[][] = [];

  for (const pos of positions.slice(0, 5)) { // Show max 5
    // Get current price
    const info = await router.getTokenInfo(pos.tokenAddress);
    const currentPrice = info?.priceUsd || 0;
    const entryPrice = pos.entryPriceUsd || 0;

    const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
    const pnlEmoji = pnlPercent >= 0 ? '🟢' : '🔴';
    const pnlText = pnlPercent >= 0 ? `+${pnlPercent.toFixed(2)}%` : `${pnlPercent.toFixed(2)}%`;

    positionsList += `\n*${pos.tokenSymbol || 'Unknown'}*\n`;
    positionsList += `  Amount: ${formatNumber(pos.amount)}\n`;
    positionsList += `  Entry: ${formatPrice(entryPrice)}\n`;
    positionsList += `  Current: ${formatPrice(currentPrice)}\n`;
    positionsList += `  PnL: ${pnlEmoji} ${pnlText}\n`;

    buttons.push([
      { text: `📈 ${pos.tokenSymbol || 'Sell'}`, callback_data: `sell:${pos.tokenAddress}` },
    ]);
  }

  const message = `
📊 *Your Positions*
${positionsList}
Select a position to sell or manage:
  `.trim();

  buttons.push([{ text: '◀️ Back', callback_data: 'menu:main' }]);

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }
}

/**
 * Show sell options for a position.
 */
export async function showSellOptions(ctx: BotContext, tokenAddress: string): Promise<void> {
  const userId = getUserId(ctx);

  const position = await db.getPosition(userId, tokenAddress);
  if (!position) {
    await sendError(ctx, 'Position not found.');
    return;
  }

  const info = await router.getTokenInfo(tokenAddress);
  const currentPrice = info?.priceUsd || 0;
  const entryPrice = position.entryPriceUsd || 0;
  const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

  const message = `
📤 *Sell ${position.tokenSymbol || 'Token'}*

*Holdings:* ${formatNumber(position.amount)}
*Current Price:* ${formatPrice(currentPrice)}
*Entry Price:* ${formatPrice(entryPrice)}
*PnL:* ${pnlPercent >= 0 ? '🟢' : '🔴'} ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%

*Select amount to sell:*
  `.trim();

  const sellButtons = SELL_PERCENTAGES.map(pct => ({
    text: `${pct}%`,
    callback_data: `sell:${pct}:${tokenAddress}`,
  }));

  const keyboard = {
    inline_keyboard: [
      sellButtons.slice(0, 2),
      sellButtons.slice(2, 4),
      [
        { text: '🛑 Set SL', callback_data: `sl:${tokenAddress}` },
        { text: '🎯 Set TP', callback_data: `tp:${tokenAddress}` },
      ],
      [{ text: '◀️ Back', callback_data: 'trade:positions' }],
    ],
  };

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}

/**
 * Handle sell callback.
 */
export async function handleSell(
  ctx: BotContext,
  percentage: number,
  tokenAddress: string
): Promise<void> {
  const userId = getUserId(ctx);

  // Get wallet and position
  const wallet = await db.getWallet(userId);
  const position = await db.getPosition(userId, tokenAddress);

  if (!wallet || !position) {
    await sendError(ctx, 'Wallet or position not found.');
    return;
  }

  const sellAmount = (position.amount * percentage) / 100;
  const decimals = position.tokenDecimals || 9;

  // Show selling message
  await ctx.editMessageText(
    `⏳ *Selling ${percentage}%...*\n\nSelling ${formatNumber(sellAmount)} ${position.tokenSymbol || 'tokens'}...\n\n_Please wait..._`,
    { parse_mode: 'Markdown' }
  );

  try {
    const keypair = walletManager.getKeypair(wallet);

    const result = await router.sell(tokenAddress, sellAmount, decimals, keypair, {
      slippageBps: 1000,
      priorityFee: 150000,
    });

    if (result.success) {
      const solReceived = result.outputAmount ? Number(result.outputAmount) / 1e9 : 0;

      // Update position
      const newAmount = position.amount - sellAmount;
      if (newAmount <= 0.0001) {
        await db.deletePosition(userId, tokenAddress);
      } else {
        await db.upsertPosition({
          ...position,
          amount: newAmount,
        });
      }

      // Record transaction
      await db.createTransaction({
        userId,
        type: 'sell',
        tokenAddress,
        tokenSymbol: position.tokenSymbol,
        amountTokens: sellAmount,
        amountSol: solReceived,
        priceUsd: result.tokenInfo?.priceUsd || null,
        txSignature: result.signature || null,
        dexUsed: result.dexUsed,
        status: 'success',
        errorMessage: null,
      });

      const successMsg = `
✅ *Sell Successful!*

*Sold:* ${formatNumber(sellAmount)} ${position.tokenSymbol || 'tokens'}
*Received:* ${solReceived.toFixed(4)} SOL
*Via:* ${result.dexUsed === 'jupiter' ? 'Jupiter' : 'PumpPortal'}
${result.signature ? `\n[View on Solscan](https://solscan.io/tx/${result.signature})` : ''}
      `.trim();

      await ctx.editMessageText(successMsg, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📊 View Positions', callback_data: 'trade:positions' }],
            [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
          ],
        },
      });
    } else {
      await db.createTransaction({
        userId,
        type: 'sell',
        tokenAddress,
        tokenSymbol: position.tokenSymbol,
        amountTokens: sellAmount,
        amountSol: null,
        priceUsd: null,
        txSignature: null,
        dexUsed: result.dexUsed,
        status: 'failed',
        errorMessage: result.error || 'Unknown error',
      });

      await ctx.editMessageText(
        `❌ *Sell Failed*\n\n${result.error || 'Transaction failed'}\n\nPlease try again.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Try Again', callback_data: `sell:${tokenAddress}` }],
              [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
            ],
          },
        }
      );
    }
  } catch (error) {
    console.error('Sell error:', error);
    await ctx.editMessageText(
      `❌ *Error*\n\n${(error as Error).message}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'menu:main' }]],
        },
      }
    );
  }
}

/**
 * Show stop loss input prompt.
 */
export async function showStopLossPrompt(ctx: BotContext, tokenAddress: string): Promise<void> {
  const userId = getUserId(ctx);
  const position = await db.getPosition(userId, tokenAddress);

  if (!position) {
    await sendError(ctx, 'Position not found.');
    return;
  }

  const info = await router.getTokenInfo(tokenAddress);
  const currentPrice = info?.priceUsd || 0;

  ctx.session.state = 'awaiting_sl_price';
  ctx.session.tradeToken = {
    address: tokenAddress,
    symbol: position.tokenSymbol || '',
    name: '',
    decimals: position.tokenDecimals || 9,
    priceUsd: currentPrice,
  };

  const message = `
🛑 *Set Stop Loss*

*Token:* ${position.tokenSymbol || 'Unknown'}
*Current Price:* ${formatPrice(currentPrice)}
*Entry Price:* ${formatPrice(position.entryPriceUsd || 0)}

Enter the trigger price in USD (e.g., \`0.00001\`).
When price drops to this level, your position will be sold automatically.
  `.trim();

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '❌ Cancel', callback_data: `sell:${tokenAddress}` }]],
    },
  });
}

/**
 * Show take profit input prompt.
 */
export async function showTakeProfitPrompt(ctx: BotContext, tokenAddress: string): Promise<void> {
  const userId = getUserId(ctx);
  const position = await db.getPosition(userId, tokenAddress);

  if (!position) {
    await sendError(ctx, 'Position not found.');
    return;
  }

  const info = await router.getTokenInfo(tokenAddress);
  const currentPrice = info?.priceUsd || 0;

  ctx.session.state = 'awaiting_tp_price';
  ctx.session.tradeToken = {
    address: tokenAddress,
    symbol: position.tokenSymbol || '',
    name: '',
    decimals: position.tokenDecimals || 9,
    priceUsd: currentPrice,
  };

  const message = `
🎯 *Set Take Profit*

*Token:* ${position.tokenSymbol || 'Unknown'}
*Current Price:* ${formatPrice(currentPrice)}
*Entry Price:* ${formatPrice(position.entryPriceUsd || 0)}

Enter the trigger price in USD (e.g., \`0.00005\`).
When price rises to this level, your position will be sold automatically.
  `.trim();

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '❌ Cancel', callback_data: `sell:${tokenAddress}` }]],
    },
  });
}

/**
 * Create stop loss order.
 */
export async function createStopLoss(
  ctx: BotContext,
  tokenAddress: string,
  triggerPrice: number
): Promise<void> {
  const userId = getUserId(ctx);
  const position = await db.getPosition(userId, tokenAddress);

  if (!position) {
    await sendError(ctx, 'Position not found.');
    return;
  }

  try {
    const orderId = await db.createLimitOrder({
      userId,
      positionId: position.id,
      orderType: 'stop_loss',
      triggerPrice,
      sellPercentage: 100,
      status: 'active',
    });

    if (orderId) {
      await ctx.reply(
        `✅ *Stop Loss Set!*\n\nTrigger price: ${formatPrice(triggerPrice)}\nSell: 100% of position\n\nYour position will be sold automatically when price drops to this level.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📊 View Position', callback_data: `sell:${tokenAddress}` }],
              [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
            ],
          },
        }
      );
    } else {
      await sendError(ctx, 'Failed to create stop loss order.');
    }
  } catch (error) {
    console.error('Error creating SL:', error);
    await sendError(ctx, 'Error creating stop loss.');
  }
}

/**
 * Create take profit order.
 */
export async function createTakeProfit(
  ctx: BotContext,
  tokenAddress: string,
  triggerPrice: number
): Promise<void> {
  const userId = getUserId(ctx);
  const position = await db.getPosition(userId, tokenAddress);

  if (!position) {
    await sendError(ctx, 'Position not found.');
    return;
  }

  try {
    const orderId = await db.createLimitOrder({
      userId,
      positionId: position.id,
      orderType: 'take_profit',
      triggerPrice,
      sellPercentage: 100,
      status: 'active',
    });

    if (orderId) {
      await ctx.reply(
        `✅ *Take Profit Set!*\n\nTrigger price: ${formatPrice(triggerPrice)}\nSell: 100% of position\n\nYour position will be sold automatically when price rises to this level.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📊 View Position', callback_data: `sell:${tokenAddress}` }],
              [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
            ],
          },
        }
      );
    } else {
      await sendError(ctx, 'Failed to create take profit order.');
    }
  } catch (error) {
    console.error('Error creating TP:', error);
    await sendError(ctx, 'Error creating take profit.');
  }
}

/**
 * Show active orders.
 */
export async function showOrders(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);
  const orders = await db.getActiveLimitOrders(userId);

  if (orders.length === 0) {
    const message = `
📋 *Active Orders*

_No active orders._

Use the position menu to set SL/TP orders.
    `.trim();

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '◀️ Back', callback_data: 'menu:main' }]],
        },
      });
    } catch {
      await ctx.reply(message, { parse_mode: 'Markdown' });
    }
    return;
  }

  let ordersList = '';
  const cancelButtons: { text: string; callback_data: string }[][] = [];

  for (const order of orders) {
    const typeEmoji = order.orderType === 'stop_loss' ? '🛑' : '🎯';
    const typeName = order.orderType === 'stop_loss' ? 'Stop Loss' : 'Take Profit';

    ordersList += `\n${typeEmoji} *${typeName}*\n`;
    ordersList += `  Trigger: ${formatPrice(order.triggerPrice)}\n`;
    ordersList += `  Sell: ${order.sellPercentage}%\n`;

    cancelButtons.push([
      { text: `❌ Cancel ${typeName}`, callback_data: `cancel_order:${order.id}` },
    ]);
  }

  const message = `
📋 *Active Orders*
${ordersList}
  `.trim();

  cancelButtons.push([{ text: '◀️ Back', callback_data: 'menu:main' }]);

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: cancelButtons },
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: cancelButtons },
    });
  }
}

/**
 * Cancel an order.
 */
export async function cancelOrder(ctx: BotContext, orderId: string): Promise<void> {
  const success = await db.updateLimitOrderStatus(orderId, 'cancelled');

  if (success) {
    await ctx.answerCallbackQuery({ text: '✅ Order cancelled' });
    await showOrders(ctx);
  } else {
    await ctx.answerCallbackQuery({ text: '❌ Failed to cancel order' });
  }
}
