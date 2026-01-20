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
  defaultSlippageBps: appConfig.defaultSlippageBps,
  defaultPriorityFee: appConfig.maxPriorityFeeLamports,
  useJito: appConfig.useJito,
  heliusApiKey: appConfig.heliusApiKey,
  jupiterApiKey: appConfig.jupiterApiKey,
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
 * Helper to send or edit message depending on context.
 * Returns the message ID of the status message for later updates.
 */
async function sendStatusMessage(
  ctx: BotContext,
  text: string,
  keyboard?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
): Promise<number | null> {
  const options: { parse_mode: 'Markdown'; reply_markup?: typeof keyboard } = {
    parse_mode: 'Markdown',
  };
  if (keyboard) {
    options.reply_markup = keyboard;
  }

  // Try to edit existing message first (works for callbacks)
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, options);
      return ctx.callbackQuery.message?.message_id || null;
    }
  } catch {
    // Fall through to reply
  }

  // Send new message (for text input or if edit fails)
  const msg = await ctx.reply(text, options);
  return msg.message_id;
}

/**
 * Helper to update a status message by ID.
 */
async function updateStatusMessage(
  ctx: BotContext,
  messageId: number,
  text: string,
  keyboard?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
): Promise<void> {
  const options: { parse_mode: 'Markdown'; reply_markup?: typeof keyboard } = {
    parse_mode: 'Markdown',
  };
  if (keyboard) {
    options.reply_markup = keyboard;
  }

  try {
    await ctx.api.editMessageText(ctx.chat!.id, messageId, text, options);
  } catch {
    // If edit fails, send new message
    await ctx.reply(text, options);
  }
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

    await sendStatusMessage(
      ctx,
      '✏️ *Custom Buy Amount*\n\nEnter the amount in SOL you want to spend (e.g., `0.5`)',
      { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'menu:main' }]] }
    );
    return;
  }

  const solAmount = parseFloat(amount);
  if (isNaN(solAmount) || solAmount <= 0) {
    await sendError(ctx, 'Invalid amount');
    return;
  }

  // Step 1: Show initializing message
  const statusMsgId = await sendStatusMessage(
    ctx,
    `⏳ *Initializing Trade...*\n\n` +
    `💰 Amount: ${solAmount} SOL\n` +
    `🔍 Checking balance...`
  );

  if (!statusMsgId) {
    await sendError(ctx, 'Error initializing trade.');
    return;
  }

  // Step 2: Check balance
  let balance;
  try {
    balance = await walletManager.getBalance(wallet.publicAddress);
    if (balance.sol < solAmount + 0.01) {
      await updateStatusMessage(
        ctx,
        statusMsgId,
        `❌ *Insufficient Balance*\n\n` +
        `*Requested:* ${solAmount} SOL\n` +
        `*Available:* ${balance.sol.toFixed(4)} SOL\n` +
        `*Reserved for fees:* ~0.01 SOL\n\n` +
        `Please deposit more SOL to continue.`,
        { inline_keyboard: [[{ text: '💰 Wallet', callback_data: 'menu:wallet' }], [{ text: '🏠 Main Menu', callback_data: 'menu:main' }]] }
      );
      return;
    }
  } catch (error) {
    await updateStatusMessage(
      ctx,
      statusMsgId,
      `❌ *Error Checking Balance*\n\n${(error as Error).message}\n\nPlease try again.`,
      { inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'menu:main' }]] }
    );
    return;
  }

  // Step 3: Update - getting token info
  await updateStatusMessage(
    ctx,
    statusMsgId,
    `⏳ *Preparing Trade...*\n\n` +
    `💰 Amount: ${solAmount} SOL\n` +
    `✅ Balance: ${balance.sol.toFixed(4)} SOL\n` +
    `🔍 Fetching token info...`
  );

  try {
    // Get keypair for signing
    const keypair = walletManager.getKeypair(wallet);

    // Step 4: Update - executing swap
    await updateStatusMessage(
      ctx,
      statusMsgId,
      `⏳ *Executing Trade...*\n\n` +
      `💰 Amount: ${solAmount} SOL\n` +
      `✅ Balance verified\n` +
      `🔄 Sending transaction to DEX...\n\n` +
      `_This may take 10-30 seconds..._`
    );

    // Execute buy
    const result = await router.buy(tokenAddress, solAmount, keypair, {
      slippageBps: 1000, // 10% for safety
      priorityFee: 150000, // Higher priority
    });

    if (result.success) {
      // Get token info for position
      const tokenInfo = result.tokenInfo;
      const tokensReceived = result.outputAmount ? Number(result.outputAmount) : 0;

      // Step 5: Update - saving position
      await updateStatusMessage(
        ctx,
        statusMsgId,
        `⏳ *Finalizing...*\n\n` +
        `✅ Transaction confirmed!\n` +
        `📝 Saving position...`
      );

      // Save position to database
      if (tokenInfo) {
        await db.upsertPosition({
          userId,
          tokenAddress,
          tokenSymbol: tokenInfo.symbol,
          tokenDecimals: tokenInfo.decimals,
          amount: tokensReceived,
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
        amountTokens: tokensReceived || null,
        amountSol: solAmount,
        priceUsd: tokenInfo?.priceUsd || null,
        txSignature: result.signature || null,
        dexUsed: result.dexUsed,
        status: 'success',
        errorMessage: null,
      });

      // Step 6: Show success with position details
      const dexName = result.dexUsed === 'jupiter' ? 'Jupiter' : 'PumpPortal';
      const shortSig = result.signature ? `${result.signature.slice(0, 8)}...${result.signature.slice(-8)}` : null;

      const successMsg = `
✅ *Buy Successful!*

*Token:* ${tokenInfo?.symbol || 'Unknown'} (${tokenInfo?.name || ''})
*Spent:* ${solAmount} SOL
*Received:* ${formatNumber(tokensReceived)} tokens
*Price:* ${formatPrice(tokenInfo?.priceUsd || 0)}
*DEX:* ${dexName}

${shortSig ? `*Tx:* \`${shortSig}\`\n[View on Solscan](https://solscan.io/tx/${result.signature})` : ''}

━━━━━━━━━━━━━━━━━━
📊 *Position Created*
Entry: ${formatPrice(tokenInfo?.priceUsd || 0)}
Holdings: ${formatNumber(tokensReceived)} ${tokenInfo?.symbol || 'tokens'}
      `.trim();

      await updateStatusMessage(ctx, statusMsgId, successMsg, {
        inline_keyboard: [
          [{ text: '📊 View Positions', callback_data: 'trade:positions' }],
          [{ text: '🛑 Set Stop Loss', callback_data: `sl:${tokenAddress}` }, { text: '🎯 Set Take Profit', callback_data: `tp:${tokenAddress}` }],
          [{ text: '🔄 Buy More', callback_data: `token:${tokenAddress}` }],
          [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
        ],
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

      await updateStatusMessage(
        ctx,
        statusMsgId,
        `❌ *Buy Failed*\n\n` +
        `*Error:* ${result.error || 'Transaction failed'}\n\n` +
        `This can happen due to:\n` +
        `• High slippage / price moved\n` +
        `• Insufficient liquidity\n` +
        `• Network congestion\n\n` +
        `Please try again.`,
        {
          inline_keyboard: [
            [{ text: '🔄 Try Again', callback_data: `token:${tokenAddress}` }],
            [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
          ],
        }
      );
    }
  } catch (error) {
    console.error('Buy error:', error);
    await updateStatusMessage(
      ctx,
      statusMsgId,
      `❌ *Error*\n\n${(error as Error).message}\n\nPlease try again.`,
      {
        inline_keyboard: [
          [{ text: '🔄 Try Again', callback_data: `token:${tokenAddress}` }],
          [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
        ],
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

/**
 * Show transaction history.
 */
export async function showHistory(ctx: BotContext, page: number = 1): Promise<void> {
  const userId = getUserId(ctx);
  const limit = 10;
  const offset = (page - 1) * limit;

  // Get transactions
  const allTransactions = await db.getTransactions(userId, 50); // Get more to calculate total pages
  const totalTransactions = allTransactions.length;
  const totalPages = Math.ceil(totalTransactions / limit);
  const transactions = allTransactions.slice(offset, offset + limit);

  if (transactions.length === 0) {
    const message = `
📜 *Transaction History*

_No transactions yet._

Start trading to see your history here!
    `.trim();

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '◀️ Back', callback_data: 'menu:main' }]] },
      });
    } catch {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '◀️ Back', callback_data: 'menu:main' }]] },
      });
    }
    return;
  }

  // Format transactions
  let historyList = '';
  for (const tx of transactions) {
    const emoji = getTransactionEmoji(tx.type, tx.status);
    const date = new Date(tx.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    let details = '';
    if (tx.type === 'buy' || tx.type === 'sell') {
      const amount = tx.amountTokens ? formatNumber(tx.amountTokens) : '?';
      const sol = tx.amountSol ? tx.amountSol.toFixed(4) : '?';
      const symbol = tx.tokenSymbol || 'tokens';
      details = tx.type === 'buy'
        ? `${sol} SOL → ${amount} ${symbol}`
        : `${amount} ${symbol} → ${sol} SOL`;
    } else if (tx.type === 'withdraw' || tx.type === 'deposit') {
      details = `${tx.amountSol?.toFixed(4) || '?'} SOL`;
    }

    const statusText = tx.status === 'failed' ? ' ❌' : '';
    historyList += `${emoji} *${tx.type.toUpperCase()}*${statusText}\n`;
    historyList += `   ${details}\n`;
    historyList += `   _${date}_\n\n`;
  }

  const message = `
📜 *Transaction History*
_Page ${page} of ${totalPages}_

${historyList}
  `.trim();

  // Build pagination keyboard
  const navButtons: Array<{ text: string; callback_data: string }> = [];
  if (page > 1) {
    navButtons.push({ text: '◀️ Prev', callback_data: `history:${page - 1}` });
  }
  if (page < totalPages) {
    navButtons.push({ text: 'Next ▶️', callback_data: `history:${page + 1}` });
  }

  const keyboard = {
    inline_keyboard: [
      navButtons.length > 0 ? navButtons : [],
      [{ text: '◀️ Back', callback_data: 'menu:main' }],
    ].filter(row => row.length > 0),
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
 * Get emoji for transaction type.
 */
function getTransactionEmoji(type: string, status: string): string {
  if (status === 'failed') return '❌';
  switch (type) {
    case 'buy': return '🟢';
    case 'sell': return '🔴';
    case 'deposit': return '📥';
    case 'withdraw': return '📤';
    default: return '📝';
  }
}
