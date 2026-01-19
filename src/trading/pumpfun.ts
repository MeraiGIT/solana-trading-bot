/**
 * PumpPortal API Client
 *
 * Handles token swaps on PumpFun bonding curve and graduated tokens.
 * Uses PumpPortal's local trading API for self-custody transactions.
 *
 * Fee: 0.5% per trade
 */

import { Connection, VersionedTransaction, Keypair } from '@solana/web3.js';

// Constants
const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';

// Pool options for different DEXs
export type PumpPool = 'pump' | 'raydium' | 'pump-amm' | 'launchlab' | 'raydium-cpmm' | 'bonk' | 'auto';

// Types
export interface TradeParams {
  publicKey: string;
  action: 'buy' | 'sell';
  mint: string;
  amount: number | string; // Can be number or percentage string like "100%"
  denominatedInSol: boolean;
  slippage: number; // Percentage (e.g., 5 for 5%)
  priorityFee: number; // In SOL (e.g., 0.0001)
  pool?: PumpPool;
}

export interface TradeResult {
  success: boolean;
  signature?: string;
  error?: string;
  action: 'buy' | 'sell';
  tokenMint: string;
  amount: string;
}

/**
 * PumpPortal API Client for PumpFun trades
 */
export class PumpFunClient {
  private connection: Connection;
  private defaultSlippage: number;
  private defaultPriorityFee: number;
  private defaultPool: PumpPool;

  constructor(
    rpcUrl: string,
    options?: {
      defaultSlippage?: number; // Percentage
      defaultPriorityFee?: number; // In SOL
      defaultPool?: PumpPool;
    }
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.defaultSlippage = options?.defaultSlippage ?? 10; // 10% for volatile PumpFun tokens
    this.defaultPriorityFee = options?.defaultPriorityFee ?? 0.0001; // 0.0001 SOL
    this.defaultPool = options?.defaultPool ?? 'auto';
  }

  /**
   * Build a trade transaction from PumpPortal
   */
  private async buildTransaction(params: TradeParams): Promise<string> {
    const body = {
      publicKey: params.publicKey,
      action: params.action,
      mint: params.mint,
      amount: params.amount,
      denominatedInSol: String(params.denominatedInSol),
      slippage: params.slippage,
      priorityFee: params.priorityFee,
      pool: params.pool ?? this.defaultPool,
    };

    const response = await fetch(PUMPPORTAL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`PumpPortal API error: ${error}`);
    }

    // Response is the serialized transaction
    const data = await response.arrayBuffer();
    return Buffer.from(data).toString('base64');
  }

  /**
   * Execute a trade transaction
   *
   * MEV Protection:
   * - Uses priority fees
   * - Retries with exponential backoff
   * - Auto pool selection finds best route
   */
  async executeTrade(
    params: Omit<TradeParams, 'publicKey'>,
    keypair: Keypair,
    options?: {
      maxRetries?: number;
    }
  ): Promise<TradeResult> {
    const maxRetries = options?.maxRetries ?? 3;

    try {
      // Build the transaction
      const txBase64 = await this.buildTransaction({
        ...params,
        publicKey: keypair.publicKey.toBase58(),
        slippage: params.slippage ?? this.defaultSlippage,
        priorityFee: params.priorityFee ?? this.defaultPriorityFee,
      });

      // Decode and sign
      const txBuffer = Buffer.from(txBase64, 'base64');
      const transaction = VersionedTransaction.deserialize(txBuffer);
      transaction.sign([keypair]);

      // Send with retries
      let signature: string | undefined;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          signature = await this.connection.sendTransaction(transaction, {
            skipPreflight: false,
            maxRetries: 0,
            preflightCommitment: 'confirmed',
          });

          // Wait for confirmation
          const latestBlockhash = await this.connection.getLatestBlockhash();
          const confirmation = await this.connection.confirmTransaction({
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          }, 'confirmed');

          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }

          return {
            success: true,
            signature,
            action: params.action,
            tokenMint: params.mint,
            amount: String(params.amount),
          };
        } catch (err) {
          lastError = err as Error;

          // Check for specific errors that shouldn't retry
          const errorMsg = lastError.message.toLowerCase();
          if (
            errorMsg.includes('insufficient') ||
            errorMsg.includes('balance') ||
            errorMsg.includes('not enough')
          ) {
            break; // Don't retry balance errors
          }

          // Exponential backoff
          if (attempt < maxRetries - 1) {
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
          }
        }
      }

      return {
        success: false,
        error: lastError?.message || 'Unknown error',
        action: params.action,
        tokenMint: params.mint,
        amount: String(params.amount),
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        action: params.action,
        tokenMint: params.mint,
        amount: String(params.amount),
      };
    }
  }

  /**
   * Buy a PumpFun token with SOL
   */
  async buy(
    tokenMint: string,
    solAmount: number,
    keypair: Keypair,
    options?: {
      slippage?: number;
      priorityFee?: number;
      pool?: PumpPool;
    }
  ): Promise<TradeResult> {
    return this.executeTrade(
      {
        action: 'buy',
        mint: tokenMint,
        amount: solAmount,
        denominatedInSol: true,
        slippage: options?.slippage ?? this.defaultSlippage,
        priorityFee: options?.priorityFee ?? this.defaultPriorityFee,
        pool: options?.pool ?? this.defaultPool,
      },
      keypair
    );
  }

  /**
   * Sell a PumpFun token for SOL
   *
   * @param tokenMint - Token contract address
   * @param amount - Amount to sell (number of tokens or percentage string like "50%" or "100%")
   * @param keypair - Wallet keypair
   */
  async sell(
    tokenMint: string,
    amount: number | string,
    keypair: Keypair,
    options?: {
      slippage?: number;
      priorityFee?: number;
      pool?: PumpPool;
    }
  ): Promise<TradeResult> {
    // Selling tokens, not SOL
    const denominatedInSol = false;

    return this.executeTrade(
      {
        action: 'sell',
        mint: tokenMint,
        amount: amount,
        denominatedInSol,
        slippage: options?.slippage ?? this.defaultSlippage,
        priorityFee: options?.priorityFee ?? this.defaultPriorityFee,
        pool: options?.pool ?? this.defaultPool,
      },
      keypair
    );
  }

  /**
   * Sell a percentage of holdings
   */
  async sellPercentage(
    tokenMint: string,
    percentage: number,
    keypair: Keypair,
    options?: {
      slippage?: number;
      priorityFee?: number;
      pool?: PumpPool;
    }
  ): Promise<TradeResult> {
    if (percentage < 1 || percentage > 100) {
      return {
        success: false,
        error: 'Percentage must be between 1 and 100',
        action: 'sell',
        tokenMint,
        amount: `${percentage}%`,
      };
    }

    return this.sell(tokenMint, `${percentage}%`, keypair, options);
  }

  /**
   * Check if a token is on PumpFun bonding curve
   *
   * Uses DexScreener to check if token has pump.fun as DEX
   */
  async isPumpFunToken(tokenMint: string): Promise<boolean> {
    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`
      );

      if (!response.ok) {
        return false;
      }

      const data = await response.json() as { pairs?: Array<{ dexId?: string; url?: string }> };
      const pairs = data.pairs || [];

      // Check if any pair is on pump.fun
      return pairs.some((pair) =>
        pair.dexId?.toLowerCase().includes('pump') ||
        pair.url?.toLowerCase().includes('pump.fun')
      );
    } catch {
      return false;
    }
  }
}

export { PUMPPORTAL_API };
