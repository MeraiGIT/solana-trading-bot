/**
 * Jest Test Setup
 *
 * Sets up the test environment with mocks and global configuration.
 */

import { jest, beforeAll, afterAll } from '@jest/globals';

// Set test environment variables
process.env.BOT_TOKEN = 'test_bot_token';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test_anon_key';
process.env.SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
process.env.MASTER_ENCRYPTION_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Suppress logs during tests

// Increase timeout for async tests
jest.setTimeout(10000);

// Global beforeAll
beforeAll(() => {
  // Any global setup
});

// Global afterAll
afterAll(() => {
  // Any global cleanup
});
