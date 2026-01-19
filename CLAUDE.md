# Solana Trading Bot - Claude Instructions

## Project Overview
A custodial Solana trading bot with:
- Telegram bot interface (Grammy)
- Direct DEX integration (Jupiter + PumpFun)
- Encrypted wallet management
- Multi-user support

---

## CRITICAL: Documentation Requirements

### Required Project Documents
You MUST maintain these 3 documents throughout development:

1. **architecture.md** - System design, app structure, how major components interact
2. **changelog.md** - A log of all changes made to the project over time
3. **Project_status.md** - Milestones, what's accomplished, where you left off

### Documentation Update Rules
**AFTER COMPLETING EVERY TASK**, you MUST:
1. Review if `architecture.md` needs updates (new components, changed interactions)
2. Add an entry to `changelog.md` with what was changed
3. Update `Project_status.md` with current progress and next steps
4. Review if `CLAUDE.md` needs any additions or modifications

**NEVER skip documentation updates.** This is mandatory for every completed task.

---

## CRITICAL: Git Workflow Requirements

### Repository Setup
- Initialize git repository
- Connect to GitHub remote when ready
- `.gitignore` includes: node_modules, .env, dist/, *.log

### Branch Strategy
- **main**: Production-ready code only
- **develop**: Integration branch for features
- **feature/<name>**: Individual feature branches

### Git Workflow (ALWAYS PUSH TO REMOTE)
1. **Create feature branch** before starting any new feature
2. **Make frequent commits AND push immediately**
3. **Merge to develop AND push** when feature is complete
4. **Merge to main AND push** only for releases

### Commit Message Format
Use conventional commits:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Adding tests
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

---

## CRITICAL: MCP Server Usage

### Supabase MCP
- **ALWAYS use the Supabase MCP server** for all database operations
- **USE ONLY**: `day1-auth-learning` project (AWS eu-west-1)
- **NEVER TOUCH**: `leonard-home-decor` project
- Use `mcp__supabase__apply_migration` for DDL operations
- Use `mcp__supabase__execute_sql` for queries

### Database Naming Convention (CRITICAL)
Use **`tb_`** prefix for Trading Bot tables:
- `tb_wallets` - User wallets (encrypted private keys)
- `tb_positions` - Current holdings
- `tb_limit_orders` - SL/TP orders
- `tb_transactions` - Transaction history
- `tb_user_settings` - User preferences

### Context7 MCP
- **ALWAYS use Context7** to look up documentation before implementing features
- Check docs for: Grammy.js, @solana/web3.js, Jupiter API

---

## CRITICAL: Testing & Verification Requirements

### For EVERY Feature Built:
1. **Write tests FIRST** (Jest for TypeScript)
2. **Run the tests** - feature is NOT complete until tests pass
3. **Check logs** for errors or warnings
4. **Only mark task complete** when ALL of the above pass

### Test Requirements:
- Unit tests for encryption module
- Unit tests for wallet management
- Unit tests for trading functions
- Integration tests for bot commands
- **Keep iterating until ALL tests pass**

### DO NOT mark a task as complete if:
- Any test is failing
- There are errors in the logs
- Bot commands don't work as expected

---

## Task Completion Checklist

Before marking ANY task as complete, verify:
- [ ] All tests pass
- [ ] No errors in logs
- [ ] Functionality verified
- [ ] `architecture.md` updated (if architecture changed)
- [ ] `changelog.md` entry added
- [ ] `Project_status.md` updated with progress
- [ ] Changes committed to Git with proper message
- [ ] Branch pushed to remote

---

## Security Rules (CRITICAL)

### Private Keys
- NEVER log private keys
- NEVER expose master encryption key
- ALWAYS clear sensitive data from memory after use
- Use `secureZero()` function to wipe buffers

### API Keys
- Store ALL secrets in environment variables
- Use `.env.example` for documentation (never real values)
- Validate all required env vars at startup

### Encryption
- Use AES-256-GCM for all private key encryption
- Generate unique salt per user
- Use PBKDF2 with high iteration count for key derivation

---

## Development Commands

**Development mode** (with hot reload):
```bash
npm run dev
```

**Build TypeScript**:
```bash
npm run build
```

**Production mode**:
```bash
npm start
```

**Run tests**:
```bash
npm test
```

---

## Architecture Overview

```
src/
├── index.ts              # Entry point
├── bot/
│   ├── bot.ts            # Grammy bot setup
│   ├── commands/         # Bot commands (/start, /wallet, etc.)
│   ├── handlers/         # Message and callback handlers
│   └── keyboards/        # Inline keyboard builders
├── trading/
│   ├── router.ts         # DEX routing (Jupiter vs PumpFun)
│   ├── jupiter.ts        # Jupiter API client
│   ├── pumpfun.ts        # PumpPortal API client
│   ├── executor.ts       # Transaction signing & sending
│   └── priceMonitor.ts   # SL/TP monitoring service
├── wallet/
│   ├── encryption.ts     # AES-256-GCM encryption
│   ├── manager.ts        # Wallet CRUD operations
│   └── balance.ts        # Balance queries
├── services/
│   ├── database.ts       # Supabase client
│   └── rpc.ts            # Solana RPC connection
└── utils/
    ├── validation.ts     # Input validation
    ├── formatting.ts     # Number/price formatting
    └── logger.ts         # Structured logging
```

---

## Trading Integration

### Jupiter API (Main DEX Aggregator)
- Endpoint: `https://quote-api.jup.ag/v6/`
- Handles 95% of tokens (aggregates Raydium, Orca, Meteora, etc.)

### PumpPortal API (PumpFun Tokens)
- Endpoint: `https://pumpportal.fun/api/trade-local`
- Required for tokens on PumpFun bonding curve (before graduation)
- Supports pools: pump, raydium, pump-amm, launchlab, raydium-cpmm

### DEX Router Logic
```
If token is on PumpFun bonding curve:
  → Use PumpPortal API
Else:
  → Use Jupiter API (best price aggregation)
```

---

## Environment Variables

Required in .env:
- `BOT_TOKEN` - Telegram bot token from @BotFather
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anon/public key
- `SOLANA_RPC_URL` - Solana RPC endpoint
- `MASTER_ENCRYPTION_KEY` - 32-byte hex key for wallet encryption

---

## Debugging Tips

### Common Issues
1. **Encryption errors** - Check master key format (64 hex chars)
2. **Transaction failures** - Check RPC connection, balance, slippage
3. **Bot not responding** - Check BOT_TOKEN is valid

### Viewing Logs
```bash
# Development logs shown in terminal running npm run dev
# Filter for specific modules
grep "wallet" logs/*.log
grep "trading" logs/*.log
```
