import crypto from "crypto";

/**
 * KYC Document Encryption Utilities
 *
 * Uses AES-256-GCM for encrypting sensitive KYC documents before storage.
 * This is required for POPIA compliance in South Africa.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // NIST-recommended 12 bytes for AES-GCM
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 600000; // OWASP 2023 recommendation for PBKDF2-SHA512

/**
 * Get or generate encryption key from environment
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.KYC_ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error("KYC_ENCRYPTION_KEY not configured");
  }

  if (keyHex.length !== KEY_LENGTH * 2) {
    throw new Error(
      `KYC_ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes)`
    );
  }

  if (!/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new Error("KYC_ENCRYPTION_KEY must contain only hexadecimal characters (0-9, a-f)");
  }

  return Buffer.from(keyHex, "hex");
}

import { promisify } from "util";

const pbkdf2Async = promisify(crypto.pbkdf2);

/**
 * Derive encryption key from master key using PBKDF2 (async to avoid blocking the event loop)
 */
async function deriveKey(masterKey: Buffer, salt: Buffer): Promise<Buffer> {
  return pbkdf2Async(masterKey, salt, ITERATIONS, KEY_LENGTH, "sha512");
}

/**
 * Encrypt a buffer (file contents) using AES-256-GCM
 *
 * @param data - The data to encrypt (e.g., file buffer)
 * @returns Encrypted data with IV, salt, and auth tag prepended
 */
export async function encryptData(data: Buffer): Promise<Buffer> {
  const masterKey = getEncryptionKey();

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive key from master key
  const key = await deriveKey(masterKey, salt);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt data
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

  // Get auth tag
  const tag = cipher.getAuthTag();

  // Combine: salt + iv + tag + encrypted data
  return Buffer.concat([salt, iv, tag, encrypted]);
}

/**
 * Decrypt data encrypted with encryptData
 *
 * @param encryptedData - The encrypted data with salt, IV, and tag prepended
 * @returns Decrypted data
 */
export async function decryptData(encryptedData: Buffer): Promise<Buffer> {
  // Guard against excessively large buffers (100MB)
  const MAX_DECRYPT_SIZE = 100 * 1024 * 1024;
  if (encryptedData.length > MAX_DECRYPT_SIZE) {
    throw new Error(
      `Encrypted data exceeds maximum size: ${encryptedData.length} bytes (max ${MAX_DECRYPT_SIZE})`
    );
  }

  const minLength = SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1;
  if (encryptedData.length < minLength) {
    throw new Error(
      `Encrypted data too short: expected at least ${minLength} bytes, got ${encryptedData.length}`
    );
  }

  const masterKey = getEncryptionKey();

  // Extract components
  const salt = encryptedData.subarray(0, SALT_LENGTH);
  const iv = encryptedData.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = encryptedData.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = encryptedData.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  // Derive key
  const key = await deriveKey(masterKey, salt);

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  // Decrypt data
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Encrypt a file for KYC storage
 *
 * @param file - File object or Blob
 * @returns Encrypted buffer ready for upload
 */
export async function encryptFile(file: File | Blob): Promise<Buffer> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return encryptData(buffer);
}

/**
 * Decrypt a file from KYC storage
 *
 * @param encryptedBuffer - Encrypted file buffer
 * @returns Decrypted buffer
 */
export async function decryptFile(encryptedBuffer: Buffer): Promise<Buffer> {
  return decryptData(encryptedBuffer);
}

/**
 * Generate a new encryption key (for initial setup)
 * Run this once and store the result as KYC_ENCRYPTION_KEY env var
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString("hex");
}
