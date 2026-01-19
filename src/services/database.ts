/**
 * Database service for Supabase operations.
 *
 * All tables use the 'tb_' prefix to avoid conflicts with other apps.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { appConfig } from '../utils/env.js';
import { WalletData } from '../wallet/manager.js';

/**
 * Position data structure.
 */
export interface Position {
  id: string;
  userId: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  amount: number;
  entryPriceUsd: number | null;
  entrySol: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Limit order data structure.
 */
export interface LimitOrder {
  id: string;
  userId: string;
  positionId: string;
  orderType: 'stop_loss' | 'take_profit';
  triggerPrice: number;
  sellPercentage: number;
  status: 'active' | 'triggered' | 'cancelled';
  createdAt: Date;
}

/**
 * Transaction record.
 */
export interface Transaction {
  id: string;
  userId: string;
  type: 'buy' | 'sell' | 'deposit' | 'withdraw';
  tokenAddress: string | null;
  tokenSymbol: string | null;
  amountTokens: number | null;
  amountSol: number | null;
  priceUsd: number | null;
  txSignature: string | null;
  dexUsed: string | null;
  status: 'pending' | 'success' | 'failed';
  errorMessage: string | null;
  createdAt: Date;
}

/**
 * User settings.
 */
export interface UserSettings {
  userId: string;
  defaultBuySol: number;
  defaultSlippage: number;
  autoSlPercent: number | null;
  autoTpPercent: number | null;
  notificationsEnabled: boolean;
  createdAt: Date;
}

/**
 * Database service class.
 */
export class Database {
  private client: SupabaseClient;

  constructor() {
    this.client = createClient(
      appConfig.supabaseUrl,
      appConfig.supabaseAnonKey
    );
  }

  // ============================================
  // WALLET OPERATIONS
  // ============================================

  /**
   * Get wallet for a user.
   */
  async getWallet(userId: string): Promise<WalletData | null> {
    const { data, error } = await this.client
      .from('tb_wallets')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapWalletFromDb(data);
  }

  /**
   * Create or update a wallet.
   */
  async upsertWallet(wallet: WalletData): Promise<boolean> {
    console.log('Upserting wallet for user:', wallet.userId);
    console.log('Public address:', wallet.publicAddress);

    const { error } = await this.client
      .from('tb_wallets')
      .upsert({
        user_id: wallet.userId,
        public_address: wallet.publicAddress,
        encrypted_private_key: wallet.encryptedPrivateKey,
        key_salt: wallet.salt,
        key_iv: wallet.iv,
        auth_tag: wallet.authTag,
        is_imported: wallet.isImported,
      }, {
        onConflict: 'user_id'
      });

    if (error) {
      console.error('Supabase upsert error:', error.message);
      console.error('Error details:', error);
    }

    return !error;
  }

  /**
   * Check if user has a wallet.
   */
  async hasWallet(userId: string): Promise<boolean> {
    const { data } = await this.client
      .from('tb_wallets')
      .select('id')
      .eq('user_id', userId)
      .single();

    return !!data;
  }

  /**
   * Delete a wallet.
   */
  async deleteWallet(userId: string): Promise<boolean> {
    const { error } = await this.client
      .from('tb_wallets')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Supabase delete error:', error.message);
    }

    return !error;
  }

  // ============================================
  // POSITION OPERATIONS
  // ============================================

  /**
   * Get all positions for a user.
   */
  async getPositions(userId: string): Promise<Position[]> {
    const { data, error } = await this.client
      .from('tb_positions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map(this.mapPositionFromDb);
  }

  /**
   * Get a specific position.
   */
  async getPosition(userId: string, tokenAddress: string): Promise<Position | null> {
    const { data, error } = await this.client
      .from('tb_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('token_address', tokenAddress)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapPositionFromDb(data);
  }

  /**
   * Create or update a position.
   */
  async upsertPosition(position: Omit<Position, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> {
    const { data } = await this.client
      .from('tb_positions')
      .upsert({
        user_id: position.userId,
        token_address: position.tokenAddress,
        token_symbol: position.tokenSymbol,
        token_decimals: position.tokenDecimals,
        amount: position.amount,
        entry_price_usd: position.entryPriceUsd,
        entry_sol: position.entrySol,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,token_address'
      })
      .select('id')
      .single();

    return data?.id || null;
  }

  /**
   * Delete a position (when fully sold).
   */
  async deletePosition(userId: string, tokenAddress: string): Promise<boolean> {
    const { error } = await this.client
      .from('tb_positions')
      .delete()
      .eq('user_id', userId)
      .eq('token_address', tokenAddress);

    return !error;
  }

  // ============================================
  // LIMIT ORDER OPERATIONS
  // ============================================

  /**
   * Get active limit orders for a user.
   */
  async getActiveLimitOrders(userId: string): Promise<LimitOrder[]> {
    const { data, error } = await this.client
      .from('tb_limit_orders')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error || !data) {
      return [];
    }

    return data.map(this.mapLimitOrderFromDb);
  }

  /**
   * Get all active limit orders (for monitoring service).
   */
  async getAllActiveLimitOrders(): Promise<LimitOrder[]> {
    const { data, error } = await this.client
      .from('tb_limit_orders')
      .select('*')
      .eq('status', 'active');

    if (error || !data) {
      return [];
    }

    return data.map(this.mapLimitOrderFromDb);
  }

  /**
   * Create a limit order.
   */
  async createLimitOrder(order: Omit<LimitOrder, 'id' | 'createdAt'>): Promise<string | null> {
    const { data } = await this.client
      .from('tb_limit_orders')
      .insert({
        user_id: order.userId,
        position_id: order.positionId,
        order_type: order.orderType,
        trigger_price: order.triggerPrice,
        sell_percentage: order.sellPercentage,
        status: order.status,
      })
      .select('id')
      .single();

    return data?.id || null;
  }

  /**
   * Update limit order status.
   */
  async updateLimitOrderStatus(orderId: string, status: LimitOrder['status']): Promise<boolean> {
    const { error } = await this.client
      .from('tb_limit_orders')
      .update({ status })
      .eq('id', orderId);

    return !error;
  }

  /**
   * Cancel all orders for a position.
   */
  async cancelOrdersForPosition(positionId: string): Promise<boolean> {
    const { error } = await this.client
      .from('tb_limit_orders')
      .update({ status: 'cancelled' })
      .eq('position_id', positionId)
      .eq('status', 'active');

    return !error;
  }

  // ============================================
  // TRANSACTION OPERATIONS
  // ============================================

  /**
   * Create a transaction record.
   */
  async createTransaction(tx: Omit<Transaction, 'id' | 'createdAt'>): Promise<string | null> {
    const { data } = await this.client
      .from('tb_transactions')
      .insert({
        user_id: tx.userId,
        type: tx.type,
        token_address: tx.tokenAddress,
        token_symbol: tx.tokenSymbol,
        amount_tokens: tx.amountTokens,
        amount_sol: tx.amountSol,
        price_usd: tx.priceUsd,
        tx_signature: tx.txSignature,
        dex_used: tx.dexUsed,
        status: tx.status,
        error_message: tx.errorMessage,
      })
      .select('id')
      .single();

    return data?.id || null;
  }

  /**
   * Update transaction status.
   */
  async updateTransactionStatus(
    txId: string,
    status: Transaction['status'],
    txSignature?: string,
    errorMessage?: string
  ): Promise<boolean> {
    const { error } = await this.client
      .from('tb_transactions')
      .update({
        status,
        tx_signature: txSignature,
        error_message: errorMessage,
      })
      .eq('id', txId);

    return !error;
  }

  /**
   * Get recent transactions for a user.
   */
  async getTransactions(userId: string, limit: number = 10): Promise<Transaction[]> {
    const { data, error } = await this.client
      .from('tb_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return [];
    }

    return data.map(this.mapTransactionFromDb);
  }

  // ============================================
  // USER SETTINGS OPERATIONS
  // ============================================

  /**
   * Get user settings.
   */
  async getUserSettings(userId: string): Promise<UserSettings | null> {
    const { data, error } = await this.client
      .from('tb_user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapUserSettingsFromDb(data);
  }

  /**
   * Create or update user settings.
   */
  async upsertUserSettings(settings: Partial<UserSettings> & { userId: string }): Promise<boolean> {
    const { error } = await this.client
      .from('tb_user_settings')
      .upsert({
        user_id: settings.userId,
        default_buy_sol: settings.defaultBuySol,
        default_slippage: settings.defaultSlippage,
        auto_sl_percent: settings.autoSlPercent,
        auto_tp_percent: settings.autoTpPercent,
        notifications_enabled: settings.notificationsEnabled,
      }, {
        onConflict: 'user_id'
      });

    return !error;
  }

  // ============================================
  // MAPPING FUNCTIONS
  // ============================================

  private mapWalletFromDb(data: Record<string, unknown>): WalletData {
    return {
      userId: String(data.user_id),
      publicAddress: data.public_address as string,
      encryptedPrivateKey: data.encrypted_private_key as string,
      salt: data.key_salt as string,
      iv: data.key_iv as string,
      authTag: data.auth_tag as string,
      isImported: data.is_imported as boolean,
      createdAt: new Date(data.created_at as string),
    };
  }

  private mapPositionFromDb(data: Record<string, unknown>): Position {
    return {
      id: data.id as string,
      userId: String(data.user_id),
      tokenAddress: data.token_address as string,
      tokenSymbol: data.token_symbol as string | null,
      tokenDecimals: data.token_decimals as number | null,
      amount: Number(data.amount),
      entryPriceUsd: data.entry_price_usd ? Number(data.entry_price_usd) : null,
      entrySol: data.entry_sol ? Number(data.entry_sol) : null,
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }

  private mapLimitOrderFromDb(data: Record<string, unknown>): LimitOrder {
    return {
      id: data.id as string,
      userId: String(data.user_id),
      positionId: data.position_id as string,
      orderType: data.order_type as LimitOrder['orderType'],
      triggerPrice: Number(data.trigger_price),
      sellPercentage: Number(data.sell_percentage),
      status: data.status as LimitOrder['status'],
      createdAt: new Date(data.created_at as string),
    };
  }

  private mapTransactionFromDb(data: Record<string, unknown>): Transaction {
    return {
      id: data.id as string,
      userId: String(data.user_id),
      type: data.type as Transaction['type'],
      tokenAddress: data.token_address as string | null,
      tokenSymbol: data.token_symbol as string | null,
      amountTokens: data.amount_tokens ? Number(data.amount_tokens) : null,
      amountSol: data.amount_sol ? Number(data.amount_sol) : null,
      priceUsd: data.price_usd ? Number(data.price_usd) : null,
      txSignature: data.tx_signature as string | null,
      dexUsed: data.dex_used as string | null,
      status: data.status as Transaction['status'],
      errorMessage: data.error_message as string | null,
      createdAt: new Date(data.created_at as string),
    };
  }

  private mapUserSettingsFromDb(data: Record<string, unknown>): UserSettings {
    return {
      userId: String(data.user_id),
      defaultBuySol: Number(data.default_buy_sol),
      defaultSlippage: Number(data.default_slippage),
      autoSlPercent: data.auto_sl_percent ? Number(data.auto_sl_percent) : null,
      autoTpPercent: data.auto_tp_percent ? Number(data.auto_tp_percent) : null,
      notificationsEnabled: data.notifications_enabled as boolean,
      createdAt: new Date(data.created_at as string),
    };
  }
}

// Export singleton instance
export const db = new Database();
