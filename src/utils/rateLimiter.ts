/**
 * Rate Limiter
 *
 * Production-grade rate limiting with:
 * - Token bucket algorithm
 * - Per-user rate limiting
 * - Per-API rate limiting
 * - Sliding window support
 */

import { createLogger } from './logger.js';

const logger = createLogger('RateLimiter');

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

interface RateLimitConfig {
  maxTokens: number;      // Maximum tokens in bucket
  refillRate: number;     // Tokens per second
  refillInterval: number; // Refill check interval in ms
}

/**
 * Token Bucket Rate Limiter
 */
export class RateLimiter {
  private buckets: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;
  private name: string;

  constructor(name: string, config: Partial<RateLimitConfig> = {}) {
    this.name = name;
    this.config = {
      maxTokens: config.maxTokens ?? 10,
      refillRate: config.refillRate ?? 1,
      refillInterval: config.refillInterval ?? 1000,
    };
  }

  /**
   * Try to consume a token
   * Returns true if allowed, false if rate limited
   */
  tryConsume(key: string, tokens: number = 1): boolean {
    const now = Date.now();
    let entry = this.buckets.get(key);

    if (!entry) {
      entry = {
        tokens: this.config.maxTokens,
        lastRefill: now,
      };
      this.buckets.set(key, entry);
    }

    // Calculate tokens to add based on time elapsed
    const elapsed = now - entry.lastRefill;
    const tokensToAdd = Math.floor(elapsed / 1000 * this.config.refillRate);

    if (tokensToAdd > 0) {
      entry.tokens = Math.min(entry.tokens + tokensToAdd, this.config.maxTokens);
      entry.lastRefill = now;
    }

    // Check if we have enough tokens
    if (entry.tokens >= tokens) {
      entry.tokens -= tokens;
      return true;
    }

    logger.debug(`Rate limited: ${this.name}`, { key, tokens: entry.tokens, requested: tokens });
    return false;
  }

  /**
   * Get remaining tokens for a key
   */
  getRemaining(key: string): number {
    const entry = this.buckets.get(key);
    if (!entry) {
      return this.config.maxTokens;
    }

    // Calculate current tokens including refill
    const now = Date.now();
    const elapsed = now - entry.lastRefill;
    const tokensToAdd = Math.floor(elapsed / 1000 * this.config.refillRate);
    return Math.min(entry.tokens + tokensToAdd, this.config.maxTokens);
  }

  /**
   * Reset a specific key
   */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Clean up old entries
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    for (const [key, entry] of this.buckets.entries()) {
      if (now - entry.lastRefill > maxAge) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Sliding Window Counter for tracking actions over time
 */
export class SlidingWindowCounter {
  private windows: Map<string, number[]> = new Map();
  private windowSize: number; // Window size in ms
  private maxCount: number;
  private name: string;

  constructor(name: string, config: { windowSize: number; maxCount: number }) {
    this.name = name;
    this.windowSize = config.windowSize;
    this.maxCount = config.maxCount;
  }

  /**
   * Record an action and check if within limit
   * Returns true if allowed, false if rate limited
   */
  record(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowSize;

    let timestamps = this.windows.get(key) || [];

    // Remove timestamps outside the window
    timestamps = timestamps.filter(t => t > cutoff);

    // Check if we're at the limit
    if (timestamps.length >= this.maxCount) {
      logger.debug(`Window limit exceeded: ${this.name}`, {
        key,
        count: timestamps.length,
        max: this.maxCount,
      });
      return false;
    }

    // Add current timestamp
    timestamps.push(now);
    this.windows.set(key, timestamps);
    return true;
  }

  /**
   * Get count of actions in current window
   */
  getCount(key: string): number {
    const now = Date.now();
    const cutoff = now - this.windowSize;
    const timestamps = this.windows.get(key) || [];
    return timestamps.filter(t => t > cutoff).length;
  }

  /**
   * Get the maximum count allowed in the window
   */
  getMaxCount(): number {
    return this.maxCount;
  }

  /**
   * Get time until next action is allowed (in ms)
   */
  getTimeUntilReset(key: string): number {
    const timestamps = this.windows.get(key) || [];
    if (timestamps.length < this.maxCount) {
      return 0;
    }

    const now = Date.now();
    const cutoff = now - this.windowSize;
    const validTimestamps = timestamps.filter(t => t > cutoff).sort((a, b) => a - b);

    if (validTimestamps.length < this.maxCount) {
      return 0;
    }

    // Time until oldest timestamp expires
    return (validTimestamps[0] + this.windowSize) - now;
  }

  /**
   * Reset a specific key
   */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /**
   * Clean up old entries
   */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.windowSize;

    for (const [key, timestamps] of this.windows.entries()) {
      const validTimestamps = timestamps.filter(t => t > cutoff);
      if (validTimestamps.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, validTimestamps);
      }
    }
  }
}

// Pre-configured rate limiters for production use
export const rateLimiters = {
  // API rate limiters
  jupiter: new RateLimiter('Jupiter', { maxTokens: 30, refillRate: 10 }),      // 30 req, refill 10/sec
  dexScreener: new RateLimiter('DexScreener', { maxTokens: 60, refillRate: 5 }), // 60 req, refill 5/sec
  pumpPortal: new RateLimiter('PumpPortal', { maxTokens: 20, refillRate: 2 }),  // 20 req, refill 2/sec
  helius: new RateLimiter('Helius', { maxTokens: 50, refillRate: 10 }),         // 50 req, refill 10/sec
  jito: new RateLimiter('Jito', { maxTokens: 20, refillRate: 5 }),              // 20 req, refill 5/sec

  // User action rate limiters
  trade: new RateLimiter('Trade', { maxTokens: 5, refillRate: 1 }),             // 5 trades, refill 1/sec
  message: new RateLimiter('Message', { maxTokens: 20, refillRate: 5 }),        // 20 messages, refill 5/sec
};

// Sliding window counters for daily limits
export const dailyLimits = {
  // Private key export: max 3 per 24 hours
  keyExport: new SlidingWindowCounter('KeyExport', {
    windowSize: 24 * 60 * 60 * 1000,
    maxCount: 3,
  }),

  // Trades: max 500 per 24 hours (safety)
  trades: new SlidingWindowCounter('DailyTrades', {
    windowSize: 24 * 60 * 60 * 1000,
    maxCount: 500,
  }),

  // Withdrawals: max 50 per 24 hours
  withdrawals: new SlidingWindowCounter('Withdrawals', {
    windowSize: 24 * 60 * 60 * 1000,
    maxCount: 50,
  }),
};

// Start cleanup interval (unref to allow process to exit cleanly)
const cleanupInterval = setInterval(() => {
  Object.values(rateLimiters).forEach(limiter => limiter.cleanup());
  Object.values(dailyLimits).forEach(counter => counter.cleanup());
}, 60 * 60 * 1000); // Cleanup every hour
cleanupInterval.unref();

/**
 * Rate limit decorator for async functions
 */
export function withRateLimit<T>(
  limiter: RateLimiter,
  keyFn: (...args: unknown[]) => string,
  onLimited?: () => T
) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const key = keyFn(...args);
      if (!limiter.tryConsume(key)) {
        if (onLimited) {
          return onLimited();
        }
        throw new Error('Rate limited. Please try again later.');
      }
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
