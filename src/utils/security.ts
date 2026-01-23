/**
 * Security Utilities
 *
 * Production security features:
 * - Trade spending limits
 * - Input validation
 * - Sanitization
 */

import { createLogger } from './logger.js';

const logger = createLogger('Security');

/**
 * Default security limits
 */
export const SecurityLimits = {
  // Minimum trade amount (dust protection)
  MIN_TRADE_SOL: 0.001,

  // Maximum slippage BPS (50%)
  MAX_SLIPPAGE_BPS: 5000,

  // Minimum slippage BPS (0.1%)
  MIN_SLIPPAGE_BPS: 10,

  // Maximum priority fee in lamports (1 SOL)
  MAX_PRIORITY_FEE_LAMPORTS: 1_000_000_000,

  // Token address length (base58)
  TOKEN_ADDRESS_LENGTH: 44,
};

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate trade amount (dust protection only, no max limit)
 */
export function validateTradeAmount(
  amountSol: number,
  maxOverride?: number
): ValidationResult {
  if (!Number.isFinite(amountSol)) {
    return { valid: false, error: 'Invalid trade amount' };
  }

  if (amountSol < SecurityLimits.MIN_TRADE_SOL) {
    return {
      valid: false,
      error: `Trade amount too small. Minimum: ${SecurityLimits.MIN_TRADE_SOL} SOL`,
    };
  }

  // Optional max override for specific use cases
  if (maxOverride !== undefined && amountSol > maxOverride) {
    return {
      valid: false,
      error: `Trade amount exceeds maximum. Maximum: ${maxOverride} SOL per trade`,
    };
  }

  return { valid: true };
}

/**
 * Validate slippage setting
 */
export function validateSlippage(slippageBps: number): ValidationResult {
  if (!Number.isInteger(slippageBps)) {
    return { valid: false, error: 'Slippage must be a whole number' };
  }

  if (slippageBps < SecurityLimits.MIN_SLIPPAGE_BPS) {
    return {
      valid: false,
      error: `Slippage too low. Minimum: ${SecurityLimits.MIN_SLIPPAGE_BPS / 100}%`,
    };
  }

  if (slippageBps > SecurityLimits.MAX_SLIPPAGE_BPS) {
    return {
      valid: false,
      error: `Slippage too high. Maximum: ${SecurityLimits.MAX_SLIPPAGE_BPS / 100}%`,
    };
  }

  return { valid: true };
}

/**
 * Validate Solana address format
 */
export function validateSolanaAddress(address: string): ValidationResult {
  if (!address || typeof address !== 'string') {
    return { valid: false, error: 'Address is required' };
  }

  // Basic format check (base58, ~44 characters)
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (!base58Regex.test(address)) {
    return { valid: false, error: 'Invalid Solana address format' };
  }

  return { valid: true };
}

/**
 * Validate sell percentage
 */
export function validateSellPercentage(percentage: number): ValidationResult {
  if (!Number.isFinite(percentage)) {
    return { valid: false, error: 'Invalid percentage' };
  }

  if (percentage < 1 || percentage > 100) {
    return { valid: false, error: 'Percentage must be between 1 and 100' };
  }

  return { valid: true };
}

/**
 * Validate SL/TP trigger price
 */
export function validateTriggerPrice(
  triggerPrice: number,
  currentPrice: number,
  orderType: 'stop_loss' | 'take_profit'
): ValidationResult {
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
    return { valid: false, error: 'Invalid trigger price' };
  }

  if (orderType === 'stop_loss') {
    // Stop loss should be below current price
    if (triggerPrice >= currentPrice) {
      return {
        valid: false,
        error: 'Stop loss price must be below current price',
      };
    }
    // Warn if too close to current price (< 1%)
    if (triggerPrice > currentPrice * 0.99) {
      logger.warn('Stop loss very close to current price', {
        triggerPrice,
        currentPrice,
        difference: ((currentPrice - triggerPrice) / currentPrice * 100).toFixed(2) + '%',
      });
    }
  } else {
    // Take profit should be above current price
    if (triggerPrice <= currentPrice) {
      return {
        valid: false,
        error: 'Take profit price must be above current price',
      };
    }
  }

  return { valid: true };
}

/**
 * Sanitize user input (prevent injection)
 */
export function sanitizeInput(input: string): string {
  if (!input) return '';

  // Remove control characters
  let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');

  // Limit length
  sanitized = sanitized.slice(0, 1000);

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Escape Markdown special characters for Telegram
 */
export function escapeMarkdown(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!');
}

/**
 * Mask sensitive data for logging
 */
export function maskSensitive(data: string, visibleChars: number = 4): string {
  if (!data || data.length <= visibleChars * 2) {
    return '***';
  }
  return data.slice(0, visibleChars) + '...' + data.slice(-visibleChars);
}

/**
 * Validate private key format (base58, 64 bytes)
 */
export function validatePrivateKey(privateKey: string): ValidationResult {
  if (!privateKey || typeof privateKey !== 'string') {
    return { valid: false, error: 'Private key is required' };
  }

  // Base58 format check
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  if (!base58Regex.test(privateKey)) {
    return { valid: false, error: 'Invalid private key format' };
  }

  // Length check (base58 encoded 64 bytes is typically 87-88 chars)
  if (privateKey.length < 80 || privateKey.length > 90) {
    return { valid: false, error: 'Invalid private key length' };
  }

  return { valid: true };
}

/**
 * Check if a transaction signature is valid format
 */
export function validateTxSignature(signature: string): ValidationResult {
  if (!signature || typeof signature !== 'string') {
    return { valid: false, error: 'Transaction signature is required' };
  }

  // Base58 format, typically 87-88 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
  if (!base58Regex.test(signature)) {
    return { valid: false, error: 'Invalid transaction signature format' };
  }

  return { valid: true };
}
