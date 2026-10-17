import { createDecipheriv, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { validateSaIdChecksum } from "@/lib/utils/sa-id-validation";
import { processIdentityNumber, type IdentityProcessingKeys } from "./identity-processing";
import { fingerprintToSourceIdentityDigest } from "./identity-fingerprint";

const owner = "27b29d4b-799c-4fb2-a148-fcb3c73fa617";
const other = "25ad43dc-f577-4072-a9d2-a493a187245b";
const syntheticId = "8001015009087";
const keys: IdentityProcessingKeys = {
  identityMatchKey: "0123456789abcdef".repeat(4),
  numberEncryptionKey: "fedcba9876543210".repeat(4),
  identityKeyId: "identity-match-v1",
  encryptionKeyId: "identity-number-v1",
};
function decrypt(result: ReturnType<typeof processIdentityNumber>, subject = owner) {
  const value = result.encryptedNumber;
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keys.numberEncryptionKey, "hex"),
    Buffer.from(value.iv, "hex")
  );
  cipher.setAAD(Buffer.from(`${subject}:id_doc`));
  cipher.setAuthTag(Buffer.from(value.tag, "hex"));
  return Buffer.concat([
    cipher.update(Buffer.from(value.ciphertext, "hex")),
    cipher.final(),
  ]).toString("utf8");
}
describe("bound identity processing", () => {
  it("rejects a checksum-valid underage identity", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-16T00:00:00Z"));
      const prefix = "200101500908";
      const valid = Array.from({ length: 10 }, (_, digit) => prefix + digit).find(
        validateSaIdChecksum
      );
      expect(valid).toBeDefined();
      expect(validateSaIdChecksum(valid!)).toBe(true);
      expect(() => processIdentityNumber(owner, valid!, keys)).toThrow(/adult/);
    } finally {
      vi.useRealTimers();
    }
  });
  it("derives the same source/CIPC HMAC bytes and encrypts the exact input", () => {
    const result = processIdentityNumber(owner, syntheticId, keys);
    expect(fingerprintToSourceIdentityDigest(result.fingerprint)).toBe(
      createHmac("sha256", Buffer.from(keys.identityMatchKey, "hex"))
        .update(syntheticId)
        .digest("hex")
    );
    expect(decrypt(result)).toBe(syntheticId);
    expect(JSON.stringify(result)).not.toContain(syntheticId);
  });
  it("cannot transplant the encrypted number to another subject or alter authenticated bytes", () => {
    const result = processIdentityNumber(owner, syntheticId, keys);
    expect(() => decrypt(result, other)).toThrow();
    const changed = structuredClone(result);
    changed.encryptedNumber.ciphertext =
      (changed.encryptedNumber.ciphertext[0] === "0" ? "1" : "0") +
      changed.encryptedNumber.ciphertext.slice(1);
    expect(() => decrypt(changed)).toThrow();
  });
  it("uses fresh nonces without changing the stable matching digest", () => {
    const a = processIdentityNumber(owner, syntheticId, keys),
      b = processIdentityNumber(owner, syntheticId, keys);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.encryptedNumber.iv).not.toBe(b.encryptedNumber.iv);
    expect(a.encryptedNumber.ciphertext).not.toBe(b.encryptedNumber.ciphertext);
  });
  it.each([
    "",
    "0000000000000",
    syntheticId.slice(0, -1) + "0",
    " " + syntheticId,
    "８００１０１５００９０８７",
    "2601015009080",
  ])("rejects invalid, noncanonical or underage input %#", (input) => {
    expect(() => processIdentityNumber(owner, input, keys)).toThrow();
  });
  it.each([
    "",
    "0".repeat(64),
    "cafebabe".repeat(8),
    "g".repeat(64),
    "ABCDEF0123456789".repeat(4),
    "1a".repeat(31),
  ])("rejects missing/placeholder/malformed key %#", (key) => {
    expect(() =>
      processIdentityNumber(owner, syntheticId, { ...keys, identityMatchKey: key })
    ).toThrow();
  });
  it("rejects shared encryption/matching keys and unsupported protocols", () => {
    expect(() =>
      processIdentityNumber(owner, syntheticId, {
        ...keys,
        numberEncryptionKey: keys.identityMatchKey,
      })
    ).toThrow();
    expect(() =>
      processIdentityNumber(owner, syntheticId, {
        ...keys,
        identityKeyId: "other",
      } as unknown as IdentityProcessingKeys)
    ).toThrow();
    expect(() => processIdentityNumber("invalid", syntheticId, keys)).toThrow();
  });
});
