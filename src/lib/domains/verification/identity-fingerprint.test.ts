import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  fingerprintToSourceIdentityDigest,
  parseIdentityFingerprint,
  sourceIdentityDigestToFingerprint,
} from "./identity-fingerprint";

describe("identity fingerprint wire protocol", () => {
  it("preserves a known SHA256 digest rather than hashing its hexadecimal text", () => {
    // Public deterministic test vector, not a stored account fingerprint/key.
    const hex = createHmac("sha256", "key")
      .update("The quick brown fox jumps over the lazy dog")
      .digest("hex");
    const encoded = "97yD9DBThCSxMpjmqm-xQ-9NWaFJRhdZl0edvC0aPNg";
    expect(sourceIdentityDigestToFingerprint(hex)).toBe(encoded);
    expect(fingerprintToSourceIdentityDigest(encoded)).toBe(hex);
  });

  it("round trips all final byte values without changing the digest", () => {
    for (let last = 0; last < 256; last++) {
      const hex = "5a".repeat(31) + last.toString(16).padStart(2, "0");
      expect(fingerprintToSourceIdentityDigest(sourceIdentityDigestToFingerprint(hex))).toBe(hex);
    }
  });

  it("rejects every trailing-bit alias even when the platform decoder accepts it", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let nibble = 0; nibble < 16; nibble++) {
      const canonical = "A".repeat(42) + alphabet[nibble * 4];
      expect(parseIdentityFingerprint(canonical)).toBe(canonical);
      for (let unused = 1; unused < 4; unused++) {
        const alias = canonical.slice(0, -1) + alphabet[nibble * 4 + unused];
        expect(Buffer.from(alias, "base64url")).toEqual(Buffer.from(canonical, "base64url"));
        expect(() => parseIdentityFingerprint(alias)).toThrow(/Noncanonical/);
      }
    }
  });

  it.each([
    null,
    undefined,
    0,
    {},
    "",
    "0".repeat(63),
    "0".repeat(65),
    "A".repeat(64),
    "g".repeat(64),
    "  " + "0".repeat(64),
    "０".repeat(64),
  ])("rejects malformed or noncanonical source representation %#", (value) =>
    expect(() => sourceIdentityDigestToFingerprint(value)).toThrow()
  );

  it.each([
    null,
    undefined,
    0,
    {},
    "",
    "A".repeat(42),
    "A".repeat(44),
    "A".repeat(43) + "=",
    "+" + "A".repeat(42),
    "/" + "A".repeat(42),
    "Ａ".repeat(43),
    "A".repeat(42) + "\n",
  ])("rejects malformed target representation %#", (value) =>
    expect(() => parseIdentityFingerprint(value)).toThrow()
  );
});
