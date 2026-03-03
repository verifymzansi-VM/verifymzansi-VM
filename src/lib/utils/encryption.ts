import crypto from "crypto";
import { promisify } from "util";

/**
 * KYC Document Encryption Utilities
 *
 * Uses AES-256-GCM for encrypting sensitive KYC documents before storage.
 * This is required for POPIA compliance in South Africa.
 *
 * ## Key derivation strategy
 *
 * **v2 (current):** HMAC-SHA256 (HKDF-Extract equivalent). The master key
 * is already 256 bits of cryptographic randomness so expensive password-
 * stretching (PBKDF2) is unnecessary and causes Cloudflare Workers CPU
 * timeouts. HMAC-SHA256 with a random salt gives a unique-per-file 256-bit
 * key in <1 ms.
 *
 * **v1 (legacy):** PBKDF2-SHA512 with 600 000 iterations.  Retained in the
 * decrypt path so any files encrypted with the old scheme can still be read.
 * The kyc-encryptor worker used 100 000 iterations — also supported.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // NIST-recommended 12 bytes for AES-GCM
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** Magic byte prepended to v2 ciphertext so we can distinguish formats. */
const V2_MAGIC = 0x02;

// Legacy PBKDF2 parameters — only used for decrypting old data.
const LEGACY_ITERATIONS_V1 = 600000;
const LEGACY_ITERATIONS_WORKER = 100000;

const pbkdf2Async = promisify(crypto.pbkdf2);

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

/**
 * Derive a per-file encryption key using HMAC-SHA256 (HKDF-Extract).
 *
 * This is the v2 key derivation — fast and safe because the master key is
 * already high-entropy (256-bit random). The random salt ensures every file
 * gets a unique derived key even with the same master key.
 */
function deriveKeyV2(masterKey: Buffer, salt: Buffer): Buffer {
  return crypto.createHmac("sha256", salt).update(masterKey).digest();
}

/**
 * Legacy key derivation via PBKDF2 — only for decrypting old v1 data.
 */
async function deriveKeyLegacy(
  masterKey: Buffer,
  salt: Buffer,
  iterations: number
): Promise<Buffer> {
  return pbkdf2Async(masterKey, salt, iterations, KEY_LENGTH, "sha512");
}

/**
 * Encrypt a buffer (file contents) using AES-256-GCM
 *
 * v2 format: [0x02 magic][64-byte salt][12-byte IV][16-byte tag][ciphertext]
 *
 * @param data - The data to encrypt (e.g., file buffer)
 * @returns Encrypted data with version byte, salt, IV, and auth tag prepended
 */
export async function encryptData(data: Buffer): Promise<Buffer> {
  const masterKey = getEncryptionKey();

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive per-file key via HMAC-SHA256 (instant, no CPU spike)
  const key = deriveKeyV2(masterKey, salt);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt data
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

  // Get auth tag
  const tag = cipher.getAuthTag();

  // Combine: version(1) + salt(64) + iv(12) + tag(16) + encrypted data
  return Buffer.concat([Buffer.from([V2_MAGIC]), salt, iv, tag, encrypted]);
}

/**
 * Decrypt data encrypted with encryptData (supports both v1 and v2 formats)
 *
 * @param encryptedData - The encrypted data
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

  const isV2 = encryptedData[0] === V2_MAGIC;

  if (isV2) {
    return decryptV2(encryptedData);
  }

  // Legacy v1 format — try 600k iterations first, then 100k (worker variant)
  return decryptLegacy(encryptedData);
}

/**
 * Decrypt v2-format data (HMAC-SHA256 derived key)
 */
function decryptV2(encryptedData: Buffer): Buffer {
  // v2 layout: [1 magic][64 salt][12 iv][16 tag][ciphertext]
  const minLength = 1 + SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1;
  if (encryptedData.length < minLength) {
    throw new Error(
      `Encrypted data too short: expected at least ${minLength} bytes, got ${encryptedData.length}`
    );
  }

  const masterKey = getEncryptionKey();

  let offset = 1; // skip magic byte
  const salt = encryptedData.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const iv = encryptedData.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;
  const tag = encryptedData.subarray(offset, offset + TAG_LENGTH);
  offset += TAG_LENGTH;
  const encrypted = encryptedData.subarray(offset);

  const key = deriveKeyV2(masterKey, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Decrypt legacy v1-format data (PBKDF2 derived key).
 * Tries 600k iterations first (main app), then 100k (kyc-encryptor worker).
 */
async function decryptLegacy(encryptedData: Buffer): Promise<Buffer> {
  const minLength = SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1;
  if (encryptedData.length < minLength) {
    throw new Error(
      `Encrypted data too short: expected at least ${minLength} bytes, got ${encryptedData.length}`
    );
  }

  const masterKey = getEncryptionKey();

  const salt = encryptedData.subarray(0, SALT_LENGTH);
  const iv = encryptedData.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = encryptedData.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = encryptedData.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  // Try primary iteration count first (600k — main app v1)
  try {
    const key = await deriveKeyLegacy(masterKey, salt, LEGACY_ITERATIONS_V1);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    // Fall through to worker iteration count
  }

  // Try worker iteration count (100k — kyc-encryptor worker)
  const key = await deriveKeyLegacy(masterKey, salt, LEGACY_ITERATIONS_WORKER);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
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
