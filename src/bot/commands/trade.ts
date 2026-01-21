/**
 * Trade command handlers for buying and selling tokens.
 */

import { BotContext, getUserId, sendError } from '../bot.js';
import { db } from '../../services/database.js';
import { DexRouter, TokenInfo, formatPrice, formatNumber } from '../../trading/index.js';
import { WalletManager } from '../../wallet/manager.js';
import { appConfig } from '../../utils/env.js';

/**
 * Escape special Markdown characters to prevent parsing errors.
 * Use this for any user-controlled or dynamic content in messages.
 */
function escapeMarkdown(text: string): string {
  if (!text) return '';
  // Escape Markdown special characters: * _ [ ] ( ) ~ ` > # + - = | { } . !
  return text.replace(/([*_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Translate Jupiter/DEX API errors to user-friendly messages.
 * Returns both a friendly message and actionable advice.
 */
function translateTradeError(error: string): { message: string; advice: string; isRetryable: boolean } {
  const lowerError = error.toLowerCase();

  // No route found - token has no liquidity
  if (lowerError.includes('could not find any route') || lowerError.includes('no route found')) {
    return {
      message: 'No swap route available',
      advice: 'This token may have no liquidity or has been rugged. Check the token on Solscan or DexScreener.',
      isRetryable: false
    };
  }

  // Shared accounts / AMM not supported
  if (lowerError.includes('simple amms are not supported') || lowerError.includes('shared accounts')) {
    return {
      message: 'Token swap not supported',
      advice: 'This token uses an AMM type that Jupiter cannot swap. The pool may be inactive or incompatible.',
      isRetryable: false
    };
  }

  // Slippage exceeded
  if (lowerError.includes('slippage') || lowerError.includes('price moved')) {
    return {
      message: 'Price moved too much',
      advice: 'The price changed during the swap. Try again with higher slippage or a smaller amount.',
      isRetryable: true
    };
  }

  // Insufficient balance
  if (lowerError.includes('insufficient') || lowerError.includes('not enough')) {
    return {
      message: 'Insufficient balance',
      advice: 'Check your wallet balance and try again.',
      isRetryable: false
    };
  }

  // Transaction expired
  if (lowerError.includes('block height exceeded') || lowerError.includes('expired')) {
    return {
      message: 'Transaction timed out',
      advice: 'Network is congested. Please try again.',
      isRetryable: true
    };
  }

  // Simulation failed
  if (lowerError.includes('simulation failed')) {
    return {
      message: 'Transaction simulation failed',
      advice: 'The transaction would fail on-chain. Try with different settings.',
      isRetryable: true
    };
  }

  // Default: unknown error
  return {
    message: 'Transaction failed',
    advice: escapeMarkdown(error),
    isRetryable: true
  };
}

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

  // Step 2: Check balance using lamports (integers) for accurate comparison
  let balance;
  const FEE_RESERVE_LAMPORTS = 10_000_000; // 0.01 SOL reserved for fees
  try {
    balance = await walletManager.getBalance(wallet.publicAddress);
    // Convert to lamports for integer comparison (avoids floating-point errors)
    const balanceLamports = Math.floor(balance.sol * 1e9);
    const requiredLamports = Math.floor(solAmount * 1e9) + FEE_RESERVE_LAMPORTS;

    if (balanceLamports < requiredLamports) {
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
      // Convert raw token amount to human-readable (divide by 10^decimals)
      const decimals = tokenInfo?.decimals ?? 9;
      const tokensReceivedRaw = result.outputAmount ? Number(result.outputAmount) : 0;
      const tokensReceived = tokensReceivedRaw / Math.pow(10, decimals);

      // Step 5: Update - saving position
      await updateStatusMessage(
        ctx,
        statusMsgId,
        `⏳ *Finalizing...*\n\n` +
        `✅ Transaction confirmed!\n` +
        `📝 Verifying on-chain balance...`
      );

      // Wait briefly for chain state to settle, then verify actual balance
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Invalidate cache and fetch real on-chain balance
      walletManager.invalidateTokenBalanceCache(wallet.publicAddress, tokenAddress);
      const verifiedBalance = await walletManager.getTokenBalance(
        wallet.publicAddress,
        tokenAddress,
        false // Fresh fetch
      );

      // Use verified on-chain balance if available, otherwise fall back to Jupiter estimate
      const finalTokenAmount = verifiedBalance?.amount ?? tokensReceived;
      const finalDecimals = verifiedBalance?.decimals ?? decimals;

      // Log if there's a discrepancy (for debugging)
      if (verifiedBalance && Math.abs(verifiedBalance.amount - tokensReceived) > 0.01) {
        console.log(`Buy verification: Jupiter estimate=${tokensReceived}, On-chain=${verifiedBalance.amount}`);
      }

      // Save position to database with verified amount
      if (tokenInfo) {
        await db.upsertPosition({
          userId,
          tokenAddress,
          tokenSymbol: tokenInfo.symbol,
          tokenDecimals: finalDecimals,
          amount: finalTokenAmount, // Use verified on-chain amount
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
*Received:* ${formatNumber(finalTokenAmount)} tokens
*Price:* ${formatPrice(tokenInfo?.priceUsd || 0)}
*DEX:* ${dexName}

${shortSig ? `*Tx:* \`${shortSig}\`\n[View on Solscan](https://solscan.io/tx/${result.signature})` : ''}

━━━━━━━━━━━━━━━━━━
📊 *Position Created*
Entry: ${formatPrice(tokenInfo?.priceUsd || 0)}
Holdings: ${formatNumber(finalTokenAmount)} ${tokenInfo?.symbol || 'tokens'}
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

      const errorInfo = translateTradeError(result.error || 'Transaction failed');
      const buttons = errorInfo.isRetryable
        ? [
            [{ text: '🔄 Try Again', callback_data: `token:${tokenAddress}` }],
            [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
          ]
        : [
            [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
          ];

      await updateStatusMessage(
        ctx,
        statusMsgId,
        `❌ *Buy Failed*\n\n*${errorInfo.message}*\n\n${errorInfo.advice}`,
        { inline_keyboard: buttons }
      );
    }
  } catch (error) {
    console.error('Buy error:', error);
    const errorInfo = translateTradeError((error as Error).message);
    const buttons = errorInfo.isRetryable
      ? [
          [{ text: '🔄 Try Again', callback_data: `token:${tokenAddress}` }],
          [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
        ]
      : [
          [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
        ];

    await updateStatusMessage(
      ctx,
      statusMsgId,
      `❌ *Error*\n\n*${errorInfo.message}*\n\n${errorInfo.advice}`,
      { inline_keyboard: buttons }
    );
  }
}

/**
 * Show user positions.
 * Reconciles on-chain balances with database positions.
 * Shows all tokens held on-chain, creating missing DB positions as needed.
 */
export async function showPositions(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);

  const wallet = await db.getWallet(userId);
  if (!wallet) {
    const message = `
📊 *Your Positions*

_No wallet found. Use /wallet to create one._
    `.trim();

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '💰 Wallet', callback_data: 'menu:wallet' }], [{ text: '◀️ Back', callback_data: 'menu:main' }]],
        },
      });
    } catch {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '💰 Wallet', callback_data: 'menu:wallet' }], [{ text: '◀️ Back', callback_data: 'menu:main' }]],
        },
      });
    }
    return;
  }

  // Get database positions
  const dbPositions = await db.getPositions(userId);
  const dbPositionMap = new Map(dbPositions.map(p => [p.tokenAddress, p]));

  // Fetch ALL on-chain token balances
  let onChainTokens: Array<{ mint: string; amount: number; decimals: number }> = [];
  try {
    onChainTokens = await walletManager.getAllTokenBalances(wallet.publicAddress);
  } catch (error) {
    console.error('Error fetching on-chain balances:', error);
  }

  // Build unified positions list: on-chain tokens + DB metadata
  const displayPositions: Array<{
    tokenAddress: string;
    tokenSymbol: string;
    amount: number;
    entryPriceUsd: number;
    currentPrice: number;
    decimals: number;
    fromDb: boolean;
  }> = [];

  // Process on-chain tokens and reconcile with DB
  for (const token of onChainTokens) {
    // Skip zero or dust amounts (tokens with tiny balances that display as "0.00")
    if (token.amount <= 0.0001) continue;

    const dbPos = dbPositionMap.get(token.mint);

    // Get current token info from DexScreener
    let tokenInfo = null;
    try {
      tokenInfo = await router.getTokenInfo(token.mint);
    } catch {
      // Continue without token info
    }

    const symbol = tokenInfo?.symbol || dbPos?.tokenSymbol || token.mint.slice(0, 6) + '...';
    const currentPrice = tokenInfo?.priceUsd || 0;
    const entryPrice = dbPos?.entryPriceUsd || currentPrice; // Use current as entry if unknown

    displayPositions.push({
      tokenAddress: token.mint,
      tokenSymbol: symbol,
      amount: token.amount,
      entryPriceUsd: entryPrice,
      currentPrice: currentPrice,
      decimals: token.decimals,
      fromDb: !!dbPos,
    });

    // If token exists on-chain but not in DB, create a position record
    if (!dbPos && tokenInfo) {
      await db.upsertPosition({
        userId,
        tokenAddress: token.mint,
        tokenSymbol: symbol,
        tokenDecimals: token.decimals,
        amount: token.amount,
        entryPriceUsd: currentPrice, // Use current price as entry (since we don't know real entry)
        entrySol: null,
      });
    } else if (dbPos && Math.abs(dbPos.amount - token.amount) > 0.01) {
      // Sync DB amount with on-chain if different
      await db.upsertPosition({
        ...dbPos,
        amount: token.amount,
      });
    }

    // Remove from map so we know which DB positions are stale
    dbPositionMap.delete(token.mint);
  }

  // NOTE: We no longer auto-delete DB positions that aren't found on-chain.
  // This was causing data loss when RPC had temporary issues.
  // Users can manually remove stale positions if needed.
  // Log stale positions for debugging.
  if (dbPositionMap.size > 0) {
    const staleAddresses = Array.from(dbPositionMap.keys());
    console.log(`Found ${staleAddresses.length} DB positions not on-chain (not deleting):`, staleAddresses.map(a => a.slice(0, 8) + '...'));
  }

  if (displayPositions.length === 0) {
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

  // Build positions list with PnL
  let positionsList = '';
  const buttons: { text: string; callback_data: string }[][] = [];

  for (const pos of displayPositions.slice(0, 5)) { // Show max 5
    const pnlPercent = pos.entryPriceUsd > 0
      ? ((pos.currentPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100
      : 0;
    const pnlEmoji = pnlPercent >= 0 ? '🟢' : '🔴';
    const pnlText = pnlPercent >= 0 ? `+${pnlPercent.toFixed(2)}%` : `${pnlPercent.toFixed(2)}%`;
    const safeSymbol = escapeMarkdown(pos.tokenSymbol);

    // Show indicator if position was auto-discovered (not in original DB)
    const newIndicator = !pos.fromDb ? ' 🆕' : '';

    positionsList += `\n*${safeSymbol}*${newIndicator}\n`;
    positionsList += `  Amount: ${formatNumber(pos.amount)}\n`;
    positionsList += `  Entry: ${formatPrice(pos.entryPriceUsd)}\n`;
    positionsList += `  Current: ${formatPrice(pos.currentPrice)}\n`;
    positionsList += `  PnL: ${pnlEmoji} ${pnlText}\n`;

    buttons.push([
      { text: `📈 ${pos.tokenSymbol}`, callback_data: `sell:${pos.tokenAddress}` },
    ]);
  }

  const message = `
📊 *Your Positions*
${positionsList}
Select a position to sell or manage:
  `.trim();

  buttons.push([{ text: '🔄 Refresh', callback_data: 'trade:positions' }]);
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
 * Uses real on-chain balance for display.
 */
export async function showSellOptions(ctx: BotContext, tokenAddress: string): Promise<void> {
  const userId = getUserId(ctx);

  const wallet = await db.getWallet(userId);
  const position = await db.getPosition(userId, tokenAddress);
  if (!position || !wallet) {
    await sendError(ctx, 'Position or wallet not found.');
    return;
  }

  // Fetch real on-chain balance
  let onChainBalance;
  try {
    onChainBalance = await walletManager.getTokenBalance(
      wallet.publicAddress,
      tokenAddress
    );
  } catch (error) {
    console.error('Error fetching on-chain balance:', error);
    // Use database amount as fallback instead of erroring out
    onChainBalance = { amount: position.amount, decimals: position.tokenDecimals || 9 };
  }

  // If no tokens on-chain, warn but DON'T delete position automatically
  if (!onChainBalance || onChainBalance.amount <= 0) {
    await sendError(ctx, 'No tokens found on-chain. If you believe this is an error, refresh and try again.');
    return;
  }

  // Use on-chain balance for display
  const displayAmount = onChainBalance.amount;

  const info = await router.getTokenInfo(tokenAddress);
  const currentPrice = info?.priceUsd || 0;
  const entryPrice = position.entryPriceUsd || 0;
  const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

  const safeSymbol = escapeMarkdown(position.tokenSymbol || 'Token');

  // Show warning if DB differs from on-chain
  const balanceMismatch = Math.abs(position.amount - displayAmount) > 0.01;
  const mismatchWarning = balanceMismatch
    ? `\n⚠️ _Balance synced from blockchain_`
    : '';

  const message = `
📤 *Sell ${safeSymbol}*

*Holdings:* ${formatNumber(displayAmount)}${mismatchWarning}
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
 * CRITICAL: Uses real on-chain balance, not database amount.
 */
export async function handleSell(
  ctx: BotContext,
  percentage: number,
  tokenAddress: string
): Promise<void> {
  const userId = getUserId(ctx);

  // Validate percentage bounds (0-100)
  if (percentage <= 0 || percentage > 100 || !Number.isFinite(percentage)) {
    await sendError(ctx, 'Invalid sell percentage. Must be between 1 and 100.');
    return;
  }

  // Get wallet and position
  const wallet = await db.getWallet(userId);
  const position = await db.getPosition(userId, tokenAddress);

  if (!wallet || !position) {
    await sendError(ctx, 'Wallet or position not found.');
    return;
  }

  // CRITICAL: Fetch REAL on-chain balance instead of using database amount
  let onChainBalance;
  try {
    onChainBalance = await walletManager.getTokenBalance(
      wallet.publicAddress,
      tokenAddress,
      false // Don't use cache - we need fresh data for sells
    );
  } catch (error) {
    // Network error - don't delete position, just report error
    console.error('Error fetching on-chain balance for sell:', error);
    await sendError(ctx, 'Failed to fetch on-chain balance. Please try again.');
    return;
  }

  // If no tokens on-chain, warn but DON'T delete position automatically
  // (user might have network issues or RPC might be stale)
  if (!onChainBalance || onChainBalance.amount <= 0) {
    await sendError(ctx, 'No tokens found on-chain. If you believe this is an error, check your wallet on Solscan.');
    return;
  }

  // Use on-chain balance and decimals for sell calculation
  const sellAmount = (onChainBalance.amount * percentage) / 100;
  const decimals = onChainBalance.decimals;
  const safeSymbol = escapeMarkdown(position.tokenSymbol || 'tokens');

  // Log if there's a mismatch between DB and on-chain (for debugging)
  if (Math.abs(position.amount - onChainBalance.amount) > 0.01) {
    console.log(`Balance mismatch for ${tokenAddress}: DB=${position.amount}, On-chain=${onChainBalance.amount}`);
  }

  // Show selling message
  await ctx.editMessageText(
    `⏳ *Selling ${percentage}%...*\n\nSelling ${formatNumber(sellAmount)} ${safeSymbol}...\n\n_Please wait..._`,
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

      // Invalidate cache after sell
      walletManager.invalidateTokenBalanceCache(wallet.publicAddress, tokenAddress);

      // Wait briefly for chain state to settle, then sync with on-chain balance
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Fetch actual remaining balance from chain (not calculated from DB)
      const remainingBalance = await walletManager.getTokenBalance(
        wallet.publicAddress,
        tokenAddress,
        false // Fresh fetch
      );

      // Update or delete position based on actual on-chain balance
      if (!remainingBalance || remainingBalance.amount <= 0.0001) {
        await db.deletePosition(userId, tokenAddress);
        // Cancel any active orders for this position
        await db.cancelOrdersForPosition(position.id);
      } else {
        await db.upsertPosition({
          ...position,
          amount: remainingBalance.amount, // Sync with actual on-chain balance
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

*Sold:* ${formatNumber(sellAmount)} ${safeSymbol}
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

      const errorInfo = translateTradeError(result.error || 'Transaction failed');
      const buttons = errorInfo.isRetryable
        ? [
            [{ text: '🔄 Try Again', callback_data: `sell:${tokenAddress}` }],
            [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
          ]
        : [
            [{ text: '📊 View Positions', callback_data: 'trade:positions' }],
            [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
          ];

      await ctx.editMessageText(
        `❌ *Sell Failed*\n\n*${errorInfo.message}*\n\n${errorInfo.advice}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: buttons,
          },
        }
      );
    }
  } catch (error) {
    console.error('Sell error:', error);
    const errorInfo = translateTradeError((error as Error).message);
    const buttons = errorInfo.isRetryable
      ? [
          [{ text: '🔄 Try Again', callback_data: `sell:${tokenAddress}` }],
          [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
        ]
      : [
          [{ text: '📊 View Positions', callback_data: 'trade:positions' }],
          [{ text: '🏠 Main Menu', callback_data: 'menu:main' }],
        ];

    await ctx.editMessageText(
      `❌ *Error*\n\n*${errorInfo.message}*\n\n${errorInfo.advice}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: buttons,
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
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '◀️ Back', callback_data: 'menu:main' }]],
        },
      });
    }
    return;
  }

  let ordersList = '';
  const buttons: { text: string; callback_data: string }[][] = [];

  for (const order of orders) {
    const typeEmoji = order.orderType === 'stop_loss' ? '🛑' : '🎯';
    const typeName = order.orderType === 'stop_loss' ? 'Stop Loss' : 'Take Profit';
    const safeSymbol = escapeMarkdown(order.tokenSymbol || 'Unknown');

    // Get current price for comparison
    let currentPrice = 0;
    if (order.tokenAddress) {
      const info = await router.getTokenInfo(order.tokenAddress);
      currentPrice = info?.priceUsd || 0;
    }

    // Calculate distance to trigger
    const distancePercent = currentPrice > 0
      ? ((order.triggerPrice - currentPrice) / currentPrice) * 100
      : 0;
    const distanceText = distancePercent >= 0
      ? `+${distancePercent.toFixed(1)}%`
      : `${distancePercent.toFixed(1)}%`;

    ordersList += `\n${typeEmoji} *${typeName}* - ${safeSymbol}\n`;
    ordersList += `  📍 Trigger: ${formatPrice(order.triggerPrice)}\n`;
    ordersList += `  💰 Current: ${formatPrice(currentPrice)} (${distanceText})\n`;
    if (order.entryPriceUsd) {
      ordersList += `  📈 Entry: ${formatPrice(order.entryPriceUsd)}\n`;
    }
    ordersList += `  📊 Sell: ${order.sellPercentage}%`;
    if (order.positionAmount) {
      const sellAmount = (order.positionAmount * order.sellPercentage) / 100;
      ordersList += ` (${formatNumber(sellAmount)} tokens)`;
    }
    ordersList += '\n';

    // Button text doesn't need escaping
    const buttonSymbol = order.tokenSymbol || 'Unknown';
    buttons.push([
      { text: `❌ Cancel ${buttonSymbol} ${typeName}`, callback_data: `cancel_order:${order.id}` },
    ]);
  }

  const message = `
📋 *Active Orders*
${ordersList}
_Orders will trigger automatically when price conditions are met._
  `.trim();

  buttons.push([{ text: '📊 Positions', callback_data: 'trade:positions' }]);
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
