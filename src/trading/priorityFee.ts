/**
 * Dynamic Priority Fee Service
 *
 * Fetches current network conditions and calculates optimal priority fees.
 * Uses Helius priority fee API when available, falls back to RPC estimates.
 *
 * Priority fees help transactions get included faster and can provide
 * some MEV protection by outbidding front-running bots.
 */

import { Connection } from '@solana/web3.js';

// Priority fee levels
export enum PriorityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  VERY_HIGH = 'veryHigh',
  UNSAFE_MAX = 'unsafeMax',
}

// Fee estimates structure
export interface PriorityFeeEstimate {
  low: number;
  medium: number;
  high: number;
  veryHigh: number;
  unsafeMax: number;
}

// Cache for fee estimates
interface FeeCache {
  estimate: PriorityFeeEstimate;
  timestamp: number;
}

const CACHE_TTL_MS = 10000; // 10 seconds
let feeCache: FeeCache | null = null;

/**
 * Priority Fee Service
 */
export class PriorityFeeService {
  private connection: Connection;
  private heliusApiKey?: string;

  constructor(rpcUrl: string, heliusApiKey?: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.heliusApiKey = heliusApiKey;
  }

  /**
   * Get priority fee estimates using Helius API (recommended)
   */
  async getHeliusPriorityFees(
    accountKeys?: string[]
  ): Promise<PriorityFeeEstimate | null> {
    if (!this.heliusApiKey) {
      return null;
    }

    try {
      const url = `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;

      const body: Record<string, unknown> = {
        jsonrpc: '2.0',
        id: 'priority-fee-estimate',
        method: 'getPriorityFeeEstimate',
        params: [
          {
            options: {
              includeAllPriorityFeeLevels: true,
            },
          },
        ],
      };

      // Add account keys if provided (for more accurate estimates)
      if (accountKeys && accountKeys.length > 0) {
        body.params = [
          {
            accountKeys: accountKeys,
            options: {
              includeAllPriorityFeeLevels: true,
            },
          },
        ];
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return null;
      }

      interface HeliusResponse {
        result?: {
          priorityFeeLevels?: {
            low?: number;
            medium?: number;
            high?: number;
            veryHigh?: number;
            unsafeMax?: number;
          };
        };
      }

      const data = await response.json() as HeliusResponse;

      if (data.result?.priorityFeeLevels) {
        const levels = data.result.priorityFeeLevels;
        return {
          low: Math.ceil(levels.low || 1000),
          medium: Math.ceil(levels.medium || 10000),
          high: Math.ceil(levels.high || 100000),
          veryHigh: Math.ceil(levels.veryHigh || 500000),
          unsafeMax: Math.ceil(levels.unsafeMax || 1000000),
        };
      }
    } catch (error) {
      console.error('Helius priority fee error:', error);
    }

    return null;
  }

  /**
   * Get priority fee estimates using standard RPC
   * Falls back to this when Helius is not available
   */
  async getRpcPriorityFees(): Promise<PriorityFeeEstimate> {
    try {
      // Get recent prioritization fees
      const fees = await this.connection.getRecentPrioritizationFees();

      if (fees.length === 0) {
        return this.getDefaultFees();
      }

      // Calculate percentiles
      const sortedFees = fees
        .map((f) => f.prioritizationFee)
        .filter((f) => f > 0)
        .sort((a, b) => a - b);

      if (sortedFees.length === 0) {
        return this.getDefaultFees();
      }

      const getPercentile = (arr: number[], p: number): number => {
        const index = Math.ceil((p / 100) * arr.length) - 1;
        return arr[Math.max(0, index)] || 0;
      };

      return {
        low: Math.max(1000, getPercentile(sortedFees, 25)),
        medium: Math.max(10000, getPercentile(sortedFees, 50)),
        high: Math.max(100000, getPercentile(sortedFees, 75)),
        veryHigh: Math.max(500000, getPercentile(sortedFees, 90)),
        unsafeMax: Math.max(1000000, getPercentile(sortedFees, 99)),
      };
    } catch (error) {
      console.error('RPC priority fee error:', error);
      return this.getDefaultFees();
    }
  }

  /**
   * Get default fees when APIs fail
   *
   * CORRECTED: Based on actual Solana priority fee market
   * These are priority fees (compute unit price), separate from Jito tips
   */
  private getDefaultFees(): PriorityFeeEstimate {
    return {
      low: 1_000,        // 0.000001 SOL - minimal
      medium: 10_000,    // 0.00001 SOL - normal
      high: 50_000,      // 0.00005 SOL - faster
      veryHigh: 100_000, // 0.0001 SOL - urgent
      unsafeMax: 500_000, // 0.0005 SOL - max reasonable
    };
  }

  /**
   * Get current priority fee estimates with caching
   */
  async getPriorityFees(
    accountKeys?: string[],
    forceRefresh = false
  ): Promise<PriorityFeeEstimate> {
    // Check cache
    if (
      !forceRefresh &&
      feeCache &&
      Date.now() - feeCache.timestamp < CACHE_TTL_MS
    ) {
      return feeCache.estimate;
    }

    // Try Helius first
    let estimate = await this.getHeliusPriorityFees(accountKeys);

    // Fall back to RPC
    if (!estimate) {
      estimate = await this.getRpcPriorityFees();
    }

    // Update cache
    feeCache = {
      estimate,
      timestamp: Date.now(),
    };

    return estimate;
  }

  /**
   * Get recommended priority fee for a specific use case
   */
  async getRecommendedFee(
    level: PriorityLevel = PriorityLevel.HIGH,
    accountKeys?: string[]
  ): Promise<number> {
    const estimates = await this.getPriorityFees(accountKeys);
    return estimates[level];
  }

  /**
   * Calculate priority fee based on trade value and urgency
   *
   * @param tradeValueSol - Value of trade in SOL
   * @param urgency - How urgent (1-10, 10 being most urgent)
   */
  async calculateDynamicFee(
    tradeValueSol: number,
    urgency: number = 5,
    accountKeys?: string[]
  ): Promise<number> {
    const estimates = await this.getPriorityFees(accountKeys);

    // Base fee on urgency
    let baseFee: number;
    if (urgency <= 2) {
      baseFee = estimates.low;
    } else if (urgency <= 4) {
      baseFee = estimates.medium;
    } else if (urgency <= 6) {
      baseFee = estimates.high;
    } else if (urgency <= 8) {
      baseFee = estimates.veryHigh;
    } else {
      baseFee = estimates.unsafeMax;
    }

    // Modest scale up for higher value trades
    let multiplier = 1;
    if (tradeValueSol > 10) {
      multiplier = 2;
    } else if (tradeValueSol > 5) {
      multiplier = 1.5;
    } else if (tradeValueSol > 1) {
      multiplier = 1.2;
    }

    const finalFee = Math.ceil(baseFee * multiplier);

    // Cap at 0.001 SOL - reasonable max for normal trading
    const maxFee = 1_000_000; // 0.001 SOL
    return Math.min(finalFee, maxFee);
  }
}

/**
 * Quick helper to get a recommended priority fee
 */
export async function getQuickPriorityFee(
  connection: Connection,
  level: PriorityLevel = PriorityLevel.HIGH
): Promise<number> {
  const service = new PriorityFeeService(connection.rpcEndpoint);
  return service.getRecommendedFee(level);
}

/**
 * Format lamports as SOL string for display
 */
export function formatPriorityFee(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  if (sol < 0.00001) {
    return `${lamports} lamports`;
  }
  return `${sol.toFixed(6)} SOL`;
}
