/**
 * Environment variable validation and typed configuration.
 *
 * All required variables are validated at startup.
 * The application will not start without them.
 */

import { config } from 'dotenv';

// Load environment variables
config();

/**
 * Application configuration.
 */
export interface AppConfig {
  // Telegram
  botToken: string;

  // Supabase
  supabaseUrl: string;
  supabaseAnonKey: string;

  // Solana
  solanaRpcUrl: string;
  heliusApiKey?: string;

  // Encryption
  masterEncryptionKey: string;

  // Trading defaults
  defaultSlippageBps: number;
  maxPriorityFeeLamports: number;

  // Logging
  logLevel: string;
}

/**
 * Required environment variables.
 */
const REQUIRED_VARS = [
  'BOT_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SOLANA_RPC_URL',
  'MASTER_ENCRYPTION_KEY',
] as const;

/**
 * Validate that all required environment variables are set.
 * Throws an error if any are missing.
 */
function validateEnv(): void {
  const missing: string[] = [];

  for (const varName of REQUIRED_VARS) {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      missing.push(varName);
    }
  }

  // Special validation for MASTER_ENCRYPTION_KEY (must be 64 hex chars)
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  if (masterKey && !/^[0-9a-fA-F]{64}$/.test(masterKey)) {
    console.error('ERROR: MASTER_ENCRYPTION_KEY must be a 64-character hex string');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  if (missing.length > 0) {
    console.error('='.repeat(60));
    console.error('FATAL: Missing required environment variables:');
    console.error('');
    for (const varName of missing) {
      console.error(`  - ${varName}`);
    }
    console.error('');
    console.error('Please ensure these variables are set in your .env file');
    console.error('or in your environment before starting the application.');
    console.error('='.repeat(60));
    process.exit(1);
  }
}

/**
 * Load and validate configuration.
 */
function loadConfig(): AppConfig {
  validateEnv();

  return {
    // Telegram
    botToken: process.env.BOT_TOKEN!,

    // Supabase
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,

    // Solana
    solanaRpcUrl: process.env.SOLANA_RPC_URL!,
    heliusApiKey: process.env.HELIUS_API_KEY,

    // Encryption
    masterEncryptionKey: process.env.MASTER_ENCRYPTION_KEY!,

    // Trading defaults (with sensible defaults)
    defaultSlippageBps: parseInt(process.env.DEFAULT_SLIPPAGE_BPS || '500', 10),
    maxPriorityFeeLamports: parseInt(process.env.MAX_PRIORITY_FEE_LAMPORTS || '100000', 10),

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

// Export validated config
export const appConfig = loadConfig();
