# Changelog - Solana Trading Bot

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
