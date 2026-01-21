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
// Public RPC endpoints for fallback
const PUBLIC_RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-mainnet.g.alchemy.com/v2/demo',
];

export class JupiterClient {
  private connection: Connection;
  private publicConnection: Connection;
  private defaultSlippageBps: number;
  private defaultPriorityFee: number;
  private jitoClient: JitoClient | null = null;
  private priorityFeeService: PriorityFeeService;
  private useJito: boolean;
  private apiKey?: string;
  private rpcName: string;

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
    this.publicConnection = new Connection(PUBLIC_RPC_ENDPOINTS[0], 'confirmed');
    this.defaultSlippageBps = options?.defaultSlippageBps ?? 500; // 5%
    this.defaultPriorityFee = options?.defaultPriorityFee ?? 500000; // 0.0005 SOL - increased for faster confirmation
    this.useJito = options?.useJito ?? true; // Enable Jito as fallback
    this.apiKey = options?.jupiterApiKey;
    this.rpcName = rpcUrl.includes('helius') ? 'Helius' : 'Primary RPC';

    // Initialize Jito client if enabled (used as fallback)
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
   * Execution Order (with fallback):
   * 1. Try Helius/Primary RPC first (with priority fees)
   * 2. If fails, try Jito bundles for MEV protection
   * 3. If fails, try public RPC as last resort
   *
   * Features:
   * - Dynamic priority fees based on network conditions
   * - Confirms with 'confirmed' commitment
   * - Retries with exponential backoff at each tier
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
    const shouldUseJito = options?.useJito ?? this.useJito;

    try {
      // Calculate trade value for dynamic fee
      const tradeValueSol = Number(quoteResponse.inAmount) / 1e9;

      // Get dynamic priority fee if not specified
      const priorityFee = options?.priorityFee ?? await this.getDynamicPriorityFee(tradeValueSol);

      console.log(`[Jupiter] Trade: ${tradeValueSol.toFixed(4)} SOL, Priority fee: ${priorityFee} lamports`);
      console.log(`[Jupiter] Execution order: ${this.rpcName} → ${shouldUseJito ? 'Jito → ' : ''}Public RPC`);

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

      // ========== TIER 1: Try Helius/Primary RPC first ==========
      console.log(`[Jupiter] Tier 1: Trying ${this.rpcName}...`);
      const tier1Result = await this.sendWithConnection(
        this.connection,
        quoteResponse,
        keypair,
        priorityFee,
        2 // 2 retries for primary
      );

      if (tier1Result.success) {
        console.log(`[Jupiter] ✅ ${this.rpcName} succeeded: ${tier1Result.signature}`);
        return tier1Result;
      }

      console.log(`[Jupiter] ${this.rpcName} failed: ${tier1Result.error}`);

      // ========== TIER 2: Try Jito bundles ==========
      if (shouldUseJito && this.jitoClient) {
        console.log(`[Jupiter] Tier 2: Trying Jito bundles...`);

        try {
          // Get Jito tip
          let jitoTip = options?.jitoTip;
          if (!jitoTip) {
            jitoTip = JitoClient.calculateRecommendedTip(tradeValueSol);
            try {
              const floor = await getJitoTipFloor();
              jitoTip = Math.max(jitoTip, floor);
            } catch {
              // Use calculated tip if floor fetch fails
            }
          }

          // Build fresh transaction for Jito
          const jitoSwapResponse = await this.buildSwapTransaction({
            quoteResponse,
            userPublicKey: keypair.publicKey.toBase58(),
            prioritizationFeeLamports: priorityFee,
          });

          if (!jitoSwapResponse.simulationError) {
            const jitoTxBuf = Buffer.from(jitoSwapResponse.swapTransaction, 'base64');
            const jitoTx = VersionedTransaction.deserialize(jitoTxBuf);
            jitoTx.sign([keypair]);

            console.log(`[Jupiter] Sending via Jito with ${jitoTip} lamport tip`);

            const jitoResult = await this.jitoClient.sendTransaction(
              jitoTx,
              keypair,
              {
                tipLamports: jitoTip,
                waitForConfirmation: true,
                maxWaitMs: 15000,
              }
            );

            if (jitoResult.success && jitoResult.landed) {
              console.log(`[Jupiter] ✅ Jito bundle landed: ${jitoResult.bundleId}`);
              return {
                success: true,
                signature: jitoResult.signature,
                inputAmount: quoteResponse.inAmount,
                outputAmount: quoteResponse.outAmount,
                priceImpact: quoteResponse.priceImpactPct,
              };
            }

            console.log(`[Jupiter] Jito failed: ${jitoResult.error}`);
          }
        } catch (jitoErr) {
          console.log(`[Jupiter] Jito error: ${(jitoErr as Error).message}`);
        }
      }

      // ========== TIER 3: Try Public RPC as last resort ==========
      console.log(`[Jupiter] Tier 3: Trying public RPC...`);
      const tier3Result = await this.sendWithConnection(
        this.publicConnection,
        quoteResponse,
        keypair,
        priorityFee,
        2 // 2 retries for public
      );

      if (tier3Result.success) {
        console.log(`[Jupiter] ✅ Public RPC succeeded: ${tier3Result.signature}`);
        return tier3Result;
      }

      console.log(`[Jupiter] Public RPC failed: ${tier3Result.error}`);

      // All tiers failed
      return {
        success: false,
        error: `All execution methods failed. Last error: ${tier3Result.error}`,
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
   * Helper: Send transaction via a specific connection with retries
   */
  private async sendWithConnection(
    connection: Connection,
    quoteResponse: QuoteResponse,
    keypair: Keypair,
    priorityFee: number,
    maxRetries: number
  ): Promise<SwapResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Build fresh transaction for each attempt
        const swapResponse = await this.buildSwapTransaction({
          quoteResponse,
          userPublicKey: keypair.publicKey.toBase58(),
          prioritizationFeeLamports: priorityFee,
        });

        if (swapResponse.simulationError) {
          throw new Error(`Simulation failed: ${swapResponse.simulationError}`);
        }

        const txBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(txBuf);
        transaction.sign([keypair]);

        const signature = await connection.sendTransaction(transaction, {
          skipPreflight: false,
          maxRetries: 0,
          preflightCommitment: 'confirmed',
        });

        // Confirm with timeout - poll getSignatureStatuses instead of blocking confirmTransaction
        // This avoids "block height exceeded" errors from stale blockhash while also not waiting too long
        const CONFIRMATION_TIMEOUT_MS = 30000; // 30 seconds max
        const POLL_INTERVAL_MS = 1000; // Check every second
        const startTime = Date.now();

        while (Date.now() - startTime < CONFIRMATION_TIMEOUT_MS) {
          const status = await connection.getSignatureStatus(signature);

          if (status.value !== null) {
            if (status.value.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
            }
            if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
              // Transaction confirmed successfully
              return {
                success: true,
                signature,
                inputAmount: quoteResponse.inAmount,
                outputAmount: quoteResponse.outAmount,
                priceImpact: quoteResponse.priceImpactPct,
              };
            }
          }

          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        }

        // Timeout reached - check one more time if it landed
        const finalStatus = await connection.getSignatureStatus(signature);
        if (finalStatus.value?.confirmationStatus === 'confirmed' || finalStatus.value?.confirmationStatus === 'finalized') {
          return {
            success: true,
            signature,
            inputAmount: quoteResponse.inAmount,
            outputAmount: quoteResponse.outAmount,
            priceImpact: quoteResponse.priceImpactPct,
          };
        }

        throw new Error(`Transaction confirmation timeout after ${CONFIRMATION_TIMEOUT_MS / 1000}s`);
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
