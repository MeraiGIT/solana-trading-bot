/**
 * Wallet command handlers.
 */

import { BotContext, getUserId, sendError } from '../bot.js';
import {
  walletMenuKeyboard,
  confirmCreateWalletKeyboard,
  backToMainKeyboard,
  cancelKeyboard,
} from '../keyboards/menus.js';
import { db } from '../../services/database.js';
import { WalletManager } from '../../wallet/manager.js';
import { appConfig } from '../../utils/env.js';
import { dailyLimits } from '../../utils/rateLimiter.js';
import { auditService, AuditAction } from '../../services/audit.js';
import { createLogger } from '../../utils/logger.js';
import QRCode from 'qrcode';
import { InputFile } from 'grammy';

const logger = createLogger('Wallet');

// Create wallet manager instance
const walletManager = new WalletManager(
  appConfig.masterEncryptionKey,
  appConfig.solanaRpcUrl
);

/**
 * Show wallet menu.
 */
export async function showWalletMenu(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);
  const hasWallet = await db.hasWallet(userId);

  let message: string;

  if (!hasWallet) {
    message = `
💰 *Wallet*

You don't have a wallet yet.

Choose an option to get started:
    `.trim();
  } else {
    const wallet = await db.getWallet(userId);
    if (!wallet) {
      message = '❌ Error loading wallet';
    } else {
      // Get SOL balance
      let balanceText = 'Loading...';
      let solUsdText = '';
      try {
        const balance = await walletManager.getBalance(wallet.publicAddress);
        balanceText = `${balance.sol.toFixed(4)} SOL`;

        // Fetch SOL price
        try {
          const { TokenInfoService } = await import('../../trading/tokenInfo.js');
          const tokenInfo = new TokenInfoService();
          const solInfo = await tokenInfo.getTokenInfo('So11111111111111111111111111111111111111112');
          if (solInfo) {
            solUsdText = ` (~$${(balance.sol * solInfo.priceUsd).toFixed(2)})`;
          }
        } catch {
          // Skip USD conversion
        }
      } catch {
        balanceText = 'Error fetching balance';
      }

      // Get token holdings
      let tokenText = '';
      try {
        const tokens = await walletManager.getAllTokenBalances(wallet.publicAddress);
        if (tokens && tokens.length > 0) {
          tokenText = '\n\n📊 *Token Holdings:*';
          const { TokenInfoService } = await import('../../trading/tokenInfo.js');
          const tokenInfo = new TokenInfoService();

          for (const token of tokens.slice(0, 5)) {
            try {
              const info = await tokenInfo.getTokenInfo(token.mint);
              const symbol = info?.symbol || token.mint.slice(0, 6) + '...';
              const usdVal = info ? token.amount * info.priceUsd : 0;
              tokenText += `\n• *${symbol}:* ${token.amount.toFixed(4)}`;
              if (usdVal > 0.01) {
                tokenText += ` (~$${usdVal.toFixed(2)})`;
              }
            } catch {
              tokenText += `\n• *${token.mint.slice(0, 6)}...:* ${token.amount.toFixed(4)}`;
            }
          }
          if (tokens.length > 5) {
            tokenText += `\n_... and ${tokens.length - 5} more_`;
          }
        }
      } catch {
        // Skip tokens on error
      }

      message = `
💰 *Your Wallet*

*Address:*
\`${wallet.publicAddress}\`

*Balance:* ${balanceText}${solUsdText}
${tokenText}
${wallet.isImported ? '\n📥 _Imported wallet_' : '\n🆕 _Generated wallet_'}
      `.trim();
    }
  }

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: walletMenuKeyboard(hasWallet),
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: walletMenuKeyboard(hasWallet),
    });
  }
}

/**
 * Show wallet creation confirmation.
 */
export async function showCreateWalletConfirm(ctx: BotContext): Promise<void> {
  const message = `
🆕 *Create New Wallet*

A new Solana wallet will be created for you.

⚠️ *Important:*
• Your private key will be encrypted and stored securely
• You can export your private key at any time
• Make sure to save your private key backup!

Ready to create your wallet?
  `.trim();

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: confirmCreateWalletKeyboard(),
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: confirmCreateWalletKeyboard(),
    });
  }
}

/**
 * Create a new wallet for the user.
 */
export async function createWallet(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);

  // Check if user already has a wallet
  if (await db.hasWallet(userId)) {
    await sendError(ctx, 'You already have a wallet!');
    return;
  }

  try {
    // Show loading message
    await ctx.editMessageText('⏳ Creating your wallet...');

    // Create wallet
    const { walletData, publicAddress } = walletManager.createWallet(userId);

    // Save to database
    const saved = await db.upsertWallet(walletData);

    if (!saved) {
      throw new Error('Failed to save wallet');
    }

    // Audit log: wallet created
    await auditService.logWalletCreate(userId, publicAddress, false);
    logger.info('Wallet created', { userId, publicAddress: publicAddress.slice(0, 8) + '...' });

    // Show success
    const message = `
✅ *Wallet Created!*

*Your Address:*
\`${publicAddress}\`

📥 *Deposit SOL to this address to start trading.*

⚠️ Remember to export and backup your private key!
    `.trim();

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: walletMenuKeyboard(true),
    });
  } catch (error) {
    logger.error('Error creating wallet', error, { userId });
    await sendError(ctx, 'Failed to create wallet. Please try again.');
  }
}

/**
 * Show import wallet prompt.
 */
export async function showImportWalletPrompt(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);

  // Check if user already has a wallet
  if (await db.hasWallet(userId)) {
    await sendError(ctx, 'You already have a wallet! Delete it first to import a new one.');
    return;
  }

  // Set state to awaiting private key
  ctx.session.state = 'awaiting_private_key';

  const message = `
📥 *Import Wallet*

Please send your *private key* in base58 format.

This is the format exported from Phantom and other Solana wallets.

⚠️ *Security Warning:*
Your private key will be encrypted and stored securely. However, be careful when sharing private keys - make sure you trust this bot!

Send your private key now, or click Cancel.
  `.trim();

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: cancelKeyboard('menu:wallet'),
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: cancelKeyboard('menu:wallet'),
    });
  }
}

/**
 * Handle private key import.
 */
export async function handlePrivateKeyImport(ctx: BotContext, privateKey: string): Promise<void> {
  const userId = getUserId(ctx);

  // Clear state
  ctx.session.state = undefined;

  // Validate private key format
  if (!WalletManager.isValidPrivateKey(privateKey)) {
    await sendError(ctx, 'Invalid private key format. Please check and try again.');
    return;
  }

  try {
    // Delete the message containing the private key for security
    try {
      await ctx.deleteMessage();
    } catch {
      // Ignore if can't delete
    }

    // Show loading
    const loadingMsg = await ctx.reply('⏳ Importing your wallet...');

    // Import wallet
    const { walletData, publicAddress } = walletManager.importWallet(userId, privateKey);

    // Save to database
    const saved = await db.upsertWallet(walletData);

    if (!saved) {
      throw new Error('Failed to save wallet');
    }

    // Delete loading message
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id);
    } catch {
      // Ignore
    }

    // Audit log: wallet imported
    await auditService.logWalletCreate(userId, publicAddress, true);
    logger.info('Wallet imported', { userId, publicAddress: publicAddress.slice(0, 8) + '...' });

    // Show success
    const message = `
✅ *Wallet Imported!*

*Your Address:*
\`${publicAddress}\`

Your wallet has been imported and encrypted securely.
    `.trim();

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: walletMenuKeyboard(true),
    });
  } catch (error) {
    logger.error('Error importing wallet', error, { userId });
    await sendError(ctx, 'Failed to import wallet. Please check your private key and try again.');
  }
}

/**
 * Show deposit address with QR code.
 */
export async function showDepositAddress(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);
  const wallet = await db.getWallet(userId);

  if (!wallet) {
    await sendError(ctx, 'You need to create a wallet first!');
    return;
  }

  const message = `
📥 *Deposit SOL*

Send SOL to this address:

\`${wallet.publicAddress}\`

_Tap the address to copy_

⚠️ Only send SOL on the Solana network!
  `.trim();

  try {
    // Generate QR code as buffer
    const qrBuffer = await QRCode.toBuffer(wallet.publicAddress, {
      type: 'png',
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    // Delete previous message if it was a callback
    try {
      await ctx.deleteMessage();
    } catch {
      // Ignore
    }

    // Send QR code image with caption
    await ctx.replyWithPhoto(new InputFile(qrBuffer, 'deposit-qr.png'), {
      caption: message,
      parse_mode: 'Markdown',
      reply_markup: walletMenuKeyboard(true),
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    // Fallback to text-only if QR fails
    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: backToMainKeyboard(),
      });
    } catch {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: backToMainKeyboard(),
      });
    }
  }
}

/**
 * Show balance.
 */
export async function showBalance(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);
  const wallet = await db.getWallet(userId);

  if (!wallet) {
    await sendError(ctx, 'You need to create a wallet first!');
    return;
  }

  try {
    // Show loading
    await ctx.editMessageText('⏳ Fetching balance...');

    const balance = await walletManager.getBalance(wallet.publicAddress);
    const tokens = await walletManager.getAllTokenBalances(wallet.publicAddress);

    // Fetch SOL price from DexScreener
    let solPrice = 150; // Default fallback
    try {
      const { TokenInfoService } = await import('../../trading/tokenInfo.js');
      const tokenInfo = new TokenInfoService();
      const solInfo = await tokenInfo.getTokenInfo('So11111111111111111111111111111111111111112');
      if (solInfo) {
        solPrice = solInfo.priceUsd;
      }
    } catch {
      // Use default price
    }

    const usdValue = balance.sol * solPrice;

    let message = `
💵 *Wallet Balance*

*SOL:* ${balance.sol.toFixed(4)} (~$${usdValue.toFixed(2)})

*Address:*
\`${wallet.publicAddress}\`
    `.trim();

    // Add token holdings if any
    if (tokens && tokens.length > 0) {
      message += `\n\n📊 *Token Holdings:*`;

      // Fetch token info for symbols
      const { TokenInfoService } = await import('../../trading/tokenInfo.js');
      const tokenInfo = new TokenInfoService();

      for (const token of tokens.slice(0, 5)) { // Show max 5 tokens
        try {
          const info = await tokenInfo.getTokenInfo(token.mint);
          const symbol = info?.symbol || token.mint.slice(0, 6) + '...';
          const usdVal = info ? token.amount * info.priceUsd : 0;
          message += `\n• *${symbol}:* ${token.amount.toFixed(4)}`;
          if (usdVal > 0) {
            message += ` (~$${usdVal.toFixed(2)})`;
          }
        } catch {
          message += `\n• *${token.mint.slice(0, 6)}...:* ${token.amount.toFixed(4)}`;
        }
      }

      if (tokens.length > 5) {
        message += `\n_... and ${tokens.length - 5} more tokens_`;
      }
    }

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: walletMenuKeyboard(true),
    });
  } catch (error) {
    console.error('Error fetching balance:', error);
    await sendError(ctx, 'Failed to fetch balance. Please try again.');
  }
}

/**
 * Refresh wallet balance.
 */
export async function refreshBalance(ctx: BotContext): Promise<void> {
  await showWalletMenu(ctx);
}

/**
 * Show export key confirmation.
 */
export async function showExportKeyConfirm(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);

  // Check rate limit for key exports (max 3 per 24 hours)
  const exportsRemaining = dailyLimits.keyExport.getMaxCount() - dailyLimits.keyExport.getCount(userId);
  const timeUntilReset = dailyLimits.keyExport.getTimeUntilReset(userId);

  if (exportsRemaining <= 0) {
    const hoursRemaining = Math.ceil(timeUntilReset / (60 * 60 * 1000));
    const message = `
🚫 *Export Limit Reached*

For your security, you can only export your private key *3 times* per 24 hours.

⏱️ Try again in approximately *${hoursRemaining} hour${hoursRemaining !== 1 ? 's' : ''}*.

If this is urgent, please contact support.
    `.trim();

    await auditService.logSecurityEvent(userId, AuditAction.RATE_LIMIT_EXCEEDED, {
      action: 'key_export',
      limit: 3,
      window: '24h',
    });

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: walletMenuKeyboard(true),
      });
    } catch {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: walletMenuKeyboard(true),
      });
    }
    return;
  }

  const message = `
🔑 *Export Private Key*

⚠️ *SECURITY WARNING:*
• Your private key gives *FULL ACCESS* to your wallet
• *NEVER* share it with anyone
• Store it in a *SECURE* offline location
• Anyone with your key can *STEAL ALL YOUR FUNDS*

🔒 *Security Notice:*
• Exports remaining today: *${exportsRemaining}/3*
• This action is logged for security

Are you absolutely sure you want to export your private key?
  `.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Yes, I Understand', callback_data: 'wallet:confirm_export' },
      ],
      [
        { text: '❌ Cancel', callback_data: 'menu:wallet' },
      ],
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
 * Export private key.
 */
export async function exportPrivateKey(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);
  const wallet = await db.getWallet(userId);

  if (!wallet) {
    await sendError(ctx, 'You need to create a wallet first!');
    return;
  }

  // Check and consume rate limit
  if (!dailyLimits.keyExport.record(userId)) {
    // This shouldn't happen if showExportKeyConfirm was called first, but double-check
    await showExportKeyConfirm(ctx);
    return;
  }

  try {
    // Export private key
    const privateKey = walletManager.exportPrivateKey(wallet);

    // Audit log: private key exported (CRITICAL security event)
    await auditService.logWalletExport(userId, wallet.publicAddress);
    logger.warn('Private key exported', {
      userId,
      publicAddress: wallet.publicAddress.slice(0, 8) + '...',
      remainingExports: dailyLimits.keyExport.getMaxCount() - dailyLimits.keyExport.getCount(userId),
    });

    // Send in a new message that will auto-delete hint
    const message = `
🔑 *Your Private Key*

\`${privateKey}\`

⚠️ *IMPORTANT:*
• Save this securely and *DELETE THIS MESSAGE*
• This key gives *FULL ACCESS* to your wallet
• Never share it with anyone

🔒 This export has been logged for security.
    `.trim();

    // Delete previous message
    try {
      await ctx.deleteMessage();
    } catch {
      // Ignore
    }

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: walletMenuKeyboard(true),
    });
  } catch (error) {
    logger.error('Error exporting key', error, { userId });
    await sendError(ctx, 'Failed to export private key. Please try again.');
  }
}

/**
 * Show delete wallet confirmation.
 */
export async function showDeleteWalletConfirm(ctx: BotContext): Promise<void> {
  const message = `
🗑️ *Delete Wallet*

⚠️ *WARNING:*
• This will permanently delete your wallet from the bot
• Make sure you have exported and saved your private key first!
• You will need to create a new wallet or import one to continue trading

Are you sure you want to delete your wallet?
  `.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Yes, Delete', callback_data: 'wallet:confirm_delete' },
        { text: '❌ Cancel', callback_data: 'menu:wallet' },
      ],
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
 * Delete wallet.
 */
export async function deleteWallet(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);

  // Get wallet first for audit logging
  const wallet = await db.getWallet(userId);
  const publicAddress = wallet?.publicAddress || 'unknown';

  try {
    // Delete from database
    const deleted = await db.deleteWallet(userId);

    if (!deleted) {
      throw new Error('Failed to delete wallet');
    }

    // Audit log: wallet deleted
    await auditService.logWalletDelete(userId, publicAddress);
    logger.info('Wallet deleted', { userId, publicAddress: publicAddress.slice(0, 8) + '...' });

    const message = `
✅ *Wallet Deleted*

Your wallet has been removed from the bot.

You can now create a new wallet or import an existing one.
    `.trim();

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: walletMenuKeyboard(false),
    });
  } catch (error) {
    logger.error('Error deleting wallet', error, { userId });
    await sendError(ctx, 'Failed to delete wallet. Please try again.');
  }
}

/**
 * Show withdraw prompt.
 */
export async function showWithdrawPrompt(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);

  if (!(await db.hasWallet(userId))) {
    await sendError(ctx, 'You need to create a wallet first!');
    return;
  }

  ctx.session.state = 'awaiting_withdraw_address';

  const message = `
📤 *Withdraw SOL*

Please send the *destination address* where you want to withdraw your SOL.
  `.trim();

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: cancelKeyboard('menu:wallet'),
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: cancelKeyboard('menu:wallet'),
    });
  }
}
