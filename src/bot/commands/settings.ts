/**
 * Settings command handlers.
 */

import { BotContext, getUserId, sendError } from '../bot.js';
import { db } from '../../services/database.js';
import {
  settingsMenuKeyboard,
  slippageOptionsKeyboard,
  backToMainKeyboard,
} from '../keyboards/menus.js';

// Default settings for new users
const DEFAULT_SETTINGS = {
  defaultBuySol: 0.1,
  defaultSlippage: 5,
  autoSlPercent: null,
  autoTpPercent: null,
  notificationsEnabled: true,
  dailyWithdrawLimitSol: 10,
  withdrawDelayMinutes: 0,
  largeWithdrawThresholdSol: 5,
};

/**
 * Show settings menu.
 */
export async function showSettingsMenu(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);

  // Get current settings or use defaults
  let settings = await db.getUserSettings(userId);
  if (!settings) {
    // Create default settings
    await db.upsertUserSettings({
      userId,
      ...DEFAULT_SETTINGS,
    });
    settings = { ...DEFAULT_SETTINGS, userId, createdAt: new Date() };
  }

  const autoSlText = settings.autoSlPercent ? `-${settings.autoSlPercent}%` : 'Disabled';
  const autoTpText = settings.autoTpPercent ? `+${settings.autoTpPercent}%` : 'Disabled';

  const message = `
⚙️ *Settings*

*Trading*
• Buy Amount: ${settings.defaultBuySol} SOL
• Slippage: ${settings.defaultSlippage}%
• Auto SL: ${autoSlText}
• Auto TP: ${autoTpText}

*Security*
• Daily Limit: ${settings.dailyWithdrawLimitSol} SOL
• Large Withdrawal Alert: ${settings.largeWithdrawThresholdSol} SOL

_Click a setting to change it._
  `.trim();

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: settingsMenuKeyboard(),
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: settingsMenuKeyboard(),
    });
  }
}

/**
 * Show buy amount options.
 */
export async function showBuyAmountSettings(ctx: BotContext): Promise<void> {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '0.05 SOL', callback_data: 'settings:set_buy:0.05' },
        { text: '0.1 SOL', callback_data: 'settings:set_buy:0.1' },
        { text: '0.25 SOL', callback_data: 'settings:set_buy:0.25' },
      ],
      [
        { text: '0.5 SOL', callback_data: 'settings:set_buy:0.5' },
        { text: '1 SOL', callback_data: 'settings:set_buy:1' },
        { text: '2 SOL', callback_data: 'settings:set_buy:2' },
      ],
      [
        { text: '✏️ Custom', callback_data: 'settings:custom_buy' },
      ],
      [
        { text: '« Back', callback_data: 'menu:settings' },
      ],
    ],
  };

  const message = `
💵 *Default Buy Amount*

Select the default SOL amount for buying tokens.

_This will be pre-selected when you buy tokens._
  `.trim();

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
 * Set buy amount.
 */
export async function setBuyAmount(ctx: BotContext, amount: number): Promise<void> {
  const userId = getUserId(ctx);

  try {
    await db.upsertUserSettings({
      userId,
      defaultBuySol: amount,
    });

    await ctx.answerCallbackQuery(`✅ Default buy amount set to ${amount} SOL`);
    await showSettingsMenu(ctx);
  } catch (error) {
    console.error('Error setting buy amount:', error);
    await sendError(ctx, 'Failed to save setting. Please try again.');
  }
}

/**
 * Show custom buy amount prompt.
 */
export async function showCustomBuyPrompt(ctx: BotContext): Promise<void> {
  ctx.session.state = 'awaiting_setting_value';
  ctx.session.pendingSetting = 'buy_amount';

  const message = `
💵 *Custom Buy Amount*

Enter your default buy amount in SOL (e.g., \`0.15\`).

_Min: 0.01 SOL, Max: 100 SOL_
  `.trim();

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

/**
 * Show slippage options.
 */
export async function showSlippageSettings(ctx: BotContext): Promise<void> {
  const message = `
📊 *Default Slippage*

Select your default slippage tolerance.

⚠️ _Higher slippage = faster trades but may get worse price_
🐢 _Lower slippage = better price but trades may fail_

*Recommended: 5-10% for memecoins*
  `.trim();

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: slippageOptionsKeyboard(),
    });
  } catch {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: slippageOptionsKeyboard(),
    });
  }
}

/**
 * Set slippage.
 */
export async function setSlippage(ctx: BotContext, slippage: number): Promise<void> {
  const userId = getUserId(ctx);

  try {
    await db.upsertUserSettings({
      userId,
      defaultSlippage: slippage,
    });

    await ctx.answerCallbackQuery(`✅ Default slippage set to ${slippage}%`);
    await showSettingsMenu(ctx);
  } catch (error) {
    console.error('Error setting slippage:', error);
    await sendError(ctx, 'Failed to save setting. Please try again.');
  }
}

/**
 * Show auto SL options.
 */
export async function showAutoSlSettings(ctx: BotContext): Promise<void> {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '-10%', callback_data: 'settings:set_auto_sl:10' },
        { text: '-15%', callback_data: 'settings:set_auto_sl:15' },
        { text: '-20%', callback_data: 'settings:set_auto_sl:20' },
      ],
      [
        { text: '-25%', callback_data: 'settings:set_auto_sl:25' },
        { text: '-30%', callback_data: 'settings:set_auto_sl:30' },
        { text: '-50%', callback_data: 'settings:set_auto_sl:50' },
      ],
      [
        { text: '🚫 Disable', callback_data: 'settings:set_auto_sl:0' },
      ],
      [
        { text: '« Back', callback_data: 'menu:settings' },
      ],
    ],
  };

  const message = `
🛑 *Auto Stop Loss*

Set automatic stop loss for all new trades.

_When enabled, a stop loss order will be created automatically after each buy._

Select a percentage below entry price:
  `.trim();

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
 * Set auto SL.
 */
export async function setAutoSl(ctx: BotContext, percent: number): Promise<void> {
  const userId = getUserId(ctx);

  try {
    await db.upsertUserSettings({
      userId,
      autoSlPercent: percent === 0 ? null : percent,
    });

    const text = percent === 0
      ? '✅ Auto Stop Loss disabled'
      : `✅ Auto Stop Loss set to -${percent}%`;

    await ctx.answerCallbackQuery(text);
    await showSettingsMenu(ctx);
  } catch (error) {
    console.error('Error setting auto SL:', error);
    await sendError(ctx, 'Failed to save setting. Please try again.');
  }
}

/**
 * Show auto TP options.
 */
export async function showAutoTpSettings(ctx: BotContext): Promise<void> {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '+25%', callback_data: 'settings:set_auto_tp:25' },
        { text: '+50%', callback_data: 'settings:set_auto_tp:50' },
        { text: '+100%', callback_data: 'settings:set_auto_tp:100' },
      ],
      [
        { text: '+150%', callback_data: 'settings:set_auto_tp:150' },
        { text: '+200%', callback_data: 'settings:set_auto_tp:200' },
        { text: '+500%', callback_data: 'settings:set_auto_tp:500' },
      ],
      [
        { text: '🚫 Disable', callback_data: 'settings:set_auto_tp:0' },
      ],
      [
        { text: '« Back', callback_data: 'menu:settings' },
      ],
    ],
  };

  const message = `
🎯 *Auto Take Profit*

Set automatic take profit for all new trades.

_When enabled, a take profit order will be created automatically after each buy._

Select a percentage above entry price:
  `.trim();

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
 * Set auto TP.
 */
export async function setAutoTp(ctx: BotContext, percent: number): Promise<void> {
  const userId = getUserId(ctx);

  try {
    await db.upsertUserSettings({
      userId,
      autoTpPercent: percent === 0 ? null : percent,
    });

    const text = percent === 0
      ? '✅ Auto Take Profit disabled'
      : `✅ Auto Take Profit set to +${percent}%`;

    await ctx.answerCallbackQuery(text);
    await showSettingsMenu(ctx);
  } catch (error) {
    console.error('Error setting auto TP:', error);
    await sendError(ctx, 'Failed to save setting. Please try again.');
  }
}

/**
 * Handle custom setting value input.
 */
export async function handleSettingValue(ctx: BotContext, value: string): Promise<void> {
  const userId = getUserId(ctx);
  const setting = ctx.session.pendingSetting;

  ctx.session.state = undefined;
  ctx.session.pendingSetting = undefined;

  if (!setting) {
    await sendError(ctx, 'Session expired. Please try again.');
    return;
  }

  const numValue = parseFloat(value);

  switch (setting) {
    case 'buy_amount':
      if (isNaN(numValue) || numValue < 0.01 || numValue > 100) {
        await ctx.reply('❌ Invalid amount. Please enter a number between 0.01 and 100.');
        return;
      }
      await db.upsertUserSettings({ userId, defaultBuySol: numValue });
      await ctx.reply(`✅ Default buy amount set to ${numValue} SOL`);
      break;

    case 'slippage':
      if (isNaN(numValue) || numValue < 0.1 || numValue > 50) {
        await ctx.reply('❌ Invalid slippage. Please enter a number between 0.1 and 50.');
        return;
      }
      await db.upsertUserSettings({ userId, defaultSlippage: numValue });
      await ctx.reply(`✅ Default slippage set to ${numValue}%`);
      break;

    case 'daily_limit':
      if (isNaN(numValue) || numValue < 0.1 || numValue > 1000) {
        await ctx.reply('❌ Invalid limit. Please enter a number between 0.1 and 1000.');
        return;
      }
      await db.upsertUserSettings({ userId, dailyWithdrawLimitSol: numValue });
      await ctx.reply(`✅ Daily withdrawal limit set to ${numValue} SOL`);
      break;

    case 'large_withdraw':
      if (isNaN(numValue) || numValue < 0.1 || numValue > 100) {
        await ctx.reply('❌ Invalid threshold. Please enter a number between 0.1 and 100.');
        return;
      }
      await db.upsertUserSettings({ userId, largeWithdrawThresholdSol: numValue });
      await ctx.reply(`✅ Large withdrawal threshold set to ${numValue} SOL`);
      break;

    default:
      await sendError(ctx, 'Unknown setting.');
  }
}

/**
 * Show withdrawal limit settings.
 */
export async function showWithdrawLimitSettings(ctx: BotContext): Promise<void> {
  const userId = getUserId(ctx);
  const settings = await db.getUserSettings(userId);

  const dailyLimit = settings?.dailyWithdrawLimitSol || 10;
  const largeThreshold = settings?.largeWithdrawThresholdSol || 5;

  // Get today's withdrawals
  const todayWithdrawals = await db.getTodayWithdrawals(userId);

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📊 Daily Limit', callback_data: 'settings:daily_limit' },
        { text: '🚨 Large Alert', callback_data: 'settings:large_withdraw' },
      ],
      [
        { text: '« Back', callback_data: 'menu:settings' },
      ],
    ],
  };

  const message = `
🔐 *Withdrawal Security*

*Daily Withdrawal Limit*
Maximum SOL you can withdraw per day.
Current: ${dailyLimit} SOL
Used today: ${todayWithdrawals.toFixed(4)} SOL
Remaining: ${(dailyLimit - todayWithdrawals).toFixed(4)} SOL

*Large Withdrawal Alert*
Extra warning for withdrawals above this amount.
Current: ${largeThreshold} SOL

_These limits protect your funds from unauthorized access._
  `.trim();

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
 * Show daily limit options.
 */
export async function showDailyLimitSettings(ctx: BotContext): Promise<void> {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '5 SOL', callback_data: 'settings:set_daily_limit:5' },
        { text: '10 SOL', callback_data: 'settings:set_daily_limit:10' },
        { text: '25 SOL', callback_data: 'settings:set_daily_limit:25' },
      ],
      [
        { text: '50 SOL', callback_data: 'settings:set_daily_limit:50' },
        { text: '100 SOL', callback_data: 'settings:set_daily_limit:100' },
        { text: 'No Limit', callback_data: 'settings:set_daily_limit:1000' },
      ],
      [
        { text: '✏️ Custom', callback_data: 'settings:custom_daily_limit' },
      ],
      [
        { text: '« Back', callback_data: 'settings:withdraw_limits' },
      ],
    ],
  };

  const message = `
📊 *Daily Withdrawal Limit*

Select the maximum amount of SOL you can withdraw per day.

_This resets at midnight UTC._
  `.trim();

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
 * Set daily withdrawal limit.
 */
export async function setDailyLimit(ctx: BotContext, limit: number): Promise<void> {
  const userId = getUserId(ctx);

  try {
    await db.upsertUserSettings({
      userId,
      dailyWithdrawLimitSol: limit,
    });

    const text = limit >= 1000
      ? '✅ Daily withdrawal limit removed'
      : `✅ Daily limit set to ${limit} SOL`;

    await ctx.answerCallbackQuery(text);
    await showWithdrawLimitSettings(ctx);
  } catch (error) {
    console.error('Error setting daily limit:', error);
    await sendError(ctx, 'Failed to save setting. Please try again.');
  }
}

/**
 * Show custom daily limit prompt.
 */
export async function showCustomDailyLimitPrompt(ctx: BotContext): Promise<void> {
  ctx.session.state = 'awaiting_setting_value';
  ctx.session.pendingSetting = 'daily_limit';

  const message = `
📊 *Custom Daily Limit*

Enter your daily withdrawal limit in SOL (e.g., \`15\`).

_Min: 0.1 SOL, Max: 1000 SOL_
  `.trim();

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

/**
 * Show large withdrawal threshold options.
 */
export async function showLargeWithdrawSettings(ctx: BotContext): Promise<void> {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '1 SOL', callback_data: 'settings:set_large_withdraw:1' },
        { text: '2 SOL', callback_data: 'settings:set_large_withdraw:2' },
        { text: '5 SOL', callback_data: 'settings:set_large_withdraw:5' },
      ],
      [
        { text: '10 SOL', callback_data: 'settings:set_large_withdraw:10' },
        { text: '25 SOL', callback_data: 'settings:set_large_withdraw:25' },
        { text: '50 SOL', callback_data: 'settings:set_large_withdraw:50' },
      ],
      [
        { text: '✏️ Custom', callback_data: 'settings:custom_large_withdraw' },
      ],
      [
        { text: '« Back', callback_data: 'settings:withdraw_limits' },
      ],
    ],
  };

  const message = `
🚨 *Large Withdrawal Alert*

Select the threshold for large withdrawal warnings.

_Withdrawals above this amount will show an extra warning._
  `.trim();

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
 * Set large withdrawal threshold.
 */
export async function setLargeWithdrawThreshold(ctx: BotContext, threshold: number): Promise<void> {
  const userId = getUserId(ctx);

  try {
    await db.upsertUserSettings({
      userId,
      largeWithdrawThresholdSol: threshold,
    });

    await ctx.answerCallbackQuery(`✅ Large withdrawal alert set to ${threshold} SOL`);
    await showWithdrawLimitSettings(ctx);
  } catch (error) {
    console.error('Error setting large withdraw threshold:', error);
    await sendError(ctx, 'Failed to save setting. Please try again.');
  }
}

/**
 * Show custom large withdrawal prompt.
 */
export async function showCustomLargeWithdrawPrompt(ctx: BotContext): Promise<void> {
  ctx.session.state = 'awaiting_setting_value';
  ctx.session.pendingSetting = 'large_withdraw';

  const message = `
🚨 *Custom Large Withdrawal Threshold*

Enter your large withdrawal threshold in SOL (e.g., \`3\`).

_Min: 0.1 SOL, Max: 100 SOL_
  `.trim();

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
