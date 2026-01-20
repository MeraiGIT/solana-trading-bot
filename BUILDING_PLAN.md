# Solana Trading Bot - Building Plan

> **Project Goal**: Build a custodial Solana trading bot that replaces Trojan Bot dependency
> **Target**: Multi-user support, direct DEX integration, professional Telegram UI

---

## Why We're Building This

The copy-trading-bot currently uses Trojan Bot via Telethon userbot, which has major limitations:
1. **Single user** - One Telegram account = one Trojan wallet
2. **Account risk** - Userbot can get banned by Telegram
3. **Slow execution** - Button clicking takes 5-10 seconds
4. **No control** - Dependent on Trojan's UI/availability

This new bot solves all these problems by trading directly with DEXs.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    TELEGRAM USERS                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 GRAMMY TELEGRAM BOT                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐   │
│  │   Wallet    │ │   Trading   │ │    Copy Trading         │   │
│  │   Commands  │ │   Commands  │ │    (Future)             │   │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TRADING ENGINE                                │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐   │
│  │   Wallet    │ │   DEX       │ │    Order                │   │
│  │   Manager   │ │   Router    │ │    Manager              │   │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘   │
│         │               │                    │                  │
│         ▼               ▼                    ▼                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐   │
│  │  Encrypted  │ │  Jupiter    │ │    Price Monitor        │   │
│  │  Key Store  │ │  + PumpFun  │ │    (SL/TP)              │   │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SUPABASE                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ Wallets  │ │Positions │ │  Orders  │ │   Transactions   │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## DEX Integration Strategy

### Jupiter API (Primary - 95% of trades)
- **What**: Aggregator that routes through 20+ DEXs
- **Endpoint**: `https://quote-api.jup.ag/v6/`
- **Covers**: Raydium, Orca, Meteora, Lifinity, Phoenix, etc.
- **Use for**: Any token that's graduated from PumpFun

### PumpPortal API (PumpFun tokens)
- **What**: Third-party API for PumpFun bonding curve trades
- **Endpoint**: `https://pumpportal.fun/api/trade-local`
- **Covers**: PumpFun tokens before and after graduation
- **Pools**: pump, raydium, pump-amm, launchlab, raydium-cpmm, bonk, auto
- **Fee**: 0.5% per trade

### Router Logic
```
1. Check if token is on PumpFun bonding curve
2. If yes → Use PumpPortal API
3. If no → Use Jupiter API
4. Jupiter finds best price across all DEXs
```

---

## Security Architecture

### Encryption Strategy (AES-256-GCM)

```
User's Private Key (raw bytes)
         │
         ▼
┌─────────────────────────────────────┐
│  AES-256-GCM Encryption             │
│  Key = PBKDF2(                      │
│    MASTER_KEY +                     │  ◄── From Railway secrets
│    user_salt +                      │  ◄── Random per user (stored in DB)
│    user_id                          │
│  )                                  │
└─────────────────────────────────────┘
         │
         ▼
Encrypted key stored in database
(cannot be decrypted without MASTER_KEY)
```

### Security Layers

| Layer | Protection | Implementation |
|-------|------------|----------------|
| **At Rest** | AES-256-GCM encryption | Node crypto module |
| **In Transit** | HTTPS only | Railway auto-TLS |
| **Key Derivation** | PBKDF2 with salt | Unique per user |
| **Memory** | Clear after use | Zero-fill buffers |
| **Access Control** | User can only access own wallet | RLS policies |

### Additional Safeguards
- Withdrawal confirmation via Telegram
- 24h delay for large withdrawals (configurable)
- Daily withdrawal limits
- Private key export requires rate limiting
- All operations audit logged

---

## UI/UX Design

### Main Menu Structure
```
🏠 MAIN MENU
━━━━━━━━━━━━━━━━━━━━━━━━
┌─────────────────────────┐
│  💰 Wallet              │  → Balance, Deposit, Withdraw
│  📈 Trade               │  → Quick buy/sell
│  📊 Positions           │  → Open positions, P&L
│  📋 Orders              │  → Limit orders, SL/TP
│  🔔 Copy Trading        │  → Follow influencers (future)
│  ⚙️ Settings            │  → Preferences
│  ❓ Help                │  → Guide, support
└─────────────────────────┘
```

### Wallet Screen
```
💰 WALLET
━━━━━━━━━━━━━━━━━━━━━━━━

Balance: 2.45 SOL ($367.50)

📥 Deposit Address:
`7xKXtg2...` [Copy]

[QR CODE HERE]

━━━━━━━━━━━━━━━━━━━━━━━━
[📤 Withdraw] [🔑 Export Key] [🔄 Refresh]
```

### Quick Trade Screen
```
📈 BUY TOKEN
━━━━━━━━━━━━━━━━━━━━━━━━

Paste token address or ticker:
▼ Waiting for input...

━━━━━━━━━━━━━━━━━━━━━━━━
Quick amounts:
[0.1 SOL] [0.5 SOL] [1 SOL] [✏️ Custom]

Slippage: 5% [Change]
━━━━━━━━━━━━━━━━━━━━━━━━
[❌ Cancel]
```

### Token Info + Buy Confirmation
```
🪙 BONK
━━━━━━━━━━━━━━━━━━━━━━━━
Price: $0.00001842
24h: +12.5% 📈
Liquidity: $2.4M
Volume: $890K

DEX: Jupiter (via Raydium)
━━━━━━━━━━━━━━━━━━━━━━━━
Buy: 0.5 SOL (~$75)
Est. tokens: 4,071,661 BONK
Slippage: 5%
━━━━━━━━━━━━━━━━━━━━━━━━
[✅ CONFIRM BUY] [❌ Cancel]
```

### Position View
```
📊 YOUR POSITIONS
━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ BONK
   Entry: $0.00001650
   Current: $0.00001842 (+11.6% 📈)
   Holdings: 4,071,661 tokens
   Value: 0.56 SOL ($84)
   P&L: +$9.24
   [Sell 25%] [Sell 50%] [Sell 100%]
   [Set SL/TP]

━━━━━━━━━━━━━━━━━━━━━━━━
Total P&L: +$4.12 (+2.1%)
[🔄 Refresh]
```

### Set SL/TP
```
⚙️ SET SL/TP FOR BONK
━━━━━━━━━━━━━━━━━━━━━━━━
Entry: $0.00001650
Current: $0.00001842

🛑 Stop Loss:
[-10%] [-20%] [-30%] [Custom]

🎯 Take Profit:
[+25%] [+50%] [+100%] [Custom]

━━━━━━━━━━━━━━━━━━━━━━━━
[✅ Save Orders] [❌ Cancel]
```

---

## Database Schema

```sql
-- User wallets (encrypted private keys)
CREATE TABLE tb_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL UNIQUE,
  public_address TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  key_salt TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  is_imported BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User positions (current holdings)
CREATE TABLE tb_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  token_decimals INTEGER,
  amount DECIMAL NOT NULL,
  entry_price_usd DECIMAL,
  entry_sol DECIMAL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token_address)
);

-- Limit orders (SL/TP)
CREATE TABLE tb_limit_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  position_id UUID REFERENCES tb_positions(id),
  order_type TEXT NOT NULL,  -- 'stop_loss', 'take_profit'
  trigger_price DECIMAL NOT NULL,
  sell_percentage INTEGER DEFAULT 100,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transaction history
CREATE TABLE tb_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  type TEXT NOT NULL,  -- 'buy', 'sell', 'deposit', 'withdraw'
  token_address TEXT,
  token_symbol TEXT,
  amount_tokens DECIMAL,
  amount_sol DECIMAL,
  price_usd DECIMAL,
  tx_signature TEXT,
  dex_used TEXT,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User settings
CREATE TABLE tb_user_settings (
  user_id BIGINT PRIMARY KEY,
  default_buy_sol DECIMAL DEFAULT 0.1,
  default_slippage INTEGER DEFAULT 5,
  auto_sl_percent INTEGER,
  auto_tp_percent INTEGER,
  notifications_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Project Structure

```
solana-trading-bot/
├── src/
│   ├── index.ts                 # Entry point
│   ├── bot/
│   │   ├── bot.ts               # Grammy bot setup
│   │   ├── commands/
│   │   │   ├── start.ts         # /start command
│   │   │   ├── wallet.ts        # Wallet management
│   │   │   ├── trade.ts         # Buy/sell commands
│   │   │   ├── positions.ts     # View positions
│   │   │   ├── orders.ts        # Limit orders
│   │   │   └── settings.ts      # User settings
│   │   ├── handlers/
│   │   │   ├── callback.ts      # Button callbacks
│   │   │   └── message.ts       # Text messages
│   │   └── keyboards/
│   │       └── menus.ts         # Inline keyboard builders
│   │
│   ├── trading/
│   │   ├── router.ts            # Routes to Jupiter or PumpFun
│   │   ├── jupiter.ts           # Jupiter API client
│   │   ├── pumpfun.ts           # PumpPortal API client
│   │   ├── executor.ts          # Transaction signing & sending
│   │   └── priceMonitor.ts      # SL/TP monitoring
│   │
│   ├── wallet/
│   │   ├── manager.ts           # Wallet CRUD operations
│   │   ├── encryption.ts        # AES-256-GCM encryption
│   │   └── balance.ts           # Balance queries
│   │
│   ├── services/
│   │   ├── database.ts          # Supabase client
│   │   └── rpc.ts               # Solana RPC connection
│   │
│   └── utils/
│       ├── validation.ts        # Input validation
│       ├── formatting.ts        # Number/price formatting
│       └── logger.ts            # Structured logging
│
├── tests/
├── .env.example
├── package.json
├── tsconfig.json
├── CLAUDE.md
├── BUILDING_PLAN.md
├── architecture.md
├── changelog.md
└── Project_status.md
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [x] Project setup (TypeScript, Grammy, dependencies)
- [x] Wallet encryption module (AES-256-GCM)
- [x] Wallet manager (generate/import/export)
- [x] Database schema & Supabase setup
- [x] Basic bot with /start command
- [x] Wallet commands (/wallet, deposit)
- [x] Withdraw SOL functionality ✅

### Phase 2: Trading Engine (Week 2)
- [x] Jupiter API integration (quotes, swaps)
- [x] PumpPortal API integration (PumpFun tokens)
- [x] DEX router (auto-select Jupiter vs PumpFun)
- [x] Transaction signing & execution
- [x] Buy/sell commands
- [x] Token info display (DexScreener)

### Phase 3: Position Management (Week 3)
- [x] Position tracking after buys
- [x] Real-time P&L calculation
- [x] Price monitoring service (auto-started on bot startup) ✅
- [x] SL/TP order creation
- [x] SL/TP order execution
- [x] Transaction history VIEW ✅

### Phase 4: Polish & Security (Week 4)
- [x] Withdrawal confirmations ✅
- [x] Daily withdrawal limits ✅
- [x] Large withdrawal warnings ✅
- [x] Settings menu with all options ✅
- [x] Error handling & retry logic (partial)
- [x] MEV protection (Jito bundles + dynamic priority fees)
- [ ] **Rate limiting** - Not built (not critical)
- [ ] **Comprehensive testing** - Not built (not critical)
- [x] Documentation (architecture.md, changelog.md, Project_status.md)

### Phase 5: Copy Trading Migration (Week 5)
- [ ] Integrate with existing copy-trading-bot
- [ ] Replace Trojan calls with our trading API
- [ ] Signal detection → auto-trade flow
- [ ] End-to-end testing

---

## ✅ FEATURES STATUS SUMMARY

### ✅ All Critical Features Built
1. **Withdraw SOL** ✅ - Full withdrawal flow with confirmation
2. **Price Monitor Auto-Start** ✅ - SL/TP triggers automatically on bot startup

### ✅ All Important Features Built
3. **Settings Menu** ✅ - Full settings with buy amount, slippage, auto SL/TP, withdrawal limits
4. **Transaction History View** ✅ - Paginated history with /history command

### ✅ Nice to Have Features Built
5. **QR Code for Deposit** ✅ - QR code generated with address
6. **Withdrawal Limits/Delays** ✅ - Daily limits, large withdrawal warnings

### Remaining Optional Features
7. **Rate Limiting** - Not critical, can be added later
8. **Comprehensive Testing** - Not critical, can be added later

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Bot Framework** | Grammy.js |
| **Language** | TypeScript |
| **Database** | Supabase (PostgreSQL) |
| **Blockchain** | @solana/web3.js |
| **DEX (General)** | Jupiter Ultra API |
| **DEX (PumpFun)** | PumpPortal API |
| **Encryption** | Node.js crypto (AES-256-GCM) |
| **Deployment** | Railway |
| **RPC** | Helius or QuickNode (private) |

---

## API Endpoints Reference

### Jupiter API
```
GET  https://quote-api.jup.ag/v6/quote
     ?inputMint=So11111111111111111111111111111111111111112
     &outputMint=<token_address>
     &amount=<lamports>
     &slippageBps=500

POST https://quote-api.jup.ag/v6/swap
     Body: { quoteResponse, userPublicKey, ... }
```

### PumpPortal API
```
POST https://pumpportal.fun/api/trade-local
     Body: {
       publicKey: "wallet_address",
       action: "buy" | "sell",
       mint: "token_address",
       amount: 0.1,
       denominatedInSol: true,
       slippage: 5,
       priorityFee: 0.0001,
       pool: "auto"
     }
```

### DexScreener API (Token Info)
```
GET https://api.dexscreener.com/latest/dex/tokens/<token_address>
```

---

## Environment Variables

```env
# Telegram Bot
BOT_TOKEN=your_bot_token_from_botfather

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key

# Solana RPC (use private RPC for MEV protection)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
HELIUS_API_KEY=optional_for_enhanced_features

# Encryption (CRITICAL - generate with crypto.randomBytes(32).toString('hex'))
MASTER_ENCRYPTION_KEY=your_64_char_hex_key

# Trading Defaults
DEFAULT_SLIPPAGE_BPS=500
MAX_PRIORITY_FEE_LAMPORTS=100000

# Logging
LOG_LEVEL=info
```

---

## Success Metrics

When complete, the bot should:
1. ✅ Create/import wallets securely
2. ✅ Show real-time balance
3. ✅ Execute buys via Jupiter (< 2 seconds)
4. ✅ Execute buys on PumpFun tokens
5. ✅ Track positions with P&L
6. ✅ Execute SL/TP automatically
7. ✅ Support unlimited users
8. ✅ Handle errors gracefully

---

## Migration Path from Copy-Trading-Bot

Once this bot is complete:
1. Add API endpoint to accept trade requests
2. Copy-trading-bot calls our API instead of Trojan
3. Remove Telethon userbot dependency
4. Single deployment handles everything
