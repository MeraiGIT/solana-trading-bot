# Architecture - Solana Trading Bot

## Overview

A custodial Solana trading bot with direct DEX integration, designed for multi-user support via Telegram.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USERS                                    │
│                    (Telegram Chat)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TELEGRAM BOT LAYER                           │
│                       (Grammy.js)                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Commands: /start /wallet /trade /positions /settings   │   │
│  │  Handlers: Callbacks, Messages, Token addresses         │   │
│  │  Keyboards: Inline menus, Quick actions                 │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐    │
│  │   WALLET    │  │   TRADING   │  │   PRICE MONITOR    │    │
│  │   MANAGER   │  │   ENGINE    │  │   (SL/TP Service)  │    │
│  ├─────────────┤  ├─────────────┤  ├─────────────────────┤    │
│  │ • Generate  │  │ • DEX Router│  │ • Watch positions  │    │
│  │ • Import    │  │ • Jupiter   │  │ • Trigger orders   │    │
│  │ • Encrypt   │  │ • PumpPortal│  │ • Execute sells    │    │
│  │ • Balance   │  │ • Execute   │  │                    │    │
│  └─────────────┘  └─────────────┘  └─────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    SUPABASE     │ │   SOLANA RPC    │ │   DEX APIs      │
│    DATABASE     │ │   (Blockchain)  │ │                 │
├─────────────────┤ ├─────────────────┤ ├─────────────────┤
│ • tb_wallets    │ │ • Send TX       │ │ • Jupiter       │
│ • tb_positions  │ │ • Get balance   │ │ • PumpPortal    │
│ • tb_orders     │ │ • Confirm TX    │ │ • DexScreener   │
│ • tb_transactions│ │                │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## Component Details

### 1. Telegram Bot Layer (`src/bot/`)

**Purpose**: Handle all user interactions via Telegram

| Component | File | Description |
|-----------|------|-------------|
| Bot Setup | `bot.ts` | Grammy initialization, middleware |
| Commands | `commands/*.ts` | Slash command handlers |
| Callbacks | `handlers/callback.ts` | Inline button callbacks |
| Messages | `handlers/message.ts` | Text message handling |
| Keyboards | `keyboards/menus.ts` | Inline keyboard builders |

**Flow**:
1. User sends command or clicks button
2. Handler processes request
3. Calls appropriate service (wallet/trading)
4. Updates UI with result

### 2. Wallet Manager (`src/wallet/`)

**Purpose**: Secure wallet creation, import, and management

| Component | File | Description |
|-----------|------|-------------|
| Encryption | `encryption.ts` | AES-256-GCM encrypt/decrypt |
| Manager | `manager.ts` | Wallet CRUD operations |

**Security Flow**:
```
Private Key → PBKDF2(master_key + salt + user_id) → AES-256-GCM → Database
```

**Key Features**:
- HD wallet generation (BIP39/BIP44)
- Base58 private key import
- Secure encryption with per-user salt
- Memory clearing after operations

### 3. Trading Engine (`src/trading/`)

**Purpose**: Execute trades on Solana DEXs with MEV protection

| Component | File | Description |
|-----------|------|-------------|
| Router | `router.ts` | Auto-selects Jupiter or PumpPortal |
| Jupiter | `jupiter.ts` | Jupiter API v1 client with Jito integration |
| PumpPortal | `pumpfun.ts` | PumpPortal API client |
| TokenInfo | `tokenInfo.ts` | DexScreener price/info service |
| PriceMonitor | `priceMonitor.ts` | SL/TP background monitoring |
| Jito | `jito.ts` | Jito bundle client for MEV protection |
| PriorityFee | `priorityFee.ts` | Dynamic priority fee service |

**DEX Selection Logic**:
```typescript
async selectDex(tokenMint: string): Promise<'jupiter' | 'pumpfun'> {
  const info = await this.tokenInfo.getTokenInfo(tokenMint);
  if (info?.isPumpFun && info.onBondingCurve) {
    return 'pumpfun';  // Use PumpPortal for bonding curve
  }
  return 'jupiter';    // Jupiter for everything else
}
```

**MEV Protection Features**:
- **Jito Bundles**: Private mempool submission for hiding transactions from MEV bots
- **Dynamic Priority Fees**: Fetched from Helius API or RPC based on network conditions
- Priority fees scale with trade value (higher value = higher fee)
- Retry with exponential backoff
- Transaction confirmation waiting
- Auto pool selection (PumpPortal)

### 4. Price Monitor (`src/trading/priceMonitor.ts`)

**Purpose**: Monitor positions and execute SL/TP orders

**Flow**:
1. Poll active limit orders from database
2. Check current price vs trigger price
3. If triggered, execute sell via trading engine
4. Update order status and notify user

### 5. MEV Protection (`src/trading/jito.ts`, `src/trading/priorityFee.ts`)

**Purpose**: Protect trades from frontrunning and sandwich attacks

**Components**:

1. **Jito Bundle Client** (`jito.ts`)
   - Sends transactions through Jito's private mempool
   - Transactions hidden from MEV bots until block inclusion
   - Automatic tip transactions to Jito validators
   - Bundle status tracking and confirmation

2. **Priority Fee Service** (`priorityFee.ts`)
   - Fetches current network conditions from Helius API
   - Falls back to RPC-based estimation if Helius unavailable
   - Dynamic fee calculation based on trade value and urgency
   - Caches estimates for 10 seconds to reduce API calls

**MEV Protection Flow**:
```
1. Trade requested
2. Calculate dynamic priority fee (based on trade value)
3. Build swap transaction via Jupiter/PumpPortal
4. If Jito enabled:
   a. Create tip transaction
   b. Bundle swap + tip transactions
   c. Submit to Jito block engine
   d. Wait for confirmation
5. If Jito fails or disabled:
   a. Submit via regular RPC with high priority fee
   b. Retry with exponential backoff
```

**Configuration** (via environment variables):
```
USE_JITO=true              # Enable/disable Jito bundles
JITO_TIP_LAMPORTS=10000    # Default tip amount (0.00001 SOL)
HELIUS_API_KEY=xxx         # For dynamic priority fee estimates
```

---

## Database Schema

### Tables (Supabase - tb_ prefix)

```
tb_wallets
├── id (UUID, PK)
├── user_id (BIGINT, unique)
├── public_address (TEXT)
├── encrypted_private_key (TEXT)
├── key_salt (TEXT)
├── key_iv (TEXT)
├── is_imported (BOOLEAN)
└── created_at (TIMESTAMPTZ)

tb_positions
├── id (UUID, PK)
├── user_id (BIGINT)
├── token_address (TEXT)
├── token_symbol (TEXT)
├── amount (DECIMAL)
├── entry_price_usd (DECIMAL)
├── entry_sol (DECIMAL)
└── created_at (TIMESTAMPTZ)

tb_limit_orders
├── id (UUID, PK)
├── user_id (BIGINT)
├── position_id (UUID, FK)
├── order_type (TEXT: 'stop_loss' | 'take_profit')
├── trigger_price (DECIMAL)
├── sell_percentage (INTEGER)
├── status (TEXT: 'active' | 'triggered' | 'cancelled')
└── created_at (TIMESTAMPTZ)

tb_transactions
├── id (UUID, PK)
├── user_id (BIGINT)
├── type (TEXT: 'buy' | 'sell' | 'deposit' | 'withdraw')
├── token_address (TEXT)
├── amount_sol (DECIMAL)
├── tx_signature (TEXT)
├── status (TEXT)
└── created_at (TIMESTAMPTZ)

tb_user_settings
├── user_id (BIGINT, PK)
├── default_buy_sol (DECIMAL)
├── default_slippage (INTEGER)
├── auto_sl_percent (INTEGER)
├── auto_tp_percent (INTEGER)
└── notifications_enabled (BOOLEAN)
```

---

## External APIs

### Jupiter API
- **Base URL**: `https://api.jup.ag/swap/v1/`
- **Endpoints**: `/quote`, `/swap`
- **Purpose**: Get quotes and execute swaps across 20+ DEXs
- **Features**: Dynamic slippage, compute budget, shared accounts

### PumpPortal API
- **Base URL**: `https://pumpportal.fun/api/`
- **Endpoints**: `/trade-local`
- **Purpose**: Trade PumpFun bonding curve tokens
- **Fee**: 0.5% per trade

### DexScreener API
- **Base URL**: `https://api.dexscreener.com/latest/`
- **Endpoints**: `/dex/tokens/{address}`
- **Purpose**: Get token info, price, liquidity

### Solana RPC
- **Default**: `https://api.mainnet-beta.solana.com`
- **Recommended**: Helius or QuickNode (private RPC for MEV protection)
- **Purpose**: Send transactions, get balances

### Jito Block Engine API
- **Base URL**: `https://mainnet.block-engine.jito.wtf`
- **Alt Endpoints**: amsterdam, frankfurt, ny, tokyo
- **Endpoints**: `/api/v1/bundles` (sendBundle, getBundleStatuses)
- **Purpose**: Private mempool for MEV-protected transaction submission
- **Tip Floor API**: `https://bundles.jito.wtf/api/v1/bundles/tip_floor`

### Helius API
- **Base URL**: `https://mainnet.helius-rpc.com`
- **Endpoint**: `getPriorityFeeEstimate` (JSON-RPC)
- **Purpose**: Get current network priority fee recommendations

---

## Security Architecture

### Encryption Layers

1. **Master Key** (Environment variable)
   - 32-byte hex key stored in Railway secrets
   - Never logged or exposed

2. **User Salt** (Database)
   - Unique random salt per user
   - Stored alongside encrypted key

3. **Derived Key** (In memory only)
   - PBKDF2(master_key, salt + user_id, 100000 iterations)
   - Cleared from memory after use

4. **Encrypted Private Key** (Database)
   - AES-256-GCM encrypted
   - Includes auth tag for tamper detection

### Access Control

- Users can only access their own wallet
- RLS policies enforce user isolation
- All operations require valid user_id

---

## Data Flow Examples

### Buy Token Flow
```
1. User: Sends token address
2. Bot: Fetches token info from DexScreener
3. Bot: Shows token details + buy buttons
4. User: Clicks "0.5 SOL"
5. Bot: Confirms purchase details
6. User: Clicks "CONFIRM BUY"
7. Trading Engine:
   a. Get wallet keypair (decrypt)
   b. Get quote from Jupiter/PumpPortal
   c. Build transaction
   d. Sign transaction
   e. Send to RPC
   f. Wait for confirmation
8. Bot: Updates position in database
9. Bot: Shows success message with TX link
```

### SL/TP Monitoring Flow
```
1. Price Monitor: Polls every 10 seconds
2. For each active order:
   a. Get current price from DexScreener
   b. Check if trigger price hit
   c. If triggered:
      - Execute sell via trading engine
      - Update order status to 'triggered'
      - Notify user via Telegram
```

---

## Deployment

### Railway Configuration
- **Service**: Node.js
- **Build**: `npm run build`
- **Start**: `npm start`
- **Health Check**: HTTP endpoint on port 3000

### Environment Variables
```
BOT_TOKEN                # Telegram bot token
SUPABASE_URL             # Supabase project URL
SUPABASE_ANON_KEY        # Supabase anon key
SOLANA_RPC_URL           # Solana RPC endpoint
MASTER_ENCRYPTION_KEY    # 64-char hex key for wallet encryption
HELIUS_API_KEY           # (Optional) For dynamic priority fees
USE_JITO                 # (Optional) Enable Jito bundles (default: true)
JITO_TIP_LAMPORTS        # (Optional) Default Jito tip (default: 10000)
```
