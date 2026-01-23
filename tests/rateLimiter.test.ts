/**
 * Rate Limiter Tests
 *
 * Tests for token bucket and sliding window rate limiters.
 */

import { describe, it, expect } from '@jest/globals';
import { RateLimiter, SlidingWindowCounter } from '../src/utils/rateLimiter.js';

describe('RateLimiter', () => {
  describe('Token Bucket', () => {
    it('should allow requests within limit', () => {
      const limiter = new RateLimiter('test', { maxTokens: 5, refillRate: 1 });
      const key = 'user1';

      // Should allow 5 requests
      for (let i = 0; i < 5; i++) {
        expect(limiter.tryConsume(key)).toBe(true);
      }
    });

    it('should block requests over limit', () => {
      const limiter = new RateLimiter('test', { maxTokens: 3, refillRate: 0 });
      const key = 'user1';

      // Consume all tokens
      expect(limiter.tryConsume(key)).toBe(true);
      expect(limiter.tryConsume(key)).toBe(true);
      expect(limiter.tryConsume(key)).toBe(true);

      // Should be blocked
      expect(limiter.tryConsume(key)).toBe(false);
    });

    it('should refill tokens over time', async () => {
      const limiter = new RateLimiter('test', { maxTokens: 2, refillRate: 10 }); // 10 tokens/sec
      const key = 'user1';

      // Consume all tokens
      expect(limiter.tryConsume(key)).toBe(true);
      expect(limiter.tryConsume(key)).toBe(true);
      expect(limiter.tryConsume(key)).toBe(false);

      // Wait for refill (100ms should give ~1 token at 10/sec)
      await new Promise(r => setTimeout(r, 150));

      // Should have refilled
      expect(limiter.tryConsume(key)).toBe(true);
    });

    it('should track different keys separately', () => {
      const limiter = new RateLimiter('test', { maxTokens: 2, refillRate: 0 });

      expect(limiter.tryConsume('user1')).toBe(true);
      expect(limiter.tryConsume('user1')).toBe(true);
      expect(limiter.tryConsume('user1')).toBe(false);

      // Different user should still have tokens
      expect(limiter.tryConsume('user2')).toBe(true);
    });

    it('should allow consuming multiple tokens at once', () => {
      const limiter = new RateLimiter('test', { maxTokens: 10, refillRate: 0 });
      const key = 'user1';

      expect(limiter.tryConsume(key, 5)).toBe(true);
      expect(limiter.getRemaining(key)).toBe(5);

      expect(limiter.tryConsume(key, 6)).toBe(false); // Not enough
      expect(limiter.tryConsume(key, 5)).toBe(true);
    });

    it('should reset a key', () => {
      const limiter = new RateLimiter('test', { maxTokens: 2, refillRate: 0 });
      const key = 'user1';

      expect(limiter.tryConsume(key)).toBe(true);
      expect(limiter.tryConsume(key)).toBe(true);
      expect(limiter.tryConsume(key)).toBe(false);

      limiter.reset(key);
      expect(limiter.tryConsume(key)).toBe(true);
    });
  });
});

describe('SlidingWindowCounter', () => {
  describe('Window-based limiting', () => {
    it('should allow actions within limit', () => {
      const counter = new SlidingWindowCounter('test', {
        windowSize: 1000, // 1 second
        maxCount: 3,
      });
      const key = 'user1';

      expect(counter.record(key)).toBe(true);
      expect(counter.record(key)).toBe(true);
      expect(counter.record(key)).toBe(true);
    });

    it('should block actions over limit', () => {
      const counter = new SlidingWindowCounter('test', {
        windowSize: 1000,
        maxCount: 2,
      });
      const key = 'user1';

      expect(counter.record(key)).toBe(true);
      expect(counter.record(key)).toBe(true);
      expect(counter.record(key)).toBe(false);
    });

    it('should reset after window expires', async () => {
      const counter = new SlidingWindowCounter('test', {
        windowSize: 100, // 100ms window for testing
        maxCount: 2,
      });
      const key = 'user1';

      expect(counter.record(key)).toBe(true);
      expect(counter.record(key)).toBe(true);
      expect(counter.record(key)).toBe(false);

      // Wait for window to expire
      await new Promise(r => setTimeout(r, 150));

      expect(counter.record(key)).toBe(true);
    });

    it('should track count correctly', () => {
      const counter = new SlidingWindowCounter('test', {
        windowSize: 1000,
        maxCount: 5,
      });
      const key = 'user1';

      expect(counter.getCount(key)).toBe(0);

      counter.record(key);
      expect(counter.getCount(key)).toBe(1);

      counter.record(key);
      counter.record(key);
      expect(counter.getCount(key)).toBe(3);
    });

    it('should calculate time until reset', () => {
      const counter = new SlidingWindowCounter('test', {
        windowSize: 10000, // 10 second window
        maxCount: 2,
      });
      const key = 'user1';

      expect(counter.getTimeUntilReset(key)).toBe(0); // Not limited yet

      counter.record(key);
      counter.record(key);

      // Now at limit, should return time until oldest expires
      const timeUntilReset = counter.getTimeUntilReset(key);
      expect(timeUntilReset).toBeGreaterThan(0);
      expect(timeUntilReset).toBeLessThanOrEqual(10000);
    });

    it('should track different keys separately', () => {
      const counter = new SlidingWindowCounter('test', {
        windowSize: 1000,
        maxCount: 2,
      });

      counter.record('user1');
      counter.record('user1');
      expect(counter.record('user1')).toBe(false);

      expect(counter.record('user2')).toBe(true);
      expect(counter.getCount('user2')).toBe(1);
    });

    it('should reset a specific key', () => {
      const counter = new SlidingWindowCounter('test', {
        windowSize: 1000,
        maxCount: 2,
      });
      const key = 'user1';

      counter.record(key);
      counter.record(key);
      expect(counter.record(key)).toBe(false);

      counter.reset(key);
      expect(counter.record(key)).toBe(true);
      expect(counter.getCount(key)).toBe(1);
    });
  });
});
