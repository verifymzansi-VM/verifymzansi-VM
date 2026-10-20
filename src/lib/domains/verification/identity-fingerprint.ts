/** Codec only: a well-formed digest is not proof of a reviewed identity. */
declare const identityFingerprint: unique symbol;
export type IdentityFingerprint = string & { readonly [identityFingerprint]: true };

export function parseIdentityFingerprint(value: unknown): IdentityFingerprint {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("Invalid identity fingerprint encoding");
  }
  const bytes = Buffer.from(value, "base64url");
  // Node's decoder accepts aliases with nonzero unused trailing bits.
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
    throw new Error("Noncanonical identity fingerprint encoding");
  }
  return value as IdentityFingerprint;
}

/** Preserve the digest bytes used by source KYC and CIPC matching. */
export function sourceIdentityDigestToFingerprint(value: unknown): IdentityFingerprint {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Invalid source identity digest encoding");
  }
  return parseIdentityFingerprint(Buffer.from(value, "hex").toString("base64url"));
}

export function fingerprintToSourceIdentityDigest(value: unknown): string {
  return Buffer.from(parseIdentityFingerprint(value), "base64url").toString("hex");
}
