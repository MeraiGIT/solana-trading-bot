/**
 * Grammy bot setup and initialization.
 */

import { Bot, Context, session, SessionFlavor } from 'grammy';
import { appConfig } from '../utils/env.js';

/**
 * Trade token data stored in session.
 */
interface TradeToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
}

/**
 * Session data structure.
 */
interface SessionData {
  // Current state for multi-step operations
  state?:
    | 'awaiting_token'
    | 'awaiting_amount'
    | 'awaiting_private_key'
    | 'awaiting_withdraw_address'
    | 'awaiting_withdraw_amount'
    | 'awaiting_withdraw_confirm'
    | 'awaiting_buy_amount'
    | 'awaiting_sl_price'
    | 'awaiting_tp_price'
    | 'awaiting_setting_value';

  // Temporary data for operations
  pendingToken?: string;
  pendingAmount?: number;

  // Trade operation data
  tradeToken?: TradeToken;

  // Withdraw operation data
  withdrawAddress?: string;
  withdrawAmount?: number;

  // Settings operation data
  pendingSetting?: 'buy_amount' | 'slippage' | 'auto_sl' | 'auto_tp' | 'daily_limit' | 'large_withdraw';
}

/**
 * Custom context with session.
 */
export type BotContext = Context & SessionFlavor<SessionData>;

/**
 * Create and configure the bot instance.
 */
export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(appConfig.botToken);

  // Install session middleware
  bot.use(session({
    initial: (): SessionData => ({}),
  }));

  // Error handler
  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  return bot;
}

/**
 * Get user ID from context.
 */
export function getUserId(ctx: BotContext): string {
  return String(ctx.from?.id || '');
}

/**
 * Send error message to user.
 */
export async function sendError(ctx: BotContext, message: string): Promise<void> {
  await ctx.reply(`❌ ${message}`);
}

/**
 * Send success message to user.
 */
export async function sendSuccess(ctx: BotContext, message: string): Promise<void> {
  await ctx.reply(`✅ ${message}`);
}
