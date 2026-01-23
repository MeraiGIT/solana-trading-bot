# Changelog - Solana Trading Bot

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.5.0] - 2026-01-23

### Added
- **Production Hardening** - Complete security overhaul for production deployment

- **Structured Logging System** (`src/utils/logger.ts`)
  - Log levels: DEBUG, INFO, WARN, ERROR
  - Module-based logger creation
  - JSON output for production, colored console for development
  - Child logger support for sub-modules

- **Rate Limiting** (`src/utils/rateLimiter.ts`)
  - Token bucket algorithm for API rate limiting
  - Sliding window counter for daily limits
  - Pre-configured limiters: Jupiter, DexScreener, PumpPortal, Helius, Jito
  - Private key export: max 3 per 24 hours
  - Trades: max 500 per 24 hours
  - Withdrawals: max 50 per 24 hours

- **Audit Logging** (`src/services/audit.ts`)
  - Security event tracking to Supabase `tb_audit_logs`
  - Wallet events: create, import, export, delete
  - Trade events: buy, sell
  - Security events: rate limit exceeded, validation failed
  - Includes user_id, action, details JSON, timestamps

- **Health Check Server** (`src/services/health.ts`)
  - HTTP endpoints for Railway health checks
  - `/health` - Full health check (DB, RPC, bot status)
  - `/ready` - Readiness probe
  - `/live` - Liveness probe
  - `/metrics` - Basic system metrics

- **Security Validation** (`src/utils/security.ts`)
  - `validateTradeAmount()` - Min/max trade validation
  - `validateSlippage()` - Slippage bounds checking
  - `validateSolanaAddress()` - Base58 address validation
  - `validateSellPercentage()` - 1-100% validation
  - `validateTriggerPrice()` - SL/TP price validation
  - `sanitizeInput()` - Remove control characters, limit length
  - `escapeMarkdown()` - Telegram message escaping
  - `maskSensitive()` - Hide middle of sensitive strings
  - `SecurityLimits` - Configurable trading limits

- **Comprehensive Test Suite** (88 tests, all passing)
  - `tests/encryption.test.ts` - 22 tests for AES-256-GCM encryption
  - `tests/security.test.ts` - 38 tests for input validation
  - `tests/rateLimiter.test.ts` - 13 tests for rate limiting
  - `tests/logger.test.ts` - 15 tests for structured logging
  - Jest with ESM support configuration

- **Database Migration** (Supabase)
  - Created `tb_audit_logs` table with indexes
  - Indexes on user_id and created_at for efficient queries

### Changed
- **Private Key Export** (`src/bot/commands/wallet.ts`)
  - Added rate limiting (max 3 exports per 24 hours)
  - Added audit logging for all export attempts
  - Shows remaining exports count to user

- **Wallet Operations** (`src/bot/commands/wallet.ts`)
  - All wallet create/import/delete operations now logged to audit

- **Environment Configuration** (`src/utils/env.ts`, `.env.example`)
  - Added `PORT` - Health check server port (default: 3000)
  - Added `NODE_ENV` - production/development mode
  - Added `LOG_LEVEL` - debug/info/warn/error

- **Application Entry Point** (`src/index.ts`)
  - Integrated health check server startup
  - Added graceful shutdown with health server
  - Version bumped to 0.5.0

### Security
- Rate limiting prevents abuse of sensitive operations
- Audit logging provides security event trail
- Input validation prevents injection attacks
- All tests verify security-critical code paths

---

## [0.4.2] - 2026-01-21

### Fixed
- **CRITICAL: /positions missing tokens** (`src/bot/commands/trade.ts`)
  - /positions now reconciles on-chain balances with database positions
  - Previously, positions could silently disappear if an on-chain balance check failed
  - Now fetches ALL on-chain token balances first, then matches with DB
  - Auto-creates missing DB positions for tokens found on-chain (marked with 🆕)
  - Syncs DB amounts with actual on-chain balances
  - Only deletes DB positions when tokens are truly gone from blockchain
  - Fixes issue where GRIFFAIN was missing but Fartcoin showed correctly

---

## [0.4.1] - 2026-01-20

### Fixed
- **CRITICAL: Jito Bundle Serialization** (`src/trading/jito.ts`)
  - Changed transaction encoding from base64 to base58 (Jito API requirement)
  - Jito bundles now successfully land with MEV protection
  - Previously: "transaction could not be decoded" errors on every Jito attempt

- **CRITICAL: Blockhash Expiration on Fallback** (`src/trading/jupiter.ts`)
  - Added fresh blockhash retrieval when falling back from Jito to regular RPC
  - Transactions are now rebuilt with new blockhash on each retry attempt
  - Previously: "Blockhash not found" errors after Jito failures

### Added
- **Jito Endpoint Rotation** (`src/trading/jito.ts`)
  - Added 5 Jito endpoints: mainnet, amsterdam, frankfurt, ny, tokyo
  - Automatic rotation when rate limited (-32097) or on decode errors (-32602)
  - Logs endpoint changes for debugging

### Changed
- **Higher Priority Fees** (`src/trading/jupiter.ts`)
  - Increased default priority fee from 100k to 500k lamports
  - Faster transaction confirmation during network congestion

- **Higher Jito Tips** (`src/trading/jito.ts`)
  - Increased base tip from 10k to 50k lamports
  - Trade-value-based tip calculation:
    - < 0.1 SOL: 50k lamports
    - 0.1-0.5 SOL: 100k lamports
    - 0.5-1 SOL: 200k lamports
    - 1-5 SOL: 500k lamports
    - > 5 SOL: 1M lamports

- **Faster Jito Timeout** (`src/trading/jupiter.ts`)
  - Reduced maxWaitMs from 30s to 15s for faster fallback

- **Reduced Jito Retries** (`src/trading/jito.ts`)
  - Reduced maxRetries from 3 to 2
  - Reduced retryDelayMs from 1000ms to 500ms

### Tested End-to-End
- Buy 0.013 SOL via Jito → Jito bundle landed successfully ✅
- Sell 50% → Transaction succeeded ✅
- Sell 100% → Transaction succeeded ✅
- Stop Loss order creation → Order stored correctly ✅
- Price monitor checking every 30s ✅

---

## [0.4.0] - 2026-01-20

### Changed
- **CRITICAL: On-Chain Data Integration** - Database is now metadata-only storage
  - All token balances now fetched directly from blockchain via SPL Token queries
  - Fixes 100% sell failures caused by DB-to-chain balance drift (error 0x1788)
  - Example: DB showed 59.63 tokens, on-chain had 58.98 tokens - now uses on-chain

### Added
- **SPL Token Balance Queries** (`src/wallet/manager.ts`)
  - Added `@solana/spl-token` dependency
  - New `getTokenBalance(walletAddress, tokenMint)` method
  - New `getAllTokenBalances(walletAddress)` method
  - 5-second cache with `invalidateTokenBalanceCache()` for post-trade refresh
  - Retry logic with 1-second delay on RPC failures

- **Post-Trade Verification**
  - Buy: Waits 2s, queries on-chain balance, stores verified amount (not Jupiter estimate)
  - Sell: Waits 2s, syncs DB with actual remaining balance
  - Logs discrepancies between expected and actual amounts

### Fixed
- **handleSell()** (`src/bot/commands/trade.ts`)
  - Now uses on-chain balance instead of database amount for sell calculations
  - Auto-cleans stale positions when on-chain balance is 0
  - Shows warning when balance synced from blockchain

- **triggerOrder()** (`src/trading/priceMonitor.ts`)
  - SL/TP orders now use real on-chain balance
  - Cancels orders and cleans positions when no tokens on-chain
  - Post-trigger balance sync with chain

- **showPositions()** (`src/bot/commands/trade.ts`)
  - Displays real on-chain balances
  - Shows sync indicator when DB differs from chain
  - Auto-removes positions with zero on-chain balance
  - Added "Refresh" button

- **showSellOptions()** (`src/bot/commands/trade.ts`)
  - Shows actual on-chain holdings
  - Cleans up stale positions automatically
  - Warning displayed when balance synced

### Database Role Change
- **Before:** Source of truth for token amounts
- **After:** Metadata storage only (entry price, timestamp, symbol)
- Token balances always fetched fresh from blockchain for critical operations

---

## [0.3.2] - 2026-01-20

### Fixed
- **Critical: Token Amount Calculation** (`src/bot/commands/trade.ts`)
  - Fixed bug where token amounts displayed in millions instead of actual amount
  - Jupiter returns raw amounts (with decimals), now properly divided by 10^decimals when storing positions
  - Positions now show correct human-readable token amounts

- **Jupiter API Authentication** (`src/trading/jupiter.ts`, `src/utils/env.ts`)
  - Added `x-api-key` header support for Jupiter API (now required)
  - Added `JUPITER_API_KEY` environment variable

- **Sell Percentage Validation** (`src/bot/commands/trade.ts:628-632`)
  - Added bounds checking for sell percentage (1-100)
  - Prevents invalid sell operations with malformed percentages

- **Balance Check Precision** (`src/bot/commands/trade.ts:297-318`)
  - Changed balance comparison from floating-point to integer math (lamports)
  - Prevents floating-point precision errors in balance checks

- **Error Object Serialization** (`src/trading/jupiter.ts:298-301`)
  - Fixed `simulationError` object being shown as "[object Object]"
  - Now properly serializes error objects to JSON strings

- **Position Decimal Validation** (`src/services/database.ts:207-221`)
  - Added validation for tokenDecimals (0-18 range)
  - Added validation for position amount (must be positive finite number)
  - Invalid decimals default to 9 with warning log

### Added
- **Telegram Command Menu** (`src/index.ts`)
  - Added `bot.api.setMyCommands()` for "/" command suggestions
  - Users now see available commands in Telegram's command menu

### Documentation
- Added clarifying comment in tokenInfo.ts about DexScreener not providing decimals

## [0.3.3] - 2026-01-20

### Fixed
- **Critical: PumpFun Token Decimals** (`src/trading/tokenInfo.ts`)
  - PumpFun tokens now correctly detected and use 6 decimals (not 9)
  - Token addresses ending with "pump" are auto-detected as PumpFun
  - USDC/USDT also correctly use 6 decimals
  - Previously: 0.013 SOL buy showed "0.05 tokens" (wrong)
  - Now: 0.013 SOL buy shows "55.06 tokens" (correct)

- **Telegram Markdown Parsing Errors** (`src/bot/commands/trade.ts`)
  - Added `escapeMarkdown()` utility function
  - Token symbols escaped in positions/sell messages
  - Error messages escaped to prevent Telegram "can't parse entities" errors

### Tested End-to-End
- Buy 0.013 SOL → Received 55.06 WhiteWhale tokens ✅
- Sell 25% (13.76 tokens) → Received 0.0030 SOL ✅
- Sell 100% (41.29 tokens) → Received 0.0089 SOL ✅
- Position correctly cleared after full sell ✅
- Transaction history shows all trades ✅

---

## [0.3.1] - 2026-01-20

### Fixed
- **Trade Progress Feedback** (`src/bot/commands/trade.ts`)
  - Fixed critical bug where custom buy amounts showed no feedback to user
  - Issue: `ctx.editMessageText()` silently failed when called from text message context
  - Added `sendStatusMessage()` helper that handles both callback and text message contexts
  - Added `updateStatusMessage()` helper to update messages by ID
  - Trade flow now shows step-by-step progress:
    1. "Initializing Trade..."
    2. "Checking balance..."
    3. "Preparing Trade..."
    4. "Executing Trade..."
    5. "Finalizing..."
    6. Success/Error with full details

### Changed
- **Trade Success Message**
  - Now shows complete position summary after successful buy
  - Includes entry price, holdings, and quick action buttons
  - Added Set SL/TP buttons directly in success message
  - Better error messages with troubleshooting tips

### Removed
- **Withdrawal Limits Feature**
  - Removed daily withdrawal limits (unnecessary friction)
  - Removed large withdrawal warnings
  - Removed withdrawal limit settings from UI
  - Security already handled by wallet encryption and Telegram auth

---

## [0.3.0] - 2026-01-19

### Added
- **MEV Protection** (`src/trading/jito.ts`, `src/trading/priorityFee.ts`)
  - Jito Bundle Client for private mempool submission
  - Transactions hidden from MEV bots until block inclusion
  - Automatic tip transactions to Jito validators
  - Bundle status tracking and confirmation polling
  - Dynamic Priority Fee Service
  - Helius API integration for network fee estimation
  - RPC fallback when Helius unavailable
  - Fee calculation based on trade value and urgency
  - Caching to reduce API calls

### Changed
- **Jupiter Client** (`src/trading/jupiter.ts`)
  - Integrated Jito bundle support for MEV-protected trades
  - Added dynamic priority fee calculation
  - Trades now try Jito first, fall back to regular RPC

- **DEX Router** (`src/trading/router.ts`)
  - Added `useJito` and `heliusApiKey` configuration options
  - Passes MEV protection settings to Jupiter client

- **Environment Config** (`src/utils/env.ts`)
  - Added `USE_JITO` - Enable/disable Jito bundles (default: true)
  - Added `JITO_TIP_LAMPORTS` - Default tip amount
  - Added `HELIUS_API_KEY` - For dynamic priority fees

### Fixed
- **Database** (`src/services/database.ts`)
  - Added `auth_tag` column support for wallet encryption
  - Fixed wallet export functionality

---

## [0.2.0] - 2026-01-19

### Added
- **Trading Engine** (`src/trading/`)
  - Jupiter API client for DEX aggregation
  - PumpPortal API client for PumpFun trades
  - DEX Router for automatic best DEX selection
  - Token info service using DexScreener API
  - Price monitor service for SL/TP execution

- **Trade Commands** (`src/bot/commands/trade.ts`)
  - Token address detection and info display
  - Buy with preset amounts (0.1, 0.25, 0.5, 1 SOL)
  - Custom buy amount support
  - Sell positions with percentage (25%, 50%, 75%, 100%)
  - Stop Loss and Take Profit order creation
  - Position and order management views

- **MEV Protection**
  - Priority fees on all transactions
  - Retry logic with exponential backoff
  - Transaction confirmation waiting

### Changed
- Updated session data structure to support trade operations
- Enhanced callback handler with trading actions
- Enhanced message handler with trade input processing

---

## [0.1.0] - 2026-01-19

### Added
- **Project initialization**
  - TypeScript project setup with Grammy.js
  - Package.json with all required dependencies
  - TSConfig for Node.js 20+ with strict mode
  - Environment variable configuration (.env.example)

- **Wallet Encryption Module** (`src/wallet/encryption.ts`)
  - AES-256-GCM encryption for private keys
  - PBKDF2 key derivation with 100,000 iterations
  - Per-user salt generation
  - Secure memory clearing functions
  - Master key validation

- **Wallet Manager** (`src/wallet/manager.ts`)
  - HD wallet generation (BIP39/BIP44)
  - Simple random wallet generation
  - Base58 private key import
  - Byte array import (Solana CLI format)
  - Private key export for user backup
  - Balance checking via RPC
  - Address and private key validation

- **Documentation**
  - CLAUDE.md with development guidelines
  - BUILDING_PLAN.md with complete implementation roadmap
  - architecture.md with system design
  - changelog.md (this file)
  - Project_status.md with progress tracking

### Security
- Implemented secure encryption following industry best practices
- Private keys never stored in plaintext
- Memory cleared after cryptographic operations
