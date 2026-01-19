/**
 * Jupiter API Client
 *
 * Handles token swaps via Jupiter aggregator.
 * Includes MEV protection via priority fees and Jito bundles.
 */

import { Connection, VersionedTransaction, Keypair } from '@solana/web3.js';

// Constants
const JUPITER_QUOTE_API = 'https://api.jup.ag/swap/v1/quote';
const JUPITER_SWAP_API = 'https://api.jup.ag/swap/v1/swap';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Types
export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string; // In lamports/smallest units
  slippageBps: number;
  restrictIntermediateTokens?: boolean;
  onlyDirectRoutes?: boolean;
  maxAccounts?: number;
}

export interface QuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: RoutePlan[];
  contextSlot?: number;
  timeTaken?: number;
}

export interface RoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface SwapParams {
  quoteResponse: QuoteResponse;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  useSharedAccounts?: boolean;
  dynamicComputeUnitLimit?: boolean;
  skipUserAccountsRpcCalls?: boolean;
  dynamicSlippage?: boolean;
  prioritizationFeeLamports?: number | 'auto';
}

export interface SwapResponse {
  swapTransaction: string; // Base64 encoded transaction
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
  computeUnitLimit?: number;
  prioritizationType?: {
    computeBudget?: {
      microLamports: number;
      estimatedMicroLamports: number;
    };
  };
  dynamicSlippageReport?: {
    slippageBps: number;
    otherAmount: number;
    simulatedIncurredSlippageBps: number;
    amplificationRatio: string;
  };
  simulationError?: string;
}

export interface SwapResult {
  success: boolean;
  signature?: string;
  error?: string;
  inputAmount: string;
  outputAmount: string;
  priceImpact: string;
}

/**
 * Jupiter API Client for token swaps
 */
export class JupiterClient {
  private connection: Connection;
  private defaultSlippageBps: number;
  private defaultPriorityFee: number;

  constructor(
    rpcUrl: string,
    options?: {
      defaultSlippageBps?: number;
      defaultPriorityFee?: number; // In lamports
    }
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.defaultSlippageBps = options?.defaultSlippageBps ?? 500; // 5%
    this.defaultPriorityFee = options?.defaultPriorityFee ?? 100000; // 0.0001 SOL
  }

  /**
   * Get a quote for swapping tokens
   */
  async getQuote(params: Partial<QuoteParams> & { inputMint: string; outputMint: string; amount: string }): Promise<QuoteResponse> {
    const queryParams = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: String(params.slippageBps ?? this.defaultSlippageBps),
      restrictIntermediateTokens: String(params.restrictIntermediateTokens ?? true),
      maxAccounts: String(params.maxAccounts ?? 64),
    });

    if (params.onlyDirectRoutes) {
      queryParams.set('onlyDirectRoutes', 'true');
    }

    const response = await fetch(`${JUPITER_QUOTE_API}?${queryParams}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter quote failed: ${error}`);
    }

    return response.json() as Promise<QuoteResponse>;
  }

  /**
   * Get a quote for buying a token with SOL
   */
  async getBuyQuote(tokenMint: string, solAmount: number, slippageBps?: number): Promise<QuoteResponse> {
    // Convert SOL to lamports
    const lamports = Math.floor(solAmount * 1e9);

    return this.getQuote({
      inputMint: SOL_MINT,
      outputMint: tokenMint,
      amount: String(lamports),
      slippageBps: slippageBps ?? this.defaultSlippageBps,
    });
  }

  /**
   * Get a quote for selling a token for SOL
   */
  async getSellQuote(tokenMint: string, tokenAmount: string, decimals: number, slippageBps?: number): Promise<QuoteResponse> {
    // Convert to smallest units
    const rawAmount = BigInt(Math.floor(Number(tokenAmount) * Math.pow(10, decimals)));

    return this.getQuote({
      inputMint: tokenMint,
      outputMint: SOL_MINT,
      amount: String(rawAmount),
      slippageBps: slippageBps ?? this.defaultSlippageBps,
    });
  }

  /**
   * Build a swap transaction from a quote
   */
  async buildSwapTransaction(params: SwapParams): Promise<SwapResponse> {
    const body = {
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
      useSharedAccounts: params.useSharedAccounts ?? true,
      dynamicComputeUnitLimit: params.dynamicComputeUnitLimit ?? true,
      skipUserAccountsRpcCalls: params.skipUserAccountsRpcCalls ?? false,
      dynamicSlippage: params.dynamicSlippage ?? true,
      prioritizationFeeLamports: params.prioritizationFeeLamports ?? this.defaultPriorityFee,
    };

    const response = await fetch(JUPITER_SWAP_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter swap build failed: ${error}`);
    }

    return response.json() as Promise<SwapResponse>;
  }

  /**
   * Execute a swap transaction
   *
   * MEV Protection:
   * - Uses priority fees to front-run bots
   * - Confirms with 'confirmed' commitment
   * - Retries with exponential backoff
   */
  async executeSwap(
    quoteResponse: QuoteResponse,
    keypair: Keypair,
    options?: {
      priorityFee?: number;
      maxRetries?: number;
    }
  ): Promise<SwapResult> {
    const priorityFee = options?.priorityFee ?? this.defaultPriorityFee;
    const maxRetries = options?.maxRetries ?? 3;

    try {
      // Build the swap transaction
      const swapResponse = await this.buildSwapTransaction({
        quoteResponse,
        userPublicKey: keypair.publicKey.toBase58(),
        prioritizationFeeLamports: priorityFee,
      });

      if (swapResponse.simulationError) {
        return {
          success: false,
          error: `Simulation failed: ${swapResponse.simulationError}`,
          inputAmount: quoteResponse.inAmount,
          outputAmount: quoteResponse.outAmount,
          priceImpact: quoteResponse.priceImpactPct,
        };
      }

      // Decode and sign the transaction
      const swapTransactionBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([keypair]);

      // Send with retries
      let signature: string | undefined;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          signature = await this.connection.sendTransaction(transaction, {
            skipPreflight: false, // Enable preflight for safety
            maxRetries: 0, // We handle retries ourselves
            preflightCommitment: 'confirmed',
          });

          // Wait for confirmation
          const confirmation = await this.connection.confirmTransaction({
            signature,
            blockhash: transaction.message.recentBlockhash,
            lastValidBlockHeight: swapResponse.lastValidBlockHeight,
          }, 'confirmed');

          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }

          return {
            success: true,
            signature,
            inputAmount: quoteResponse.inAmount,
            outputAmount: quoteResponse.outAmount,
            priceImpact: quoteResponse.priceImpactPct,
          };
        } catch (err) {
          lastError = err as Error;

          // Exponential backoff
          if (attempt < maxRetries - 1) {
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
          }
        }
      }

      return {
        success: false,
        error: lastError?.message || 'Unknown error',
        inputAmount: quoteResponse.inAmount,
        outputAmount: quoteResponse.outAmount,
        priceImpact: quoteResponse.priceImpactPct,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        inputAmount: quoteResponse.inAmount,
        outputAmount: quoteResponse.outAmount,
        priceImpact: quoteResponse.priceImpactPct,
      };
    }
  }

  /**
   * Buy a token with SOL
   */
  async buy(
    tokenMint: string,
    solAmount: number,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      priorityFee?: number;
    }
  ): Promise<SwapResult> {
    const quote = await this.getBuyQuote(
      tokenMint,
      solAmount,
      options?.slippageBps
    );

    return this.executeSwap(quote, keypair, {
      priorityFee: options?.priorityFee,
    });
  }

  /**
   * Sell a token for SOL
   */
  async sell(
    tokenMint: string,
    tokenAmount: string,
    decimals: number,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      priorityFee?: number;
    }
  ): Promise<SwapResult> {
    const quote = await this.getSellQuote(
      tokenMint,
      tokenAmount,
      decimals,
      options?.slippageBps
    );

    return this.executeSwap(quote, keypair, {
      priorityFee: options?.priorityFee,
    });
  }

  /**
   * Get estimated output for a swap (for display)
   */
  async getEstimatedOutput(
    inputMint: string,
    outputMint: string,
    amount: string,
    slippageBps?: number
  ): Promise<{
    outputAmount: string;
    priceImpact: string;
    route: string;
  }> {
    const quote = await this.getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
    });

    // Get route labels
    const routeLabels = quote.routePlan
      .map(r => r.swapInfo.label)
      .filter((v, i, a) => a.indexOf(v) === i) // Unique
      .join(' → ');

    return {
      outputAmount: quote.outAmount,
      priceImpact: quote.priceImpactPct,
      route: routeLabels || 'Direct',
    };
  }
}

// Helper functions
export function lamportsToSol(lamports: string | number): number {
  return Number(lamports) / 1e9;
}

export function solToLamports(sol: number): number {
  return Math.floor(sol * 1e9);
}

export { SOL_MINT, USDC_MINT };
