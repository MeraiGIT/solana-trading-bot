/**
 * Solana Trading Bot - Entry Point
 *
 * A custodial Solana trading bot with direct DEX integration.
 */

import { createBot } from './bot/bot.js';
import { handleStart } from './bot/commands/start.js';
import { handleCallback } from './bot/handlers/callback.js';
import { handleMessage } from './bot/handlers/message.js';
import { showPositions, showOrders, showTradeMenu, showHistory } from './bot/commands/trade.js';
import { PriceMonitor, LimitOrder, TriggerResult } from './trading/priceMonitor.js';
import { db } from './services/database.js';
import { WalletManager } from './wallet/manager.js';
import { appConfig } from './utils/env.js';

console.log('='.repeat(50));
console.log('  Solana Trading Bot');
console.log('  Version: 0.4.1');
console.log('='.repeat(50));

// Create bot instance
const bot = createBot();

// Create wallet manager for price monitor
const walletManager = new WalletManager(
  appConfig.masterEncryptionKey,
  appConfig.solanaRpcUrl
);

// Create price monitor for SL/TP execution
const priceMonitor = new PriceMonitor(db, walletManager, {
  checkIntervalMs: 30000, // Check every 30 seconds
  rpcUrl: appConfig.solanaRpcUrl,
  jupiterApiKey: appConfig.jupiterApiKey,
  heliusApiKey: appConfig.heliusApiKey,
  useJito: appConfig.useJito,
  onOrderTriggered: async (order: LimitOrder, result: TriggerResult) => {
    // Send notification to user
    try {
      const emoji = order.orderType === 'stop_loss' ? '🛑' : '🎯';
      const orderTypeName = order.orderType === 'stop_loss' ? 'Stop Loss' : 'Take Profit';

      let message = `${emoji} *${orderTypeName} Triggered!*\n\n`;

      if (result.success) {
        message += `✅ Order executed successfully!\n\n`;
        message += `*Sold:* ${parseFloat(result.soldAmount).toFixed(2)} ${result.tokenSymbol}\n`;
        message += `*Received:* ${parseFloat(result.receivedSol).toFixed(4)} SOL\n`;
        if (result.signature) {
          message += `\n[View on Solscan](https://solscan.io/tx/${result.signature})`;
        }
      } else {
        message += `❌ Order execution failed\n\n`;
        message += `Error: ${result.error || 'Unknown error'}`;
      }

      await bot.api.sendMessage(order.userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Failed to send order notification:', error);
    }
  },
  onError: (error: Error) => {
    console.error('Price monitor error:', error.message);
  },
});

// Register command handlers
bot.command('start', handleStart);
bot.command('help', async (ctx) => {
  await handleStart(ctx);
});
bot.command('wallet', async (ctx) => {
  const { showWalletMenu } = await import('./bot/commands/wallet.js');
  await showWalletMenu(ctx);
});
bot.command('trade', showTradeMenu);
bot.command('positions', showPositions);
bot.command('orders', showOrders);
bot.command('settings', async (ctx) => {
  const { showSettingsMenu } = await import('./bot/commands/settings.js');
  await showSettingsMenu(ctx);
});
bot.command('history', async (ctx) => {
  await showHistory(ctx);
});

// Register callback query handler
bot.on('callback_query:data', handleCallback);

// Register message handler
bot.on('message:text', handleMessage);

// Error handler
bot.catch((err) => {
  console.error('Bot error:', err);
});

// Start the bot
console.log('Starting bot...');

bot.start({
  onStart: async (botInfo) => {
    console.log(`✅ Bot started: @${botInfo.username}`);
    console.log('');

    // Register bot commands for Telegram menu
    await bot.api.setMyCommands([
      { command: 'start', description: 'Welcome and setup' },
      { command: 'wallet', description: 'Manage wallet (deposit, withdraw, export)' },
      { command: 'trade', description: 'Buy/sell tokens' },
      { command: 'positions', description: 'View your holdings' },
      { command: 'orders', description: 'Manage SL/TP orders' },
      { command: 'history', description: 'Transaction history' },
      { command: 'settings', description: 'Configure preferences' },
      { command: 'help', description: 'Get help' },
    ]);
    console.log('✅ Bot commands registered');

    // Start the price monitor for SL/TP execution
    priceMonitor.start();
    console.log('✅ Price monitor started (checking every 30s)');
    console.log('');
    console.log('Bot is ready to receive messages!');
  },
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  priceMonitor.stop();
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  priceMonitor.stop();
  bot.stop();
  process.exit(0);
});
