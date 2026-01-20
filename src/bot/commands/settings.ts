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

    default:
      await sendError(ctx, 'Unknown setting.');
  }
}
