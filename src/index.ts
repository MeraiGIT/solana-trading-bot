/**
 * Solana Trading Bot - Entry Point
 *
 * A custodial Solana trading bot with direct DEX integration.
 */

import { createBot, BotContext } from './bot/bot.js';
import { handleStart } from './bot/commands/start.js';
import { handleCallback } from './bot/handlers/callback.js';
import { handleMessage } from './bot/handlers/message.js';

console.log('='.repeat(50));
console.log('  Solana Trading Bot');
console.log('  Version: 0.1.0');
console.log('='.repeat(50));

// Create bot instance
const bot = createBot();

// Register command handlers
bot.command('start', handleStart);
bot.command('help', async (ctx) => {
  await handleStart(ctx);
});
bot.command('wallet', async (ctx) => {
  const { showWalletMenu } = await import('./bot/commands/wallet.js');
  await showWalletMenu(ctx);
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
  onStart: (botInfo) => {
    console.log(`✅ Bot started: @${botInfo.username}`);
    console.log('');
    console.log('Bot is ready to receive messages!');
  },
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\\nShutting down...');
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\\nShutting down...');
  bot.stop();
  process.exit(0);
});
