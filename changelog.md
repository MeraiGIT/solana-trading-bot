# Changelog - Solana Trading Bot

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
