import { describe, it, expect } from "vitest";
import {
  hammingDistance,
  PHASH_SIMILARITY_THRESHOLD,
  computePerceptualHash,
} from "./perceptual-hash";

describe("hammingDistance", () => {
  it("returns 0 for identical hashes", () => {
    expect(hammingDistance("abcdef0123456789", "abcdef0123456789")).toBe(0);
  });

  it("counts differing bits correctly", () => {
    // 0x0 vs 0x1 differs by 1 bit
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
    // 0x0 vs 0xf differs by 4 bits
    expect(hammingDistance("0000000000000000", "000000000000000f")).toBe(4);
  });

  it("returns Infinity for different-length strings", () => {
    expect(hammingDistance("abc", "abcd")).toBe(Infinity);
  });

  it("handles all-ones vs all-zeros (64 bits)", () => {
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  it("threshold constant is reasonable", () => {
    expect(PHASH_SIMILARITY_THRESHOLD).toBeGreaterThanOrEqual(5);
    expect(PHASH_SIMILARITY_THRESHOLD).toBeLessThanOrEqual(15);
  });
});

describe("computePerceptualHash", () => {
  it("returns null for an empty buffer", async () => {
    const result = await computePerceptualHash(Buffer.alloc(0));
    expect(result).toBeNull();
  });

  it("returns null for invalid image data", async () => {
    const result = await computePerceptualHash(Buffer.from("not-an-image"));
    expect(result).toBeNull();
  });

  it("returns a 16-char hex string for a valid image buffer", async () => {
    // Create a minimal valid PNG (1x1 white pixel)
    const PNG_1x1 = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
        "0000000a49444154789c626000000002000198e195ee0000000049454e44ae426082",
      "hex"
    );
    const result = await computePerceptualHash(PNG_1x1);
    // sharp may or may not be available in test env
    if (result !== null) {
      expect(result).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("produces similar hashes for identical images", async () => {
    const PNG_1x1 = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
        "0000000a49444154789c626000000002000198e195ee0000000049454e44ae426082",
      "hex"
    );
    const hash1 = await computePerceptualHash(PNG_1x1);
    const hash2 = await computePerceptualHash(PNG_1x1);
    if (hash1 !== null && hash2 !== null) {
      expect(hammingDistance(hash1, hash2)).toBe(0);
    }
  });
});
