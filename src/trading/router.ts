/**
 * DEX Router
 *
 * Automatically routes trades to the best DEX:
 * - PumpFun tokens on bonding curve → PumpPortal
 * - Graduated tokens / other tokens → Jupiter
 *
 * This ensures optimal execution for all token types.
 */

import { Keypair } from '@solana/web3.js';
import { JupiterClient } from './jupiter.js';
import { PumpFunClient } from './pumpfun.js';
import { TokenInfoService, TokenInfo } from './tokenInfo.js';

export interface RouterConfig {
  rpcUrl: string;
  defaultSlippageBps?: number;
  defaultPriorityFee?: number; // In lamports for Jupiter, SOL for PumpFun
  preferPumpPortal?: boolean; // Prefer PumpPortal even for graduated tokens
}

export interface TradeParams {
  tokenMint: string;
  amount: number; // SOL for buy, tokens for sell
  action: 'buy' | 'sell';
  slippageBps?: number;
  priorityFee?: number;
  forceDex?: 'jupiter' | 'pumpfun';
}

export interface UnifiedTradeResult {
  success: boolean;
  signature?: string;
  error?: string;
  dexUsed: 'jupiter' | 'pumpfun';
  inputAmount: string;
  outputAmount?: string;
  priceImpact?: string;
  tokenInfo?: TokenInfo;
}

/**
 * DEX Router - Routes trades to optimal DEX
 */
export class DexRouter {
  private jupiter: JupiterClient;
  private pumpfun: PumpFunClient;
  private tokenInfo: TokenInfoService;
  private config: RouterConfig;

  constructor(config: RouterConfig) {
    this.config = config;

    this.jupiter = new JupiterClient(config.rpcUrl, {
      defaultSlippageBps: config.defaultSlippageBps ?? 500,
      defaultPriorityFee: config.defaultPriorityFee ?? 100000,
    });

    this.pumpfun = new PumpFunClient(config.rpcUrl, {
      defaultSlippage: (config.defaultSlippageBps ?? 500) / 100, // Convert bps to %
      defaultPriorityFee: (config.defaultPriorityFee ?? 100000) / 1e9, // Convert lamports to SOL
    });

    this.tokenInfo = new TokenInfoService();
  }

  /**
   * Determine which DEX to use for a token
   */
  async selectDex(tokenMint: string): Promise<'jupiter' | 'pumpfun'> {
    try {
      const info = await this.tokenInfo.getTokenInfo(tokenMint);

      // Check if token is on PumpFun
      if (info?.isPumpFun) {
        // Check if still on bonding curve or use PumpPortal preference
        if (info.onBondingCurve || this.config.preferPumpPortal) {
          return 'pumpfun';
        }
      }

      // Default to Jupiter for most tokens
      return 'jupiter';
    } catch {
      // If we can't determine, try Jupiter first (more liquid)
      return 'jupiter';
    }
  }

  /**
   * Buy a token
   */
  async buy(
    tokenMint: string,
    solAmount: number,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      priorityFee?: number;
      forceDex?: 'jupiter' | 'pumpfun';
    }
  ): Promise<UnifiedTradeResult> {
    // Get token info first
    const tokenInfoResult = await this.tokenInfo.getTokenInfo(tokenMint);

    // Determine which DEX to use
    const dex = options?.forceDex ?? await this.selectDex(tokenMint);

    const slippageBps = options?.slippageBps ?? this.config.defaultSlippageBps ?? 500;
    const priorityFee = options?.priorityFee ?? this.config.defaultPriorityFee ?? 100000;

    if (dex === 'pumpfun') {
      const result = await this.pumpfun.buy(
        tokenMint,
        solAmount,
        keypair,
        {
          slippage: slippageBps / 100, // Convert to percentage
          priorityFee: priorityFee / 1e9, // Convert to SOL
        }
      );

      return {
        success: result.success,
        signature: result.signature,
        error: result.error,
        dexUsed: 'pumpfun',
        inputAmount: String(solAmount * 1e9), // lamports
        tokenInfo: tokenInfoResult ?? undefined,
      };
    } else {
      const result = await this.jupiter.buy(
        tokenMint,
        solAmount,
        keypair,
        {
          slippageBps,
          priorityFee,
        }
      );

      return {
        success: result.success,
        signature: result.signature,
        error: result.error,
        dexUsed: 'jupiter',
        inputAmount: result.inputAmount,
        outputAmount: result.outputAmount,
        priceImpact: result.priceImpact,
        tokenInfo: tokenInfoResult ?? undefined,
      };
    }
  }

  /**
   * Sell a token
   */
  async sell(
    tokenMint: string,
    amount: number | string, // tokens or percentage string
    decimals: number,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      priorityFee?: number;
      forceDex?: 'jupiter' | 'pumpfun';
    }
  ): Promise<UnifiedTradeResult> {
    // Get token info
    const tokenInfoResult = await this.tokenInfo.getTokenInfo(tokenMint);

    // Determine which DEX to use
    const dex = options?.forceDex ?? await this.selectDex(tokenMint);

    const slippageBps = options?.slippageBps ?? this.config.defaultSlippageBps ?? 500;
    const priorityFee = options?.priorityFee ?? this.config.defaultPriorityFee ?? 100000;

    if (dex === 'pumpfun') {
      const result = await this.pumpfun.sell(
        tokenMint,
        amount,
        keypair,
        {
          slippage: slippageBps / 100,
          priorityFee: priorityFee / 1e9,
        }
      );

      return {
        success: result.success,
        signature: result.signature,
        error: result.error,
        dexUsed: 'pumpfun',
        inputAmount: String(amount),
        tokenInfo: tokenInfoResult ?? undefined,
      };
    } else {
      const result = await this.jupiter.sell(
        tokenMint,
        String(amount),
        decimals,
        keypair,
        {
          slippageBps,
          priorityFee,
        }
      );

      return {
        success: result.success,
        signature: result.signature,
        error: result.error,
        dexUsed: 'jupiter',
        inputAmount: result.inputAmount,
        outputAmount: result.outputAmount,
        priceImpact: result.priceImpact,
        tokenInfo: tokenInfoResult ?? undefined,
      };
    }
  }

  /**
   * Get a quote (for preview before trading)
   */
  async getQuote(
    tokenMint: string,
    solAmount: number,
    action: 'buy' | 'sell',
    decimals?: number
  ): Promise<{
    dex: 'jupiter' | 'pumpfun';
    estimatedOutput: string;
    priceImpact: string;
    route: string;
  }> {
    const dex = await this.selectDex(tokenMint);

    if (dex === 'jupiter') {
      if (action === 'buy') {
        const estimate = await this.jupiter.getEstimatedOutput(
          'So11111111111111111111111111111111111111112', // SOL
          tokenMint,
          String(Math.floor(solAmount * 1e9))
        );
        return {
          dex: 'jupiter',
          estimatedOutput: estimate.outputAmount,
          priceImpact: estimate.priceImpact,
          route: estimate.route,
        };
      } else {
        // For sell, we need the token amount and decimals
        if (!decimals) {
          throw new Error('Decimals required for sell quote');
        }
        const rawAmount = BigInt(Math.floor(solAmount * Math.pow(10, decimals)));
        const estimate = await this.jupiter.getEstimatedOutput(
          tokenMint,
          'So11111111111111111111111111111111111111112',
          String(rawAmount)
        );
        return {
          dex: 'jupiter',
          estimatedOutput: estimate.outputAmount,
          priceImpact: estimate.priceImpact,
          route: estimate.route,
        };
      }
    } else {
      // PumpPortal doesn't have a quote endpoint, return estimate based on token info
      const info = await this.tokenInfo.getTokenInfo(tokenMint);
      return {
        dex: 'pumpfun',
        estimatedOutput: 'Estimated on execution',
        priceImpact: info?.priceChange24h ? `${info.priceChange24h}% (24h)` : 'Unknown',
        route: 'PumpFun' + (info?.onBondingCurve ? ' (Bonding Curve)' : ''),
      };
    }
  }

  /**
   * Get token information
   */
  async getTokenInfo(tokenMint: string): Promise<TokenInfo | null> {
    return this.tokenInfo.getTokenInfo(tokenMint);
  }

  /**
   * Get the underlying clients for direct access
   */
  getClients() {
    return {
      jupiter: this.jupiter,
      pumpfun: this.pumpfun,
      tokenInfo: this.tokenInfo,
    };
  }
}

export { JupiterClient, PumpFunClient, TokenInfoService };
