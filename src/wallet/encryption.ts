/**
 * Wallet encryption module using AES-256-GCM.
 *
 * Security Architecture:
 * - Master key stored in environment variable (Railway secrets)
 * - Each user has a unique salt stored in database
 * - Derived key = PBKDF2(MASTER_KEY, user_salt, user_id)
 * - Private keys encrypted with AES-256-GCM (authenticated encryption)
 *
 * NEVER log or expose private keys or the master key.
 */

import crypto from 'crypto';

// Constants for encryption
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100000; // High iteration count for security

/**
 * Encrypted wallet data structure.
 */
export interface EncryptedWallet {
  encryptedKey: string;  // Base64 encoded encrypted private key
  iv: string;            // Base64 encoded initialization vector
  authTag: string;       // Base64 encoded authentication tag
  salt: string;          // Base64 encoded user-specific salt
}

/**
 * Generate a random salt for a new user.
 * This salt should be stored in the database alongside the encrypted key.
 */
export function generateSalt(): string {
  return crypto.randomBytes(SALT_LENGTH).toString('base64');
}

/**
 * Generate a random initialization vector for encryption.
 * A new IV must be used for each encryption operation.
 */
function generateIV(): Buffer {
  return crypto.randomBytes(IV_LENGTH);
}

/**
 * Derive an encryption key from the master key and user-specific data.
 * Uses PBKDF2 with high iteration count for resistance to brute-force attacks.
 *
 * @param masterKey - The master encryption key from environment
 * @param salt - User-specific salt (stored in database)
 * @param userId - Telegram user ID for additional uniqueness
 * @returns Derived 256-bit encryption key
 */
function deriveKey(masterKey: string, salt: string, userId: string): Buffer {
  // Combine salt with userId for additional uniqueness
  const combinedSalt = `${salt}:${userId}`;

  return crypto.pbkdf2Sync(
    masterKey,
    combinedSalt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha256'
  );
}

/**
 * Encrypt a private key using AES-256-GCM.
 *
 * @param privateKey - The raw private key bytes (Uint8Array from Keypair.secretKey)
 * @param masterKey - Master encryption key from environment
 * @param userId - Telegram user ID
 * @param salt - User-specific salt (generate with generateSalt() for new users)
 * @returns Encrypted wallet data to store in database
 */
export function encryptPrivateKey(
  privateKey: Uint8Array,
  masterKey: string,
  userId: string,
  salt: string
): EncryptedWallet {
  // Validate inputs
  if (!privateKey || privateKey.length === 0) {
    throw new Error('Private key cannot be empty');
  }
  if (!masterKey || masterKey.length < 32) {
    throw new Error('Master key must be at least 32 characters');
  }
  if (!userId) {
    throw new Error('User ID is required');
  }
  if (!salt) {
    throw new Error('Salt is required');
  }

  // Derive user-specific encryption key
  const derivedKey = deriveKey(masterKey, salt, userId);

  // Generate random IV for this encryption
  const iv = generateIV();

  // Create cipher with AES-256-GCM
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });

  // Encrypt the private key
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(privateKey)),
    cipher.final()
  ]);

  // Get authentication tag (proves data wasn't tampered with)
  const authTag = cipher.getAuthTag();

  // Clear sensitive data from memory
  derivedKey.fill(0);

  return {
    encryptedKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    salt: salt
  };
}

/**
 * Decrypt a private key using AES-256-GCM.
 *
 * @param encryptedWallet - Encrypted wallet data from database
 * @param masterKey - Master encryption key from environment
 * @param userId - Telegram user ID
 * @returns Decrypted private key bytes
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export function decryptPrivateKey(
  encryptedWallet: EncryptedWallet,
  masterKey: string,
  userId: string
): Uint8Array {
  // Validate inputs
  if (!encryptedWallet.encryptedKey || !encryptedWallet.iv || !encryptedWallet.authTag) {
    throw new Error('Invalid encrypted wallet data');
  }
  if (!masterKey || masterKey.length < 32) {
    throw new Error('Master key must be at least 32 characters');
  }
  if (!userId) {
    throw new Error('User ID is required');
  }

  // Derive user-specific encryption key
  const derivedKey = deriveKey(masterKey, encryptedWallet.salt, userId);

  // Decode from base64
  const encrypted = Buffer.from(encryptedWallet.encryptedKey, 'base64');
  const iv = Buffer.from(encryptedWallet.iv, 'base64');
  const authTag = Buffer.from(encryptedWallet.authTag, 'base64');

  // Create decipher with AES-256-GCM
  const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });

  // Set authentication tag (will throw if data was tampered)
  decipher.setAuthTag(authTag);

  try {
    // Decrypt the private key
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    // Clear sensitive data from memory
    derivedKey.fill(0);

    return new Uint8Array(decrypted);
  } catch (error) {
    // Clear sensitive data even on error
    derivedKey.fill(0);
    throw new Error('Failed to decrypt private key: authentication failed or data corrupted');
  }
}

/**
 * Securely clear sensitive data from a buffer.
 * Call this after you're done using a private key.
 */
export function secureZero(buffer: Uint8Array | Buffer): void {
  if (buffer) {
    buffer.fill(0);
  }
}

/**
 * Validate that a master key is properly formatted.
 * Master key should be a 64-character hex string (32 bytes).
 */
export function validateMasterKey(masterKey: string): boolean {
  if (!masterKey) return false;
  // Check if it's a valid hex string of correct length
  const hexRegex = /^[0-9a-fA-F]{64}$/;
  return hexRegex.test(masterKey);
}

/**
 * Generate a secure master key for production use.
 * Run this once and store the result in your environment variables.
 */
export function generateMasterKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
