import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  encryptData,
  decryptData,
  encryptFile,
  decryptFile,
  generateEncryptionKey,
} from "./encryption";
import { _resetEnvCacheForTesting } from "@/lib/config/env";

// A valid 64-char hex key (32 bytes)
const TEST_KEY = "a".repeat(64);

describe("encryption", () => {
  beforeEach(() => {
    vi.stubEnv("KYC_ENCRYPTION_KEY", TEST_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetEnvCacheForTesting();
  });

  describe("generateEncryptionKey", () => {
    it("generates a 64-character hex key", () => {
      const key = generateEncryptionKey();
      expect(key).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
    });

    it("generates unique keys", () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe("encryptData / decryptData", () => {
    it("round-trips data successfully", async () => {
      const plaintext = Buffer.from("Hello VerifyMzansi!");
      const encrypted = await encryptData(plaintext);
      const decrypted = await decryptData(encrypted);

      expect(decrypted.toString()).toBe("Hello VerifyMzansi!");
    });

    it("produces different ciphertext each time (random IV/salt)", async () => {
      const plaintext = Buffer.from("Same data");
      const enc1 = await encryptData(plaintext);
      const enc2 = await encryptData(plaintext);

      expect(enc1.equals(enc2)).toBe(false);
    });

    it("encrypted output is larger than input (magic + salt + IV + tag overhead)", async () => {
      const plaintext = Buffer.from("Short");
      const encrypted = await encryptData(plaintext);

      // v2: magic(1) + salt(64) + iv(12) + tag(16) + encrypted data = 93 bytes overhead
      expect(encrypted.length).toBeGreaterThanOrEqual(plaintext.length + 93);
    });

    it("v2 ciphertext starts with 0x02 magic byte", async () => {
      const plaintext = Buffer.from("version check");
      const encrypted = await encryptData(plaintext);

      expect(encrypted[0]).toBe(0x02);
    });

    it("throws with tampered ciphertext", async () => {
      const plaintext = Buffer.from("Critical data");
      const encrypted = await encryptData(plaintext);

      // Flip a byte in the encrypted portion
      encrypted[encrypted.length - 1] ^= 0xff;

      await expect(decryptData(encrypted)).rejects.toThrow();
    });
  });

  describe("encryptFile / decryptFile", () => {
    it("round-trips a file (Blob)", async () => {
      const content = "File content for KYC document testing";
      const blob = new Blob([content], { type: "application/pdf" });

      const encrypted = await encryptFile(blob as unknown as File);
      const decrypted = await decryptFile(encrypted);

      expect(decrypted.toString()).toBe(content);
    });
  });

  describe("error cases", () => {
    beforeEach(() => {
      // Clear cached env so the next env() call re-validates.
      _resetEnvCacheForTesting();
      // Disable CI flag so validateEnv() uses the strict path instead of
      // the lenient CI path that supplies valid fallback defaults.
      vi.stubEnv("CI", "");
    });

    it("throws when KYC_ENCRYPTION_KEY is not set", async () => {
      vi.stubEnv("KYC_ENCRYPTION_KEY", "");

      await expect(encryptData(Buffer.from("test"))).rejects.toThrow("KYC_ENCRYPTION_KEY");
    });

    it("throws when key is wrong length", async () => {
      vi.stubEnv("KYC_ENCRYPTION_KEY", "abcd");

      await expect(encryptData(Buffer.from("test"))).rejects.toThrow("hex characters");
    });
  });
});
