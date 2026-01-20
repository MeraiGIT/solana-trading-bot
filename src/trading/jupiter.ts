/**
 * Jupiter API Client
 *
 * Handles token swaps via Jupiter aggregator.
 * Includes MEV protection via priority fees and Jito bundles.
 */

import { Connection, VersionedTransaction, Keypair } from '@solana/web3.js';
import { JitoClient, getJitoTipFloor } from './jito.js';
import { PriorityFeeService } from './priorityFee.js';

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
  private jitoClient: JitoClient | null = null;
  private priorityFeeService: PriorityFeeService;
  private useJito: boolean;
  private apiKey?: string;

  constructor(
    rpcUrl: string,
    options?: {
      defaultSlippageBps?: number;
      defaultPriorityFee?: number; // In lamports
      useJito?: boolean;
      heliusApiKey?: string;
      jupiterApiKey?: string;
    }
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.defaultSlippageBps = options?.defaultSlippageBps ?? 500; // 5%
    this.defaultPriorityFee = options?.defaultPriorityFee ?? 100000; // 0.0001 SOL
    this.useJito = options?.useJito ?? true; // Enable Jito by default
    this.apiKey = options?.jupiterApiKey;

    // Initialize Jito client if enabled
    if (this.useJito) {
      this.jitoClient = new JitoClient(rpcUrl);
    }

    // Initialize priority fee service
    this.priorityFeeService = new PriorityFeeService(rpcUrl, options?.heliusApiKey);
  }

  /**
   * Get request headers including API key if available
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
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
      headers: this.getHeaders(),
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await fetch(JUPITER_SWAP_API, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter swap build failed: ${error}`);
    }

    return response.json() as Promise<SwapResponse>;
  }

  /**
   * Get dynamic priority fee based on current network conditions
   */
  async getDynamicPriorityFee(tradeValueSol: number): Promise<number> {
    try {
      // Get fee based on trade value and high urgency for trading
      return await this.priorityFeeService.calculateDynamicFee(
        tradeValueSol,
        7 // High urgency for trading
      );
    } catch {
      return this.defaultPriorityFee;
    }
  }

  /**
   * Execute a swap transaction
   *
   * MEV Protection:
   * - Uses Jito bundles for private mempool (when enabled)
   * - Dynamic priority fees based on network conditions
   * - Confirms with 'confirmed' commitment
   * - Retries with exponential backoff
   */
  async executeSwap(
    quoteResponse: QuoteResponse,
    keypair: Keypair,
    options?: {
      priorityFee?: number;
      maxRetries?: number;
      useJito?: boolean;
      jitoTip?: number;
    }
  ): Promise<SwapResult> {
    const maxRetries = options?.maxRetries ?? 3;
    const shouldUseJito = options?.useJito ?? this.useJito;

    try {
      // Calculate trade value for dynamic fee
      const tradeValueSol = Number(quoteResponse.inAmount) / 1e9;

      // Get dynamic priority fee if not specified
      const priorityFee = options?.priorityFee ?? await this.getDynamicPriorityFee(tradeValueSol);

      console.log(`[Jupiter] Trade: ${tradeValueSol.toFixed(4)} SOL, Priority fee: ${priorityFee} lamports, Jito: ${shouldUseJito}`);

      // Build the swap transaction
      const swapResponse = await this.buildSwapTransaction({
        quoteResponse,
        userPublicKey: keypair.publicKey.toBase58(),
        prioritizationFeeLamports: priorityFee,
      });

      if (swapResponse.simulationError) {
        const errorMsg = typeof swapResponse.simulationError === 'string'
          ? swapResponse.simulationError
          : JSON.stringify(swapResponse.simulationError);
        return {
          success: false,
          error: `Simulation failed: ${errorMsg}`,
          inputAmount: quoteResponse.inAmount,
          outputAmount: quoteResponse.outAmount,
          priceImpact: quoteResponse.priceImpactPct,
        };
      }

      // Decode and sign the transaction
      const swapTransactionBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([keypair]);

      // Try Jito first if enabled
      if (shouldUseJito && this.jitoClient) {
        try {
          // Get Jito tip (use provided or fetch current floor)
          const jitoTip = options?.jitoTip ?? await getJitoTipFloor();

          console.log(`[Jupiter] Sending via Jito with ${jitoTip} lamport tip`);

          const jitoResult = await this.jitoClient.sendTransaction(
            transaction,
            keypair,
            {
              tipLamports: jitoTip,
              waitForConfirmation: true,
              maxWaitMs: 30000,
            }
          );

          if (jitoResult.success && jitoResult.landed) {
            console.log(`[Jupiter] Jito bundle landed: ${jitoResult.bundleId}`);
            return {
              success: true,
              signature: jitoResult.signature,
              inputAmount: quoteResponse.inAmount,
              outputAmount: quoteResponse.outAmount,
              priceImpact: quoteResponse.priceImpactPct,
            };
          }

          // Jito failed, fall back to regular submission
          console.log(`[Jupiter] Jito failed (${jitoResult.error}), falling back to regular submission`);
        } catch (jitoErr) {
          console.log(`[Jupiter] Jito error: ${(jitoErr as Error).message}, falling back to regular submission`);
        }
      }

      // Regular submission (fallback or when Jito disabled)
      let signature: string | undefined;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          signature = await this.connection.sendTransaction(transaction, {
            skipPreflight: false,
            maxRetries: 0,
            preflightCommitment: 'confirmed',
          });

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
