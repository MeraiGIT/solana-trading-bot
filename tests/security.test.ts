/**
 * Security Utilities Tests
 *
 * Tests for input validation and security functions.
 */

import { describe, it, expect } from '@jest/globals';
import {
  validateTradeAmount,
  validateSlippage,
  validateSolanaAddress,
  validateSellPercentage,
  validateTriggerPrice,
  sanitizeInput,
  escapeMarkdown,
  maskSensitive,
  validatePrivateKey,
  validateTxSignature,
  SecurityLimits,
} from '../src/utils/security.js';

describe('Security Utilities', () => {
  describe('validateTradeAmount', () => {
    it('should accept valid trade amounts', () => {
      expect(validateTradeAmount(0.1).valid).toBe(true);
      expect(validateTradeAmount(1).valid).toBe(true);
      expect(validateTradeAmount(5).valid).toBe(true);
    });

    it('should reject amounts below minimum', () => {
      const result = validateTradeAmount(0.0001);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too small');
    });

    it('should allow large trades (no max limit by default)', () => {
      expect(validateTradeAmount(100).valid).toBe(true);
      expect(validateTradeAmount(1000).valid).toBe(true);
    });

    it('should allow custom maximum when specified', () => {
      expect(validateTradeAmount(15, 20).valid).toBe(true);
      expect(validateTradeAmount(25, 20).valid).toBe(false);
    });

    it('should reject non-finite numbers', () => {
      expect(validateTradeAmount(NaN).valid).toBe(false);
      expect(validateTradeAmount(Infinity).valid).toBe(false);
    });
  });

  describe('validateSlippage', () => {
    it('should accept valid slippage values', () => {
      expect(validateSlippage(100).valid).toBe(true); // 1%
      expect(validateSlippage(500).valid).toBe(true); // 5%
      expect(validateSlippage(1000).valid).toBe(true); // 10%
    });

    it('should reject slippage below minimum', () => {
      const result = validateSlippage(5);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too low');
    });

    it('should reject slippage above maximum', () => {
      const result = validateSlippage(6000);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too high');
    });

    it('should reject non-integer values', () => {
      expect(validateSlippage(100.5).valid).toBe(false);
    });
  });

  describe('validateSolanaAddress', () => {
    it('should accept valid Solana addresses', () => {
      // Valid base58 address format
      const validAddress = '7RCz8wb6WXxUhAigok9ttgrVgDFFFbibcirYCinD3LKs';
      expect(validateSolanaAddress(validAddress).valid).toBe(true);
    });

    it('should reject empty addresses', () => {
      expect(validateSolanaAddress('').valid).toBe(false);
      expect(validateSolanaAddress(null as unknown as string).valid).toBe(false);
    });

    it('should reject invalid characters', () => {
      // 0, O, I, l are not in base58
      expect(validateSolanaAddress('0OIl1234567890123456789012345678901234').valid).toBe(false);
    });
  });

  describe('validateSellPercentage', () => {
    it('should accept valid percentages', () => {
      expect(validateSellPercentage(1).valid).toBe(true);
      expect(validateSellPercentage(25).valid).toBe(true);
      expect(validateSellPercentage(50).valid).toBe(true);
      expect(validateSellPercentage(100).valid).toBe(true);
    });

    it('should reject percentages below 1', () => {
      expect(validateSellPercentage(0).valid).toBe(false);
      expect(validateSellPercentage(-10).valid).toBe(false);
    });

    it('should reject percentages above 100', () => {
      expect(validateSellPercentage(101).valid).toBe(false);
      expect(validateSellPercentage(200).valid).toBe(false);
    });

    it('should reject non-finite values', () => {
      expect(validateSellPercentage(NaN).valid).toBe(false);
      expect(validateSellPercentage(Infinity).valid).toBe(false);
    });
  });

  describe('validateTriggerPrice', () => {
    it('should accept valid stop loss (below current)', () => {
      const result = validateTriggerPrice(0.8, 1.0, 'stop_loss');
      expect(result.valid).toBe(true);
    });

    it('should accept valid take profit (above current)', () => {
      const result = validateTriggerPrice(1.2, 1.0, 'take_profit');
      expect(result.valid).toBe(true);
    });

    it('should reject stop loss above current price', () => {
      const result = validateTriggerPrice(1.2, 1.0, 'stop_loss');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('below current price');
    });

    it('should reject take profit below current price', () => {
      const result = validateTriggerPrice(0.8, 1.0, 'take_profit');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('above current price');
    });

    it('should reject invalid trigger prices', () => {
      expect(validateTriggerPrice(0, 1.0, 'stop_loss').valid).toBe(false);
      expect(validateTriggerPrice(-1, 1.0, 'stop_loss').valid).toBe(false);
      expect(validateTriggerPrice(NaN, 1.0, 'stop_loss').valid).toBe(false);
    });
  });

  describe('sanitizeInput', () => {
    it('should remove control characters', () => {
      const input = 'hello\x00world\x1F';
      expect(sanitizeInput(input)).toBe('helloworld');
    });

    it('should trim whitespace', () => {
      expect(sanitizeInput('  hello  ')).toBe('hello');
    });

    it('should limit length', () => {
      const longInput = 'a'.repeat(2000);
      expect(sanitizeInput(longInput).length).toBe(1000);
    });

    it('should handle empty/null input', () => {
      expect(sanitizeInput('')).toBe('');
      expect(sanitizeInput(null as unknown as string)).toBe('');
    });
  });

  describe('escapeMarkdown', () => {
    it('should escape special characters', () => {
      expect(escapeMarkdown('*bold*')).toBe('\\*bold\\*');
      expect(escapeMarkdown('_italic_')).toBe('\\_italic\\_');
      expect(escapeMarkdown('`code`')).toBe('\\`code\\`');
    });

    it('should handle empty input', () => {
      expect(escapeMarkdown('')).toBe('');
      expect(escapeMarkdown(null as unknown as string)).toBe('');
    });
  });

  describe('maskSensitive', () => {
    it('should mask middle of string', () => {
      expect(maskSensitive('1234567890')).toBe('1234...7890');
    });

    it('should handle short strings', () => {
      expect(maskSensitive('abc')).toBe('***');
    });

    it('should use custom visible chars', () => {
      expect(maskSensitive('1234567890', 2)).toBe('12...90');
    });
  });

  describe('validatePrivateKey', () => {
    it('should accept valid base58 private keys', () => {
      // Mock valid-looking base58 string (87-88 chars)
      const validKey = '5' + 'A'.repeat(86);
      expect(validatePrivateKey(validKey).valid).toBe(true);
    });

    it('should reject empty keys', () => {
      expect(validatePrivateKey('').valid).toBe(false);
    });

    it('should reject keys with invalid characters', () => {
      expect(validatePrivateKey('0OIl' + 'A'.repeat(83)).valid).toBe(false);
    });

    it('should reject keys with wrong length', () => {
      expect(validatePrivateKey('AAAA').valid).toBe(false);
    });
  });

  describe('validateTxSignature', () => {
    it('should accept valid signatures', () => {
      const validSig = '5' + 'A'.repeat(86);
      expect(validateTxSignature(validSig).valid).toBe(true);
    });

    it('should reject empty signatures', () => {
      expect(validateTxSignature('').valid).toBe(false);
    });

    it('should reject signatures with invalid characters', () => {
      expect(validateTxSignature('0OIl' + 'A'.repeat(83)).valid).toBe(false);
    });
  });

  describe('SecurityLimits', () => {
    it('should have sensible default limits', () => {
      expect(SecurityLimits.MIN_TRADE_SOL).toBeGreaterThan(0);
      expect(SecurityLimits.MAX_SLIPPAGE_BPS).toBeGreaterThan(SecurityLimits.MIN_SLIPPAGE_BPS);
    });
  });
});
