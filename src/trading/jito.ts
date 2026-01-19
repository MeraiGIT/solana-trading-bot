/**
 * Jito Bundle Client
 *
 * Provides MEV protection by sending transactions through Jito's private mempool.
 * Transactions in Jito bundles are hidden from MEV bots until they're included in a block.
 *
 * Features:
 * - Private transaction submission
 * - Bundle tips for priority inclusion
 * - Automatic retry with backoff
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

// Jito Block Engine endpoints
const JITO_ENDPOINTS = {
  mainnet: 'https://mainnet.block-engine.jito.wtf',
  amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf',
  frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf',
  ny: 'https://ny.mainnet.block-engine.jito.wtf',
  tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf',
};

// Jito tip accounts (one is randomly selected)
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

// Types
export interface BundleResult {
  success: boolean;
  bundleId?: string;
  signature?: string;
  error?: string;
  landed?: boolean;
}

export interface JitoConfig {
  endpoint?: keyof typeof JITO_ENDPOINTS | string;
  tipLamports?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Jito Bundle Client for MEV-protected transactions
 */
export class JitoClient {
  private connection: Connection;
  private endpoint: string;
  private tipLamports: number;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(rpcUrl: string, config?: JitoConfig) {
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Set Jito endpoint
    if (config?.endpoint && config.endpoint in JITO_ENDPOINTS) {
      this.endpoint = JITO_ENDPOINTS[config.endpoint as keyof typeof JITO_ENDPOINTS];
    } else if (config?.endpoint) {
      this.endpoint = config.endpoint;
    } else {
      this.endpoint = JITO_ENDPOINTS.mainnet;
    }

    // Default tip: 10,000 lamports (0.00001 SOL ~ $0.002)
    // Increase for high-value trades
    this.tipLamports = config?.tipLamports ?? 10000;
    this.maxRetries = config?.maxRetries ?? 3;
    this.retryDelayMs = config?.retryDelayMs ?? 1000;
  }

  /**
   * Get a random Jito tip account
   */
  private getRandomTipAccount(): PublicKey {
    const index = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    return new PublicKey(JITO_TIP_ACCOUNTS[index]);
  }

  /**
   * Create a tip transaction to include in the bundle
   */
  async createTipTransaction(
    payer: Keypair,
    tipLamports?: number
  ): Promise<Transaction> {
    const tipAccount = this.getRandomTipAccount();
    const tip = tipLamports ?? this.tipLamports;

    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: tipAccount,
        lamports: tip,
      })
    );

    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer.publicKey;
    transaction.sign(payer);

    return transaction;
  }

  /**
   * Send a bundle of transactions to Jito
   */
  async sendBundle(
    transactions: (Transaction | VersionedTransaction)[],
    _options?: {
      skipPreflight?: boolean;
    }
  ): Promise<BundleResult> {
    // Serialize transactions to base64
    const serializedTxs = transactions.map((tx) => {
      if (tx instanceof VersionedTransaction) {
        return Buffer.from(tx.serialize()).toString('base64');
      } else {
        return tx.serialize().toString('base64');
      }
    });

    // Send to Jito block engine
    const response = await fetch(`${this.endpoint}/api/v1/bundles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [serializedTxs],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        error: `Jito bundle submission failed: ${error}`,
      };
    }

    const result = await response.json() as { error?: { message?: string }; result?: string };

    if (result.error) {
      return {
        success: false,
        error: result.error.message || JSON.stringify(result.error),
      };
    }

    return {
      success: true,
      bundleId: result.result,
    };
  }

  /**
   * Check if a bundle has landed on-chain
   */
  async getBundleStatus(bundleId: string): Promise<{
    landed: boolean;
    status: string;
  }> {
    const response = await fetch(`${this.endpoint}/api/v1/bundles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBundleStatuses',
        params: [[bundleId]],
      }),
    });

    if (!response.ok) {
      return { landed: false, status: 'unknown' };
    }

    interface BundleStatusResult {
      error?: unknown;
      result?: {
        value?: Array<{
          confirmation_status?: string;
        }>;
      };
    }

    const result = await response.json() as BundleStatusResult;

    if (result.error || !result.result?.value?.[0]) {
      return { landed: false, status: 'not_found' };
    }

    const bundleStatus = result.result.value[0];
    const status = bundleStatus.confirmation_status || 'pending';
    const landed = status === 'confirmed' || status === 'finalized';

    return { landed, status };
  }

  /**
   * Send a single transaction with Jito MEV protection
   *
   * This creates a bundle with:
   * 1. Your transaction
   * 2. A tip transaction to Jito validators
   */
  async sendTransaction(
    transaction: VersionedTransaction,
    payer: Keypair,
    options?: {
      tipLamports?: number;
      waitForConfirmation?: boolean;
      maxWaitMs?: number;
    }
  ): Promise<BundleResult> {
    const tipLamports = options?.tipLamports ?? this.tipLamports;
    const waitForConfirmation = options?.waitForConfirmation ?? true;
    const maxWaitMs = options?.maxWaitMs ?? 30000;

    // Create tip transaction
    const tipTx = await this.createTipTransaction(payer, tipLamports);

    // Send bundle with main transaction + tip
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const bundleResult = await this.sendBundle([transaction, tipTx]);

        if (!bundleResult.success) {
          if (attempt < this.maxRetries - 1) {
            await this.sleep(this.retryDelayMs * Math.pow(2, attempt));
            continue;
          }
          return bundleResult;
        }

        // Wait for bundle to land if requested
        if (waitForConfirmation && bundleResult.bundleId) {
          const startTime = Date.now();

          while (Date.now() - startTime < maxWaitMs) {
            const status = await this.getBundleStatus(bundleResult.bundleId);

            if (status.landed) {
              // Get the transaction signature
              const signature = await this.getTransactionSignature(transaction);
              return {
                success: true,
                bundleId: bundleResult.bundleId,
                signature,
                landed: true,
              };
            }

            if (status.status === 'failed') {
              return {
                success: false,
                bundleId: bundleResult.bundleId,
                error: 'Bundle failed to land',
                landed: false,
              };
            }

            await this.sleep(1000);
          }

          // Timeout - check if transaction landed anyway
          const signature = await this.getTransactionSignature(transaction);
          if (signature) {
            const confirmed = await this.isTransactionConfirmed(signature);
            if (confirmed) {
              return {
                success: true,
                bundleId: bundleResult.bundleId,
                signature,
                landed: true,
              };
            }
          }

          return {
            success: false,
            bundleId: bundleResult.bundleId,
            error: 'Bundle confirmation timeout',
            landed: false,
          };
        }

        return bundleResult;
      } catch (err) {
        if (attempt < this.maxRetries - 1) {
          await this.sleep(this.retryDelayMs * Math.pow(2, attempt));
          continue;
        }
        return {
          success: false,
          error: (err as Error).message,
        };
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded',
    };
  }

  /**
   * Get transaction signature from a versioned transaction
   */
  private async getTransactionSignature(
    transaction: VersionedTransaction
  ): Promise<string | undefined> {
    if (transaction.signatures.length > 0) {
      const signature = transaction.signatures[0];
      if (signature) {
        return Buffer.from(signature).toString('base64');
      }
    }
    return undefined;
  }

  /**
   * Check if a transaction is confirmed
   */
  private async isTransactionConfirmed(signature: string): Promise<boolean> {
    try {
      const status = await this.connection.getSignatureStatus(signature);
      return (
        status?.value?.confirmationStatus === 'confirmed' ||
        status?.value?.confirmationStatus === 'finalized'
      );
    } catch {
      return false;
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate recommended tip based on trade value
   *
   * Higher value trades should use higher tips for faster inclusion
   */
  static calculateRecommendedTip(tradeValueSol: number): number {
    if (tradeValueSol < 0.1) {
      return 10000; // 0.00001 SOL
    } else if (tradeValueSol < 1) {
      return 50000; // 0.00005 SOL
    } else if (tradeValueSol < 10) {
      return 100000; // 0.0001 SOL
    } else {
      return 500000; // 0.0005 SOL
    }
  }
}

/**
 * Get current Jito tip floor (minimum tip to be competitive)
 */
export async function getJitoTipFloor(): Promise<number> {
  try {
    const response = await fetch(
      'https://bundles.jito.wtf/api/v1/bundles/tip_floor'
    );
    if (response.ok) {
      interface TipFloorData {
        landed_tips_50th_percentile?: number;
      }
      const data = await response.json() as TipFloorData[];
      // Return 50th percentile tip in lamports
      return Math.ceil((data[0]?.landed_tips_50th_percentile ?? 0) * LAMPORTS_PER_SOL) || 10000;
    }
  } catch {
    // Fallback to default
  }
  return 10000;
}

export { JITO_ENDPOINTS, JITO_TIP_ACCOUNTS };
