/**
 * Wallet manager for creating, importing, and managing Solana wallets.
 *
 * Supports:
 * - HD wallet generation from mnemonic (BIP39/BIP44)
 * - Direct keypair generation
 * - Private key import (base58 or byte array)
 * - Secure storage with AES-256-GCM encryption
 */

import {
  Keypair,
  PublicKey,
  Connection,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  ParsedAccountData,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import bs58 from 'bs58';

import {
  encryptPrivateKey,
  decryptPrivateKey,
  generateSalt,
  secureZero,
  EncryptedWallet
} from './encryption.js';

/**
 * Wallet data structure for database storage.
 */
export interface WalletData {
  userId: string;
  publicAddress: string;
  encryptedPrivateKey: string;
  iv: string;
  authTag: string;
  salt: string;
  isImported: boolean;
  createdAt: Date;
}

/**
 * Wallet balance information.
 */
export interface WalletBalance {
  sol: number;
  lamports: number;
}

/**
 * SPL Token balance information.
 */
export interface TokenBalance {
  mint: string;           // Token mint address
  amount: number;         // Human-readable amount (divided by 10^decimals)
  rawAmount: string;      // Raw amount in smallest units (string to avoid precision loss)
  decimals: number;       // Token decimals
}

/**
 * Cache entry for token balance.
 */
interface TokenBalanceCacheEntry {
  balance: TokenBalance;
  timestamp: number;
}

/**
 * Solana derivation path (BIP44)
 * m/44'/501'/0'/0' is the standard for Solana
 */
const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";

/**
 * Generate a new HD wallet with mnemonic phrase.
 * The mnemonic can be shown to the user for backup.
 *
 * @returns Object containing keypair and mnemonic
 */
export function generateHDWallet(): { keypair: Keypair; mnemonic: string } {
  // Generate 24-word mnemonic (256 bits of entropy)
  const mnemonic = bip39.generateMnemonic(256);

  // Derive seed from mnemonic
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Derive keypair using Solana's derivation path
  const derivedSeed = derivePath(SOLANA_DERIVATION_PATH, seed.toString('hex')).key;

  // Create keypair from derived seed
  const keypair = Keypair.fromSeed(derivedSeed);

  return { keypair, mnemonic };
}

/**
 * Restore a wallet from mnemonic phrase.
 *
 * @param mnemonic - 12 or 24 word mnemonic phrase
 * @returns Keypair derived from mnemonic
 */
export function restoreFromMnemonic(mnemonic: string): Keypair {
  // Validate mnemonic
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Derive seed from mnemonic
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Derive keypair using Solana's derivation path
  const derivedSeed = derivePath(SOLANA_DERIVATION_PATH, seed.toString('hex')).key;

  return Keypair.fromSeed(derivedSeed);
}

/**
 * Generate a simple random wallet (no mnemonic backup).
 *
 * @returns New random keypair
 */
export function generateSimpleWallet(): Keypair {
  return Keypair.generate();
}

/**
 * Import a wallet from a base58-encoded private key.
 * This is the format commonly exported from wallets like Phantom.
 *
 * @param base58PrivateKey - Base58 encoded private key string
 * @returns Imported keypair
 */
export function importFromBase58(base58PrivateKey: string): Keypair {
  try {
    const secretKey = bs58.decode(base58PrivateKey);

    // Solana secret keys should be 64 bytes (32 byte private + 32 byte public)
    if (secretKey.length !== 64) {
      throw new Error('Invalid private key length');
    }

    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    throw new Error('Invalid base58 private key format');
  }
}

/**
 * Import a wallet from a byte array (JSON format from Solana CLI).
 *
 * @param byteArray - Array of 64 numbers representing the secret key
 * @returns Imported keypair
 */
export function importFromByteArray(byteArray: number[]): Keypair {
  if (!Array.isArray(byteArray) || byteArray.length !== 64) {
    throw new Error('Invalid byte array format (must be 64 bytes)');
  }

  return Keypair.fromSecretKey(new Uint8Array(byteArray));
}

/**
 * Export a private key as base58 string (for user backup).
 *
 * @param keypair - Keypair to export
 * @returns Base58 encoded private key
 */
export function exportToBase58(keypair: Keypair): string {
  return bs58.encode(keypair.secretKey);
}

/**
 * WalletManager class for managing user wallets with encryption.
 */
export class WalletManager {
  private masterKey: string;
  private connection: Connection;
  private tokenBalanceCache: Map<string, TokenBalanceCacheEntry> = new Map();
  private static readonly CACHE_TTL_MS = 5000; // 5 second cache TTL

  /**
   * Create a new WalletManager instance.
   *
   * @param masterKey - Master encryption key from environment
   * @param rpcUrl - Solana RPC URL
   */
  constructor(masterKey: string, rpcUrl: string) {
    if (!masterKey || masterKey.length < 32) {
      throw new Error('Invalid master encryption key');
    }

    this.masterKey = masterKey;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Create a new wallet for a user and return encrypted data for storage.
   *
   * @param userId - Telegram user ID
   * @returns Wallet data ready for database storage and the public address
   */
  createWallet(userId: string): { walletData: WalletData; publicAddress: string } {
    // Generate new keypair
    const keypair = generateSimpleWallet();

    // Generate user-specific salt
    const salt = generateSalt();

    // Encrypt the private key
    const encrypted = encryptPrivateKey(
      keypair.secretKey,
      this.masterKey,
      userId,
      salt
    );

    const publicAddress = keypair.publicKey.toBase58();

    // Clear the secret key from memory
    secureZero(keypair.secretKey);

    const walletData: WalletData = {
      userId,
      publicAddress,
      encryptedPrivateKey: encrypted.encryptedKey,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      salt: encrypted.salt,
      isImported: false,
      createdAt: new Date()
    };

    return { walletData, publicAddress };
  }

  /**
   * Import an existing wallet from a base58 private key.
   *
   * @param userId - Telegram user ID
   * @param base58PrivateKey - Base58 encoded private key
   * @returns Wallet data ready for database storage and the public address
   */
  importWallet(userId: string, base58PrivateKey: string): { walletData: WalletData; publicAddress: string } {
    // Import keypair
    const keypair = importFromBase58(base58PrivateKey);

    // Generate user-specific salt
    const salt = generateSalt();

    // Encrypt the private key
    const encrypted = encryptPrivateKey(
      keypair.secretKey,
      this.masterKey,
      userId,
      salt
    );

    const publicAddress = keypair.publicKey.toBase58();

    // Clear the secret key from memory
    secureZero(keypair.secretKey);

    const walletData: WalletData = {
      userId,
      publicAddress,
      encryptedPrivateKey: encrypted.encryptedKey,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      salt: encrypted.salt,
      isImported: true,
      createdAt: new Date()
    };

    return { walletData, publicAddress };
  }

  /**
   * Get the keypair for a user (for signing transactions).
   * IMPORTANT: Clear the keypair from memory after use with secureZero().
   *
   * @param walletData - Encrypted wallet data from database
   * @returns Decrypted keypair for transaction signing
   */
  getKeypair(walletData: WalletData): Keypair {
    const encryptedWallet: EncryptedWallet = {
      encryptedKey: walletData.encryptedPrivateKey,
      iv: walletData.iv,
      authTag: walletData.authTag,
      salt: walletData.salt
    };

    const secretKey = decryptPrivateKey(
      encryptedWallet,
      this.masterKey,
      walletData.userId
    );

    return Keypair.fromSecretKey(secretKey);
  }

  /**
   * Export the private key for user backup.
   * Should require additional verification (e.g., 2FA).
   *
   * @param walletData - Encrypted wallet data from database
   * @returns Base58 encoded private key
   */
  exportPrivateKey(walletData: WalletData): string {
    const keypair = this.getKeypair(walletData);
    const exported = exportToBase58(keypair);

    // Clear the secret key from memory
    secureZero(keypair.secretKey);

    return exported;
  }

  /**
   * Get wallet balance in SOL.
   *
   * @param publicAddress - Wallet public address
   * @returns Balance in SOL and lamports
   */
  async getBalance(publicAddress: string): Promise<WalletBalance> {
    const publicKey = new PublicKey(publicAddress);
    const lamports = await this.connection.getBalance(publicKey);

    return {
      sol: lamports / LAMPORTS_PER_SOL,
      lamports
    };
  }

  /**
   * Validate a Solana address format.
   *
   * @param address - Address to validate
   * @returns True if valid Solana address
   */
  static isValidAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate a base58 private key format.
   *
   * @param base58Key - Private key to validate
   * @returns True if valid format
   */
  static isValidPrivateKey(base58Key: string): boolean {
    try {
      const decoded = bs58.decode(base58Key);
      return decoded.length === 64;
    } catch {
      return false;
    }
  }

  /**
   * Withdraw SOL to an external address.
   *
   * @param walletData - User's encrypted wallet data
   * @param destinationAddress - Address to send SOL to
   * @param amountSol - Amount in SOL to send
   * @returns Transaction signature or throws error
   */
  async withdrawSol(
    walletData: WalletData,
    destinationAddress: string,
    amountSol: number
  ): Promise<{ signature: string; fee: number }> {
    // Get keypair for signing
    const keypair = this.getKeypair(walletData);

    try {
      const destination = new PublicKey(destinationAddress);
      const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

      // Get current balance to check if enough
      const balance = await this.connection.getBalance(keypair.publicKey);

      // Estimate fee (typically ~5000 lamports for simple transfer)
      const estimatedFee = 5000;

      if (balance < lamports + estimatedFee) {
        throw new Error(`Insufficient balance. Available: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      }

      // Create transfer transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: destination,
          lamports,
        })
      );

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;

      // Sign and send
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [keypair],
        {
          commitment: 'confirmed',
        }
      );

      // Clear keypair from memory
      secureZero(keypair.secretKey);

      return {
        signature,
        fee: estimatedFee / LAMPORTS_PER_SOL,
      };
    } catch (error) {
      // Clear keypair from memory even on error
      secureZero(keypair.secretKey);
      throw error;
    }
  }

  /**
   * Get estimated network fee for a SOL transfer.
   */
  async getTransferFee(): Promise<number> {
    try {
      const { feeCalculator } = await this.connection.getRecentBlockhash();
      // Estimate for a simple transfer (1 signature)
      return (feeCalculator?.lamportsPerSignature || 5000) / LAMPORTS_PER_SOL;
    } catch {
      return 0.000005; // Default fallback
    }
  }

  // ============================================
  // SPL TOKEN BALANCE OPERATIONS
  // ============================================

  /**
   * Get the balance of a specific SPL token for a wallet.
   * This queries the blockchain directly for accurate balance.
   *
   * @param walletAddress - Wallet public address
   * @param tokenMint - Token mint address
   * @param useCache - Whether to use cached balance if available (default: true)
   * @returns Token balance or null if no tokens found
   */
  async getTokenBalance(
    walletAddress: string,
    tokenMint: string,
    useCache: boolean = true
  ): Promise<TokenBalance | null> {
    const cacheKey = `${walletAddress}:${tokenMint}`;

    // Check cache first
    if (useCache) {
      const cached = this.tokenBalanceCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < WalletManager.CACHE_TTL_MS) {
        return cached.balance;
      }
    }

    try {
      const walletPubkey = new PublicKey(walletAddress);
      const mintPubkey = new PublicKey(tokenMint);

      // Get all token accounts for this wallet filtered by mint
      const response = await this.connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { mint: mintPubkey }
      );

      if (response.value.length === 0) {
        // No token account found - clear cache and return null
        this.tokenBalanceCache.delete(cacheKey);
        return null;
      }

      // There should typically be only one ATA per token
      const accountInfo = response.value[0].account.data as ParsedAccountData;
      const parsedInfo = accountInfo.parsed?.info;

      if (!parsedInfo || !parsedInfo.tokenAmount) {
        return null;
      }

      const tokenAmount = parsedInfo.tokenAmount;
      const balance: TokenBalance = {
        mint: tokenMint,
        amount: Number(tokenAmount.uiAmount) || 0,
        rawAmount: tokenAmount.amount || '0',
        decimals: tokenAmount.decimals || 0,
      };

      // Update cache
      this.tokenBalanceCache.set(cacheKey, {
        balance,
        timestamp: Date.now(),
      });

      return balance;
    } catch (error) {
      console.error(`Error fetching token balance for ${tokenMint}:`, error);

      // On error, retry once after 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        const walletPubkey = new PublicKey(walletAddress);
        const mintPubkey = new PublicKey(tokenMint);

        const response = await this.connection.getParsedTokenAccountsByOwner(
          walletPubkey,
          { mint: mintPubkey }
        );

        if (response.value.length === 0) {
          return null;
        }

        const accountInfo = response.value[0].account.data as ParsedAccountData;
        const parsedInfo = accountInfo.parsed?.info;

        if (!parsedInfo || !parsedInfo.tokenAmount) {
          return null;
        }

        const tokenAmount = parsedInfo.tokenAmount;
        return {
          mint: tokenMint,
          amount: Number(tokenAmount.uiAmount) || 0,
          rawAmount: tokenAmount.amount || '0',
          decimals: tokenAmount.decimals || 0,
        };
      } catch (retryError) {
        console.error(`Retry also failed for token balance:`, retryError);
        return null;
      }
    }
  }

  /**
   * Get all SPL token balances for a wallet.
   * Useful for displaying positions view.
   *
   * @param walletAddress - Wallet public address
   * @returns Array of all token balances
   */
  async getAllTokenBalances(walletAddress: string): Promise<TokenBalance[]> {
    try {
      const walletPubkey = new PublicKey(walletAddress);

      // Get all token accounts for this wallet
      const response = await this.connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { programId: TOKEN_PROGRAM_ID }
      );

      const balances: TokenBalance[] = [];

      for (const account of response.value) {
        const accountInfo = account.account.data as ParsedAccountData;
        const parsedInfo = accountInfo.parsed?.info;

        if (!parsedInfo || !parsedInfo.tokenAmount) {
          continue;
        }

        const tokenAmount = parsedInfo.tokenAmount;
        const amount = Number(tokenAmount.uiAmount) || 0;

        // Skip zero balances
        if (amount <= 0) {
          continue;
        }

        const balance: TokenBalance = {
          mint: parsedInfo.mint,
          amount,
          rawAmount: tokenAmount.amount || '0',
          decimals: tokenAmount.decimals || 0,
        };

        balances.push(balance);

        // Update cache for each token
        const cacheKey = `${walletAddress}:${parsedInfo.mint}`;
        this.tokenBalanceCache.set(cacheKey, {
          balance,
          timestamp: Date.now(),
        });
      }

      return balances;
    } catch (error) {
      console.error(`Error fetching all token balances:`, error);
      return [];
    }
  }

  /**
   * Invalidate cached balance for a specific token.
   * Call this after buy/sell operations.
   *
   * @param walletAddress - Wallet public address
   * @param tokenMint - Token mint address
   */
  invalidateTokenBalanceCache(walletAddress: string, tokenMint: string): void {
    const cacheKey = `${walletAddress}:${tokenMint}`;
    this.tokenBalanceCache.delete(cacheKey);
  }

  /**
   * Clear all cached token balances.
   */
  clearTokenBalanceCache(): void {
    this.tokenBalanceCache.clear();
  }
}
