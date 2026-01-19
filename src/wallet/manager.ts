/**
 * Wallet manager for creating, importing, and managing Solana wallets.
 *
 * Supports:
 * - HD wallet generation from mnemonic (BIP39/BIP44)
 * - Direct keypair generation
 * - Private key import (base58 or byte array)
 * - Secure storage with AES-256-GCM encryption
 */

import { Keypair, PublicKey, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
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
}
