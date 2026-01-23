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
 * Execution mode for trades
 *
 * TURBO: Jito-only, skip confirmation, fastest possible (~1-2s)
 * RACE: Send Jito AND Helius simultaneously, first to confirm wins (~2-4s)
 * FAST: Jito-first with 8s confirmation, RPC fallback (~3-6s)
 * SAFE: Current behavior with longer timeouts (~30-60s)
 */
export enum ExecutionMode {
  TURBO = 'turbo',
  RACE = 'race',     // NEW: Parallel execution - fastest reliable method
  FAST = 'fast',
  SAFE = 'safe',
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
  private defaultExecutionMode: ExecutionMode;

  constructor(
    rpcUrl: string,
    options?: {
      defaultSlippageBps?: number;
      defaultPriorityFee?: number; // In lamports
      useJito?: boolean;
      heliusApiKey?: string;
      jupiterApiKey?: string;
      executionMode?: ExecutionMode;
    }
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.publicConnection = new Connection(PUBLIC_RPC_ENDPOINTS[0], 'confirmed');
    this.defaultSlippageBps = options?.defaultSlippageBps ?? 500; // 5%
    // Reasonable default priority fee
    this.defaultPriorityFee = options?.defaultPriorityFee ?? 50_000; // 0.00005 SOL (~$0.01)
    this.useJito = options?.useJito ?? true; // Enable Jito (now PRIMARY, not fallback)
    this.apiKey = options?.jupiterApiKey;
    this.rpcName = rpcUrl.includes('helius') ? 'Helius' : 'Primary RPC';
    // Default to RACE mode for optimal speed+reliability
    this.defaultExecutionMode = options?.executionMode ?? ExecutionMode.RACE;

    // Initialize Jito client if enabled (now PRIMARY execution method)
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
   * NEW Execution Order (Jito-first for speed):
   * - TURBO: Jito only, no confirmation wait (~1-2s)
   * - FAST: Jito first (5s), then RPC fallback (~2-5s)
   * - SAFE: Old behavior with longer timeouts (~30-60s)
   *
   * Features:
   * - Parallel Jito submission to all block engines
   * - Competitive tips (100x higher than before)
   * - Short timeouts with automatic retry
   */
  async executeSwap(
    quoteResponse: QuoteResponse,
    keypair: Keypair,
    options?: {
      priorityFee?: number;
      maxRetries?: number;
      useJito?: boolean;
      jitoTip?: number;
      executionMode?: ExecutionMode;
    }
  ): Promise<SwapResult> {
    const mode = options?.executionMode ?? this.defaultExecutionMode;
    const shouldUseJito = options?.useJito ?? this.useJito;

    try {
      // Calculate trade value for dynamic fee
      const tradeValueSol = Number(quoteResponse.inAmount) / 1e9;

      // Get dynamic priority fee if not specified
      const priorityFee = options?.priorityFee ?? await this.getDynamicPriorityFee(tradeValueSol);

      console.log(`[Jupiter] Trade: ${tradeValueSol.toFixed(4)} SOL, Mode: ${mode.toUpperCase()}`);
      console.log(`[Jupiter] Priority fee: ${priorityFee} lamports`);

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

      // ========== RACE MODE: Parallel Jito + Helius execution ==========
      if (mode === ExecutionMode.RACE && shouldUseJito && this.jitoClient) {
        console.log(`[Jupiter] RACE MODE: Sending Jito + ${this.rpcName} in parallel...`);

        try {
          // Calculate Jito tip
          let jitoTip = options?.jitoTip ?? JitoClient.calculateRecommendedTip(tradeValueSol);
          try {
            const floor = await getJitoTipFloor();
            jitoTip = Math.max(jitoTip, floor);
          } catch { /* Use calculated tip */ }

          console.log(`[Jupiter] Jito tip: ${(jitoTip / 1e9).toFixed(6)} SOL (~$${((jitoTip / 1e9) * 200).toFixed(2)})`);

          // Prepare Jito transaction
          const jitoTxBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
          const jitoTx = VersionedTransaction.deserialize(jitoTxBuf);
          jitoTx.sign([keypair]);

          // Prepare RPC transaction (separate copy)
          const rpcTxBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
          const rpcTx = VersionedTransaction.deserialize(rpcTxBuf);
          rpcTx.sign([keypair]);

          // Create race between Jito and RPC
          const jitoPromise = this.jitoClient!.sendTransaction(jitoTx, keypair, {
            tipLamports: jitoTip,
            waitForConfirmation: true,
            maxWaitMs: 10000, // 10 seconds for Jito
          }).then(result => ({ source: 'Jito' as const, result }));

          const rpcPromise = this.sendTransactionRaceMode(
            this.connection,
            rpcTx,
            8000 // 8 seconds for RPC
          ).then(result => ({ source: 'RPC' as const, result }));

          // Race both - first to succeed wins
          const results = await Promise.allSettled([jitoPromise, rpcPromise]);

          // Check which succeeded first
          for (const settledResult of results) {
            if (settledResult.status === 'fulfilled') {
              const { source, result } = settledResult.value;

              if (source === 'Jito') {
                if (result.success && result.landed) {
                  console.log(`[Jupiter] ✅ RACE: Jito won! Bundle: ${result.bundleId}`);
                  return {
                    success: true,
                    signature: result.signature || result.bundleId,
                    inputAmount: quoteResponse.inAmount,
                    outputAmount: quoteResponse.outAmount,
                    priceImpact: quoteResponse.priceImpactPct,
                  };
                }
              } else if (source === 'RPC') {
                if (result.success && result.signature) {
                  console.log(`[Jupiter] ✅ RACE: ${this.rpcName} won! Sig: ${result.signature}`);
                  return {
                    success: true,
                    signature: result.signature,
                    inputAmount: quoteResponse.inAmount,
                    outputAmount: quoteResponse.outAmount,
                    priceImpact: quoteResponse.priceImpactPct,
                  };
                }
              }
            }
          }

          // Neither succeeded in race, check if any got a signature (might still land)
          console.log(`[Jupiter] RACE: No immediate winner, checking results...`);

          // Log what happened
          for (const settledResult of results) {
            if (settledResult.status === 'fulfilled') {
              const { source, result } = settledResult.value;
              if (source === 'Jito') {
                console.log(`[Jupiter] Jito: ${result.error || (result.bundleId ? 'accepted but not confirmed' : 'failed')}`);
              } else {
                console.log(`[Jupiter] RPC: ${result.error || 'not confirmed in time'}`);
              }
            } else {
              console.log(`[Jupiter] Error: ${settledResult.reason}`);
            }
          }

          // Fall through to FAST mode fallback
        } catch (raceErr) {
          console.log(`[Jupiter] RACE error: ${(raceErr as Error).message}`);
        }

        // RACE mode fallback: Try once more with RPC only (fresh tx)
        console.log(`[Jupiter] RACE fallback: Fresh ${this.rpcName} attempt...`);
        const fallbackResult = await this.sendWithConnection(
          this.connection,
          quoteResponse,
          keypair,
          priorityFee,
          1,
          8000,
          true // Skip preflight for speed
        );

        if (fallbackResult.success) {
          console.log(`[Jupiter] ✅ RACE fallback succeeded: ${fallbackResult.signature}`);
          return fallbackResult;
        }

        return {
          success: false,
          error: `RACE mode: All attempts failed`,
          inputAmount: quoteResponse.inAmount,
          outputAmount: quoteResponse.outAmount,
          priceImpact: quoteResponse.priceImpactPct,
        };
      }

      // ========== JITO-FIRST EXECUTION (TURBO and FAST modes) ==========
      if (shouldUseJito && this.jitoClient && (mode === ExecutionMode.TURBO || mode === ExecutionMode.FAST)) {
        console.log(`[Jupiter] Tier 1: Jito bundles (parallel to all endpoints)...`);

        try {
          // Get Jito tip - use turbo tip for TURBO mode
          let jitoTip = options?.jitoTip;
          if (!jitoTip) {
            jitoTip = mode === ExecutionMode.TURBO
              ? JitoClient.calculateTurboTip(tradeValueSol)
              : JitoClient.calculateRecommendedTip(tradeValueSol);

            // Get tip floor and use higher of the two
            try {
              const floor = await getJitoTipFloor();
              jitoTip = Math.max(jitoTip, floor);
            } catch {
              // Use calculated tip if floor fetch fails
            }
          }

          const jitoTxBuf = Buffer.from(swapResponse.swapTransaction, 'base64');
          const jitoTx = VersionedTransaction.deserialize(jitoTxBuf);
          jitoTx.sign([keypair]);

          console.log(`[Jupiter] Jito tip: ${(jitoTip / 1e9).toFixed(6)} SOL (~$${((jitoTip / 1e9) * 200).toFixed(2)})`);

          // Use shorter timeout for TURBO mode
          const maxWaitMs = mode === ExecutionMode.TURBO ? 5000 : 8000;

          const jitoResult = await this.jitoClient.sendTransaction(
            jitoTx,
            keypair,
            {
              tipLamports: jitoTip,
              waitForConfirmation: mode !== ExecutionMode.TURBO, // Skip confirmation in TURBO
              maxWaitMs: maxWaitMs,
            }
          );

          if (jitoResult.success) {
            // For TURBO mode, return immediately even if not confirmed
            if (mode === ExecutionMode.TURBO || jitoResult.landed) {
              console.log(`[Jupiter] ✅ Jito ${mode === ExecutionMode.TURBO ? 'submitted' : 'landed'}: ${jitoResult.bundleId}`);
              return {
                success: true,
                signature: jitoResult.signature || jitoResult.bundleId,
                inputAmount: quoteResponse.inAmount,
                outputAmount: quoteResponse.outAmount,
                priceImpact: quoteResponse.priceImpactPct,
              };
            }
          }

          console.log(`[Jupiter] Jito result: ${jitoResult.error || 'not landed within timeout'}`);

          // TURBO mode: don't fallback, return immediately
          if (mode === ExecutionMode.TURBO) {
            return {
              success: false,
              error: `Jito submission failed: ${jitoResult.error || 'timeout'}`,
              inputAmount: quoteResponse.inAmount,
              outputAmount: quoteResponse.outAmount,
              priceImpact: quoteResponse.priceImpactPct,
            };
          }
        } catch (jitoErr) {
          console.log(`[Jupiter] Jito error: ${(jitoErr as Error).message}`);
          if (mode === ExecutionMode.TURBO) {
            return {
              success: false,
              error: `Jito error: ${(jitoErr as Error).message}`,
              inputAmount: quoteResponse.inAmount,
              outputAmount: quoteResponse.outAmount,
              priceImpact: quoteResponse.priceImpactPct,
            };
          }
        }
      }

      // ========== TIER 2: Try RPC (fallback for FAST mode, primary for SAFE) ==========
      const tier2Timeout = mode === ExecutionMode.SAFE ? 30000 : 10000;
      console.log(`[Jupiter] Tier 2: ${this.rpcName} (${tier2Timeout / 1000}s timeout)...`);

      const tier2Result = await this.sendWithConnection(
        this.connection,
        quoteResponse,
        keypair,
        priorityFee,
        mode === ExecutionMode.SAFE ? 2 : 1, // Fewer retries in FAST mode
        tier2Timeout,
        mode !== ExecutionMode.SAFE // Skip preflight in FAST mode for speed
      );

      if (tier2Result.success) {
        console.log(`[Jupiter] ✅ ${this.rpcName} succeeded: ${tier2Result.signature}`);
        return tier2Result;
      }

      console.log(`[Jupiter] ${this.rpcName} failed: ${tier2Result.error}`);

      // ========== TIER 3: Jito fallback for SAFE mode ==========
      if (mode === ExecutionMode.SAFE && shouldUseJito && this.jitoClient) {
        console.log(`[Jupiter] Tier 3: Jito bundles (SAFE mode fallback)...`);

        try {
          let jitoTip = options?.jitoTip ?? JitoClient.calculateRecommendedTip(tradeValueSol);

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

      // ========== TIER 4: Public RPC as last resort (SAFE mode only) ==========
      if (mode === ExecutionMode.SAFE) {
        console.log(`[Jupiter] Tier 4: Public RPC (last resort)...`);
        const tier4Result = await this.sendWithConnection(
          this.publicConnection,
          quoteResponse,
          keypair,
          priorityFee,
          2,
          30000,
          false
        );

        if (tier4Result.success) {
          console.log(`[Jupiter] ✅ Public RPC succeeded: ${tier4Result.signature}`);
          return tier4Result;
        }

        console.log(`[Jupiter] Public RPC failed: ${tier4Result.error}`);
      }

      // All tiers failed
      return {
        success: false,
        error: `All execution methods failed (mode: ${mode})`,
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
   * Helper: Send pre-signed transaction and poll for confirmation (for RACE mode)
   *
   * @param connection - RPC connection to use
   * @param signedTx - Already signed transaction
   * @param timeoutMs - Max time to wait for confirmation
   */
  private async sendTransactionRaceMode(
    connection: Connection,
    signedTx: VersionedTransaction,
    timeoutMs: number
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      // Send transaction (skip preflight for speed)
      const signature = await connection.sendTransaction(signedTx, {
        skipPreflight: true,
        maxRetries: 0,
        preflightCommitment: 'confirmed',
      });

      // Poll for confirmation with fast interval
      const POLL_INTERVAL_MS = 150; // Very fast polling for race
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        const status = await connection.getSignatureStatus(signature);

        if (status.value !== null) {
          if (status.value.err) {
            return { success: false, error: `Tx failed: ${JSON.stringify(status.value.err)}` };
          }
          if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
            return { success: true, signature };
          }
        }

        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }

      // Timeout - one more check
      const finalStatus = await connection.getSignatureStatus(signature);
      if (finalStatus.value?.confirmationStatus === 'confirmed' || finalStatus.value?.confirmationStatus === 'finalized') {
        return { success: true, signature };
      }

      return { success: false, signature, error: 'Confirmation timeout' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Helper: Send transaction via a specific connection with retries
   *
   * @param connection - RPC connection to use
   * @param quoteResponse - Jupiter quote
   * @param keypair - Signer keypair
   * @param priorityFee - Priority fee in lamports
   * @param maxRetries - Number of retry attempts
   * @param timeoutMs - Confirmation timeout (default 30s, use 10s for FAST mode)
   * @param skipPreflight - Skip preflight for speed (default false)
   */
  private async sendWithConnection(
    connection: Connection,
    quoteResponse: QuoteResponse,
    keypair: Keypair,
    priorityFee: number,
    maxRetries: number,
    timeoutMs: number = 30000,
    skipPreflight: boolean = false
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

        // Skip preflight for FAST mode (professional bots do this for speed)
        const signature = await connection.sendTransaction(transaction, {
          skipPreflight: skipPreflight,
          maxRetries: 0,
          preflightCommitment: 'confirmed',
        });

        // Confirm with configurable timeout
        // Reduced poll interval for faster confirmation detection
        const POLL_INTERVAL_MS = skipPreflight ? 200 : 500; // Poll faster in FAST mode
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
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

        throw new Error(`Transaction confirmation timeout after ${timeoutMs / 1000}s`);
      } catch (err) {
        lastError = err as Error;
        if (attempt < maxRetries - 1) {
          // Shorter backoff in FAST mode
          const backoffMs = skipPreflight ? 300 : Math.pow(2, attempt) * 1000;
          await new Promise(r => setTimeout(r, backoffMs));
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
      executionMode?: ExecutionMode;
    }
  ): Promise<SwapResult> {
    const quote = await this.getBuyQuote(
      tokenMint,
      solAmount,
      options?.slippageBps
    );

    return this.executeSwap(quote, keypair, {
      priorityFee: options?.priorityFee,
      executionMode: options?.executionMode,
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
      executionMode?: ExecutionMode;
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
      executionMode: options?.executionMode,
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
