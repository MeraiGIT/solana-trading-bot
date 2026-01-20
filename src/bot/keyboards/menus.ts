/**
 * Inline keyboard builders for bot menus.
 */

import { InlineKeyboard } from 'grammy';

/**
 * Main menu keyboard.
 */
export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('💰 Wallet', 'menu:wallet')
    .text('📈 Trade', 'menu:trade')
    .row()
    .text('📊 Positions', 'menu:positions')
    .text('📋 Orders', 'menu:orders')
    .row()
    .text('📜 History', 'menu:history')
    .row()
    .text('⚙️ Settings', 'menu:settings')
    .text('❓ Help', 'menu:help');
}

/**
 * Wallet menu keyboard.
 */
export function walletMenuKeyboard(hasWallet: boolean): InlineKeyboard {
  if (!hasWallet) {
    return new InlineKeyboard()
      .text('🆕 Create Wallet', 'wallet:create')
      .text('📥 Import Wallet', 'wallet:import')
      .row()
      .text('« Back', 'menu:main');
  }

  return new InlineKeyboard()
    .text('💵 Balance', 'wallet:balance')
    .text('📥 Deposit', 'wallet:deposit')
    .row()
    .text('📤 Withdraw', 'wallet:withdraw')
    .text('🔑 Export Key', 'wallet:export')
    .row()
    .text('🗑️ Delete Wallet', 'wallet:delete')
    .text('🔄 Refresh', 'wallet:refresh')
    .row()
    .text('« Back', 'menu:main');
}

/**
 * Confirm wallet creation keyboard.
 */
export function confirmCreateWalletKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Create Wallet', 'wallet:confirm_create')
    .text('❌ Cancel', 'menu:wallet');
}

/**
 * Trade menu keyboard.
 */
export function tradeMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🟢 Buy Token', 'trade:buy')
    .text('🔴 Sell Token', 'trade:sell')
    .row()
    .text('« Back', 'menu:main');
}

/**
 * Buy amount selection keyboard.
 */
export function buyAmountKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('0.1 SOL', 'buy:amount:0.1')
    .text('0.5 SOL', 'buy:amount:0.5')
    .text('1 SOL', 'buy:amount:1')
    .row()
    .text('2 SOL', 'buy:amount:2')
    .text('5 SOL', 'buy:amount:5')
    .text('✏️ Custom', 'buy:amount:custom')
    .row()
    .text('❌ Cancel', 'menu:trade');
}

/**
 * Confirm buy keyboard.
 */
export function confirmBuyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ CONFIRM BUY', 'buy:confirm')
    .text('❌ Cancel', 'menu:trade');
}

/**
 * Sell percentage keyboard.
 */
export function sellPercentageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('25%', 'sell:percent:25')
    .text('50%', 'sell:percent:50')
    .text('100%', 'sell:percent:100')
    .row()
    .text('❌ Cancel', 'menu:positions');
}

/**
 * Confirm sell keyboard.
 */
export function confirmSellKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ CONFIRM SELL', 'sell:confirm')
    .text('❌ Cancel', 'menu:positions');
}

/**
 * Position actions keyboard.
 */
export function positionActionsKeyboard(positionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔴 Sell', `position:sell:${positionId}`)
    .text('⚙️ SL/TP', `position:sltp:${positionId}`)
    .row()
    .text('« Back', 'menu:positions');
}

/**
 * SL/TP setup keyboard.
 */
export function slTpKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🛑 Stop Loss', 'sltp:sl')
    .text('🎯 Take Profit', 'sltp:tp')
    .row()
    .text('« Back', 'menu:positions');
}

/**
 * Stop loss percentage options.
 */
export function stopLossOptionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('-10%', 'sl:percent:10')
    .text('-20%', 'sl:percent:20')
    .text('-30%', 'sl:percent:30')
    .row()
    .text('-50%', 'sl:percent:50')
    .text('✏️ Custom', 'sl:custom')
    .row()
    .text('❌ Cancel', 'menu:positions');
}

/**
 * Take profit percentage options.
 */
export function takeProfitOptionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('+25%', 'tp:percent:25')
    .text('+50%', 'tp:percent:50')
    .text('+100%', 'tp:percent:100')
    .row()
    .text('+200%', 'tp:percent:200')
    .text('✏️ Custom', 'tp:custom')
    .row()
    .text('❌ Cancel', 'menu:positions');
}

/**
 * Settings menu keyboard.
 */
export function settingsMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('💵 Default Buy Amount', 'settings:buy_amount')
    .row()
    .text('📊 Default Slippage', 'settings:slippage')
    .row()
    .text('🛑 Auto Stop Loss', 'settings:auto_sl')
    .row()
    .text('🎯 Auto Take Profit', 'settings:auto_tp')
    .row()
    .text('🔐 Withdrawal Limits', 'settings:withdraw_limits')
    .row()
    .text('« Back', 'menu:main');
}

/**
 * Slippage options keyboard.
 */
export function slippageOptionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('1%', 'settings:slippage:1')
    .text('3%', 'settings:slippage:3')
    .text('5%', 'settings:slippage:5')
    .row()
    .text('10%', 'settings:slippage:10')
    .text('15%', 'settings:slippage:15')
    .text('20%', 'settings:slippage:20')
    .row()
    .text('« Back', 'menu:settings');
}

/**
 * Back to main menu keyboard.
 */
export function backToMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('« Back to Menu', 'menu:main');
}

/**
 * Cancel keyboard.
 */
export function cancelKeyboard(callback: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('❌ Cancel', callback);
}
