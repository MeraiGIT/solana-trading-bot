-- Solana Trading Bot Database Schema
-- Run this in Supabase SQL Editor
-- Tables use 'tb_' prefix to avoid conflicts

-- ============================================
-- WALLETS TABLE
-- Stores encrypted private keys for users
-- ============================================
CREATE TABLE IF NOT EXISTS tb_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL UNIQUE,
  public_address TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  key_salt TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  is_imported BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_tb_wallets_user_id ON tb_wallets(user_id);

-- ============================================
-- POSITIONS TABLE
-- Tracks current token holdings
-- ============================================
CREATE TABLE IF NOT EXISTS tb_positions (
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

-- Index for user positions
CREATE INDEX IF NOT EXISTS idx_tb_positions_user_id ON tb_positions(user_id);

-- ============================================
-- LIMIT ORDERS TABLE
-- SL/TP orders
-- ============================================
CREATE TABLE IF NOT EXISTS tb_limit_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  position_id UUID REFERENCES tb_positions(id) ON DELETE CASCADE,
  order_type TEXT NOT NULL CHECK (order_type IN ('stop_loss', 'take_profit')),
  trigger_price DECIMAL NOT NULL,
  sell_percentage INTEGER DEFAULT 100 CHECK (sell_percentage > 0 AND sell_percentage <= 100),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for active orders (used by price monitor)
CREATE INDEX IF NOT EXISTS idx_tb_limit_orders_active ON tb_limit_orders(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_tb_limit_orders_user_id ON tb_limit_orders(user_id);

-- ============================================
-- TRANSACTIONS TABLE
-- Trade history and audit log
-- ============================================
CREATE TABLE IF NOT EXISTS tb_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell', 'deposit', 'withdraw')),
  token_address TEXT,
  token_symbol TEXT,
  amount_tokens DECIMAL,
  amount_sol DECIMAL,
  price_usd DECIMAL,
  tx_signature TEXT,
  dex_used TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user transactions
CREATE INDEX IF NOT EXISTS idx_tb_transactions_user_id ON tb_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tb_transactions_created_at ON tb_transactions(created_at DESC);

-- ============================================
-- USER SETTINGS TABLE
-- Trading preferences
-- ============================================
CREATE TABLE IF NOT EXISTS tb_user_settings (
  user_id BIGINT PRIMARY KEY,
  default_buy_sol DECIMAL DEFAULT 0.1,
  default_slippage INTEGER DEFAULT 5 CHECK (default_slippage >= 1 AND default_slippage <= 50),
  auto_sl_percent INTEGER CHECK (auto_sl_percent IS NULL OR (auto_sl_percent >= 1 AND auto_sl_percent <= 99)),
  auto_tp_percent INTEGER CHECK (auto_tp_percent IS NULL OR (auto_tp_percent >= 1 AND auto_tp_percent <= 1000)),
  notifications_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- Users can only access their own data
-- ============================================

-- Enable RLS on all tables
ALTER TABLE tb_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tb_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tb_limit_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE tb_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tb_user_settings ENABLE ROW LEVEL SECURITY;

-- Note: For server-side access (bot), you'll use the service role key
-- which bypasses RLS. These policies are for any direct client access.

-- Wallets: Users can only see/modify their own wallet
CREATE POLICY "Users can view own wallet"
  ON tb_wallets FOR SELECT
  USING (true);  -- Service role bypasses, no user auth in bot

CREATE POLICY "Users can insert own wallet"
  ON tb_wallets FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own wallet"
  ON tb_wallets FOR UPDATE
  USING (true);

-- Positions: Users can only see/modify their own positions
CREATE POLICY "Users can view own positions"
  ON tb_positions FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own positions"
  ON tb_positions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own positions"
  ON tb_positions FOR UPDATE
  USING (true);

CREATE POLICY "Users can delete own positions"
  ON tb_positions FOR DELETE
  USING (true);

-- Limit Orders: Users can only see/modify their own orders
CREATE POLICY "Users can view own orders"
  ON tb_limit_orders FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own orders"
  ON tb_limit_orders FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own orders"
  ON tb_limit_orders FOR UPDATE
  USING (true);

-- Transactions: Users can only see their own transactions
CREATE POLICY "Users can view own transactions"
  ON tb_transactions FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own transactions"
  ON tb_transactions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own transactions"
  ON tb_transactions FOR UPDATE
  USING (true);

-- User Settings: Users can only see/modify their own settings
CREATE POLICY "Users can view own settings"
  ON tb_user_settings FOR SELECT
  USING (true);

CREATE POLICY "Users can upsert own settings"
  ON tb_user_settings FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own settings"
  ON tb_user_settings FOR UPDATE
  USING (true);

-- ============================================
-- DONE!
-- ============================================
-- Run this schema in Supabase SQL Editor
-- Make sure to use the day1-auth-learning project
