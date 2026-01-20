/**
 * Price Monitor Service
 *
 * Monitors token prices and executes SL/TP orders automatically.
 * Runs as a background service checking prices periodically.
 */

import { DexRouter } from './router.js';
import { TokenInfoService, TokenInfo } from './tokenInfo.js';
import { Database, LimitOrder as DbLimitOrder, Position as DbPosition } from '../services/database.js';
import { WalletManager } from '../wallet/manager.js';

export type OrderType = 'stop_loss' | 'take_profit';
export type OrderStatus = 'active' | 'triggered' | 'cancelled';

export interface LimitOrder {
  id: string;
  userId: number;
  positionId: string;
  orderType: OrderType;
  triggerPrice: number;
  sellPercentage: number;
  status: OrderStatus;
  createdAt: Date;
}

export interface MonitorConfig {
  checkIntervalMs: number; // How often to check prices
  rpcUrl: string;
  onOrderTriggered?: (order: LimitOrder, result: TriggerResult) => void;
  onError?: (error: Error) => void;
}

export interface TriggerResult {
  success: boolean;
  signature?: string;
  error?: string;
  soldAmount: string;
  receivedSol: string;
}

/**
 * Price Monitor - Watches prices and executes SL/TP orders
 */
export class PriceMonitor {
  private router: DexRouter;
  private tokenInfo: TokenInfoService;
  private db: Database;
  private walletManager: WalletManager;
  private config: MonitorConfig;
  private isRunning: boolean = false;
  private intervalId?: NodeJS.Timeout;

  constructor(
    db: Database,
    walletManager: WalletManager,
    config: MonitorConfig
  ) {
    this.db = db;
    this.walletManager = walletManager;
    this.config = config;
    this.router = new DexRouter({
      rpcUrl: config.rpcUrl,
      defaultSlippageBps: 1000, // 10% slippage for SL/TP (fast execution)
      defaultPriorityFee: 200000, // Higher priority for SL/TP
    });
    this.tokenInfo = new TokenInfoService();
  }

  /**
   * Start the price monitoring service
   */
  start(): void {
    if (this.isRunning) {
      console.log('Price monitor already running');
      return;
    }

    this.isRunning = true;
    console.log(`Price monitor started (interval: ${this.config.checkIntervalMs}ms)`);

    // Run immediately, then on interval
    this.checkPrices();
    this.intervalId = setInterval(() => {
      this.checkPrices();
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop the price monitoring service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    console.log('Price monitor stopped');
  }

  /**
   * Check prices and trigger orders
   */
  private async checkPrices(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Get all active orders
      const activeOrders = await this.db.getAllActiveLimitOrders();

      if (activeOrders.length === 0) {
        return;
      }

      // Group orders by position
      const ordersByPosition = new Map<string, DbLimitOrder[]>();
      for (const order of activeOrders) {
        if (!order.positionId) continue;
        const existing = ordersByPosition.get(order.positionId) || [];
        existing.push(order);
        ordersByPosition.set(order.positionId, existing);
      }

      // Get unique user IDs and their positions
      const userPositions = new Map<string, DbPosition[]>();
      for (const order of activeOrders) {
        if (!userPositions.has(order.userId)) {
          const positions = await this.db.getPositions(order.userId);
          userPositions.set(order.userId, positions);
        }
      }

      // Build position map by ID
      const positionMap = new Map<string, DbPosition>();
      for (const positions of userPositions.values()) {
        for (const p of positions) {
          positionMap.set(p.id, p);
        }
      }

      // Get unique token addresses
      const tokenAddresses = [...new Set(Array.from(positionMap.values()).map(p => p.tokenAddress))];

      // Fetch current prices
      const priceMap = new Map<string, TokenInfo>();
      for (const addr of tokenAddresses) {
        const info = await this.tokenInfo.getTokenInfo(addr);
        if (info) {
          priceMap.set(addr, info);
        }
      }

      // Check each position's orders
      for (const [positionId, orders] of ordersByPosition) {
        const position = positionMap.get(positionId);
        if (!position) continue;

        const tokenInfo = priceMap.get(position.tokenAddress);
        if (!tokenInfo) continue;

        const currentPrice = tokenInfo.priceUsd;
        const entryPrice = position.entryPriceUsd || 0;

        // Check each order
        for (const order of orders) {
          if (order.status !== 'active') continue;

          const shouldTrigger = this.shouldTriggerOrder(
            order.orderType,
            currentPrice,
            order.triggerPrice,
            entryPrice
          );

          if (shouldTrigger) {
            console.log(
              `Triggering ${order.orderType} for position ${positionId}: ` +
              `current=$${currentPrice.toFixed(6)}, trigger=$${order.triggerPrice.toFixed(6)}`
            );

            await this.triggerOrder(order, position, tokenInfo);
          }
        }
      }
    } catch (error) {
      console.error('Error checking prices:', error);
      this.config.onError?.(error as Error);
    }
  }

  /**
   * Determine if an order should be triggered
   */
  private shouldTriggerOrder(
    orderType: OrderType,
    currentPrice: number,
    triggerPrice: number,
    _entryPrice: number // Prefixed with _ to indicate intentionally unused (reserved for future use)
  ): boolean {
    if (orderType === 'stop_loss') {
      // Trigger when price drops below trigger price
      return currentPrice <= triggerPrice;
    } else {
      // Take profit: trigger when price rises above trigger price
      return currentPrice >= triggerPrice;
    }
  }

  /**
   * Execute a triggered order
   * CRITICAL: Uses real on-chain balance, not database amount.
   */
  private async triggerOrder(
    order: DbLimitOrder,
    position: DbPosition,
    tokenInfo: TokenInfo
  ): Promise<void> {
    try {
      // Get user's wallet data from database
      const walletData = await this.db.getWallet(order.userId);
      if (!walletData) {
        throw new Error('Failed to get user wallet data');
      }

      // CRITICAL: Fetch REAL on-chain balance instead of using database amount
      const onChainBalance = await this.walletManager.getTokenBalance(
        walletData.publicAddress,
        position.tokenAddress,
        false // Don't use cache - we need fresh data
      );

      // If no tokens on-chain, cancel the order and clean up
      if (!onChainBalance || onChainBalance.amount <= 0) {
        console.log(`Order ${order.id}: No tokens on-chain, cancelling`);
        await this.db.updateLimitOrderStatus(order.id, 'cancelled');
        await this.db.deletePosition(order.userId, position.tokenAddress);
        return;
      }

      // Get keypair for signing
      const keypair = this.walletManager.getKeypair(walletData);

      // Use on-chain balance for sell calculation
      const sellAmount = (onChainBalance.amount * order.sellPercentage) / 100;
      const decimals = onChainBalance.decimals;

      // Log if there's a mismatch between DB and on-chain
      if (Math.abs(position.amount - onChainBalance.amount) > 0.01) {
        console.log(`SL/TP balance mismatch: DB=${position.amount}, On-chain=${onChainBalance.amount}`);
      }

      // Execute the sell
      const result = await this.router.sell(
        position.tokenAddress,
        sellAmount,
        decimals, // Use on-chain decimals
        keypair,
        {
          slippageBps: 1000, // Higher slippage for fast execution
          priorityFee: 200000,
        }
      );

      // Update order status
      await this.db.updateLimitOrderStatus(order.id, 'triggered');

      // Invalidate cache after sell
      this.walletManager.invalidateTokenBalanceCache(walletData.publicAddress, position.tokenAddress);

      // Wait briefly for chain state to settle
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Fetch actual remaining balance from chain (not calculated from DB)
      const remainingBalance = await this.walletManager.getTokenBalance(
        walletData.publicAddress,
        position.tokenAddress,
        false
      );

      // Update or delete position based on actual on-chain balance
      if (!remainingBalance || remainingBalance.amount <= 0.0001) {
        await this.db.deletePosition(order.userId, position.tokenAddress);
        // Cancel any other active orders for this position
        await this.db.cancelOrdersForPosition(position.id);
      } else {
        await this.db.upsertPosition({
          userId: position.userId,
          tokenAddress: position.tokenAddress,
          tokenSymbol: position.tokenSymbol,
          tokenDecimals: remainingBalance.decimals,
          amount: remainingBalance.amount, // Sync with actual on-chain balance
          entryPriceUsd: position.entryPriceUsd,
          entrySol: position.entrySol,
        });
      }

      // Record transaction
      await this.db.createTransaction({
        userId: order.userId,
        type: 'sell',
        tokenAddress: position.tokenAddress,
        tokenSymbol: position.tokenSymbol,
        amountTokens: sellAmount,
        amountSol: result.outputAmount ? Number(result.outputAmount) / 1e9 : null,
        priceUsd: tokenInfo.priceUsd,
        txSignature: result.signature || null,
        dexUsed: result.dexUsed,
        status: result.success ? 'success' : 'failed',
        errorMessage: result.error || null,
      });

      // Notify callback
      const triggerResult: TriggerResult = {
        success: result.success,
        signature: result.signature,
        error: result.error,
        soldAmount: String(sellAmount),
        receivedSol: result.outputAmount ? String(Number(result.outputAmount) / 1e9) : '0',
      };

      this.config.onOrderTriggered?.(
        {
          id: order.id,
          userId: Number(order.userId),
          positionId: order.positionId,
          orderType: order.orderType,
          triggerPrice: order.triggerPrice,
          sellPercentage: order.sellPercentage,
          status: 'triggered',
          createdAt: order.createdAt,
        },
        triggerResult
      );

      console.log(
        `Order ${order.id} triggered: ${result.success ? 'SUCCESS' : 'FAILED'}`,
        result.signature || result.error
      );
    } catch (error) {
      console.error(`Error triggering order ${order.id}:`, error);

      // Mark as failed but keep active to retry
      this.config.onError?.(error as Error);
    }
  }

  /**
   * Create a stop loss order
   */
  async createStopLoss(
    userId: number,
    positionId: string,
    triggerPrice: number,
    sellPercentage: number = 100
  ): Promise<LimitOrder | null> {
    return this.createOrder(userId, positionId, 'stop_loss', triggerPrice, sellPercentage);
  }

  /**
   * Create a take profit order
   */
  async createTakeProfit(
    userId: number,
    positionId: string,
    triggerPrice: number,
    sellPercentage: number = 100
  ): Promise<LimitOrder | null> {
    return this.createOrder(userId, positionId, 'take_profit', triggerPrice, sellPercentage);
  }

  /**
   * Create a limit order
   */
  private async createOrder(
    userId: number,
    positionId: string,
    orderType: OrderType,
    triggerPrice: number,
    sellPercentage: number
  ): Promise<LimitOrder | null> {
    try {
      const orderId = await this.db.createLimitOrder({
        userId: String(userId),
        positionId,
        orderType,
        triggerPrice,
        sellPercentage,
        status: 'active',
      });

      if (!orderId) {
        return null;
      }

      return {
        id: orderId,
        userId,
        positionId,
        orderType,
        triggerPrice,
        sellPercentage,
        status: 'active',
        createdAt: new Date(),
      };
    } catch (error) {
      console.error('Error creating order:', error);
      return null;
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.db.updateLimitOrderStatus(orderId, 'cancelled');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get orders for a user
   */
  async getUserOrders(userId: number): Promise<LimitOrder[]> {
    const orders = await this.db.getActiveLimitOrders(String(userId));
    return orders.map(o => ({
      id: o.id,
      userId: Number(o.userId),
      positionId: o.positionId,
      orderType: o.orderType,
      triggerPrice: o.triggerPrice,
      sellPercentage: o.sellPercentage,
      status: o.status as OrderStatus,
      createdAt: o.createdAt,
    }));
  }

  /**
   * Check if monitor is running
   */
  get running(): boolean {
    return this.isRunning;
  }
}
