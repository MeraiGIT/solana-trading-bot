/**
 * Encryption Module Tests
 *
 * Tests for AES-256-GCM encryption used for wallet private keys.
 */

import { describe, it, expect } from '@jest/globals';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  generateSalt,
  secureZero,
  validateMasterKey,
  generateMasterKey,
} from '../src/wallet/encryption.js';

describe('Encryption Module', () => {
  const testMasterKey = 'a'.repeat(64); // 64 hex chars = 32 bytes
  const testUserId = '123456789';

  describe('generateSalt', () => {
    it('should generate a base64 encoded salt', () => {
      const salt = generateSalt();
      expect(salt).toBeDefined();
      expect(typeof salt).toBe('string');
      // Base64 encoded 32 bytes is ~44 chars
      expect(salt.length).toBeGreaterThan(40);
    });

    it('should generate unique salts', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).not.toBe(salt2);
    });
  });

  describe('encryptPrivateKey', () => {
    it('should encrypt a private key', () => {
      const privateKey = new Uint8Array(64).fill(42);
      const salt = generateSalt();

      const encrypted = encryptPrivateKey(privateKey, testMasterKey, testUserId, salt);

      expect(encrypted).toBeDefined();
      expect(encrypted.encryptedKey).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.salt).toBe(salt);
    });

    it('should produce different ciphertexts for same key (due to random IV)', () => {
      const privateKey = new Uint8Array(64).fill(42);
      const salt = generateSalt();

      const encrypted1 = encryptPrivateKey(privateKey, testMasterKey, testUserId, salt);
      const encrypted2 = encryptPrivateKey(privateKey, testMasterKey, testUserId, salt);

      // Different IVs should produce different ciphertexts
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.encryptedKey).not.toBe(encrypted2.encryptedKey);
    });

    it('should throw on empty private key', () => {
      const emptyKey = new Uint8Array(0);
      const salt = generateSalt();

      expect(() => {
        encryptPrivateKey(emptyKey, testMasterKey, testUserId, salt);
      }).toThrow('Private key cannot be empty');
    });

    it('should throw on invalid master key', () => {
      const privateKey = new Uint8Array(64).fill(42);
      const salt = generateSalt();

      expect(() => {
        encryptPrivateKey(privateKey, 'short', testUserId, salt);
      }).toThrow('Master key must be at least 32 characters');
    });

    it('should throw on missing user ID', () => {
      const privateKey = new Uint8Array(64).fill(42);
      const salt = generateSalt();

      expect(() => {
        encryptPrivateKey(privateKey, testMasterKey, '', salt);
      }).toThrow('User ID is required');
    });

    it('should throw on missing salt', () => {
      const privateKey = new Uint8Array(64).fill(42);

      expect(() => {
        encryptPrivateKey(privateKey, testMasterKey, testUserId, '');
      }).toThrow('Salt is required');
    });
  });

  describe('decryptPrivateKey', () => {
    it('should decrypt an encrypted private key', () => {
      const originalKey = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        originalKey[i] = i;
      }
      const salt = generateSalt();

      const encrypted = encryptPrivateKey(originalKey, testMasterKey, testUserId, salt);
      const decrypted = decryptPrivateKey(encrypted, testMasterKey, testUserId);

      expect(decrypted).toEqual(originalKey);
    });

    it('should fail with wrong master key', () => {
      const privateKey = new Uint8Array(64).fill(42);
      const salt = generateSalt();

      const encrypted = encryptPrivateKey(privateKey, testMasterKey, testUserId, salt);
      const wrongMasterKey = 'b'.repeat(64);

      expect(() => {
        decryptPrivateKey(encrypted, wrongMasterKey, testUserId);
      }).toThrow('Failed to decrypt private key');
    });

    it('should fail with wrong user ID', () => {
      const privateKey = new Uint8Array(64).fill(42);
      const salt = generateSalt();

      const encrypted = encryptPrivateKey(privateKey, testMasterKey, testUserId, salt);

      expect(() => {
        decryptPrivateKey(encrypted, testMasterKey, 'wrong_user_id');
      }).toThrow('Failed to decrypt private key');
    });

    it('should fail with tampered ciphertext', () => {
      const privateKey = new Uint8Array(64).fill(42);
      const salt = generateSalt();

      const encrypted = encryptPrivateKey(privateKey, testMasterKey, testUserId, salt);

      // Tamper with the encrypted key
      const tampered = { ...encrypted };
      const encryptedBytes = Buffer.from(tampered.encryptedKey, 'base64');
      encryptedBytes[0] = (encryptedBytes[0] + 1) % 256;
      tampered.encryptedKey = encryptedBytes.toString('base64');

      expect(() => {
        decryptPrivateKey(tampered, testMasterKey, testUserId);
      }).toThrow('Failed to decrypt private key');
    });

    it('should fail with invalid encrypted wallet data', () => {
      expect(() => {
        decryptPrivateKey(
          { encryptedKey: '', iv: '', authTag: '', salt: '' },
          testMasterKey,
          testUserId
        );
      }).toThrow('Invalid encrypted wallet data');
    });
  });

  describe('secureZero', () => {
    it('should zero out a buffer', () => {
      const buffer = new Uint8Array([1, 2, 3, 4, 5]);
      secureZero(buffer);
      expect(buffer).toEqual(new Uint8Array([0, 0, 0, 0, 0]));
    });

    it('should handle null/undefined gracefully', () => {
      expect(() => secureZero(null as unknown as Uint8Array)).not.toThrow();
      expect(() => secureZero(undefined as unknown as Uint8Array)).not.toThrow();
    });
  });

  describe('validateMasterKey', () => {
    it('should validate correct 64-char hex key', () => {
      const validKey = 'abcdef0123456789'.repeat(4); // 64 chars
      expect(validateMasterKey(validKey)).toBe(true);
    });

    it('should reject short keys', () => {
      expect(validateMasterKey('abc')).toBe(false);
    });

    it('should reject non-hex characters', () => {
      const invalidKey = 'g'.repeat(64); // 'g' is not hex
      expect(validateMasterKey(invalidKey)).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateMasterKey('')).toBe(false);
    });

    it('should reject null/undefined', () => {
      expect(validateMasterKey(null as unknown as string)).toBe(false);
      expect(validateMasterKey(undefined as unknown as string)).toBe(false);
    });
  });

  describe('generateMasterKey', () => {
    it('should generate a valid 64-char hex key', () => {
      const key = generateMasterKey();
      expect(key.length).toBe(64);
      expect(validateMasterKey(key)).toBe(true);
    });

    it('should generate unique keys', () => {
      const key1 = generateMasterKey();
      const key2 = generateMasterKey();
      expect(key1).not.toBe(key2);
    });
  });
});
