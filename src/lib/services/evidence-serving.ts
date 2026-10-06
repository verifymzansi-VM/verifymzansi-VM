import crypto from "crypto";

/** Evidence formats accepted at upload, identified by their magic bytes. */
export function detectEvidenceContentType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

/**
 * Hash an IP address for privacy-compliant logging.
 * Uses HMAC-SHA256 with a secret key to prevent rainbow-table deanonymisation.
 */
export function hashIp(ip: string, secret: string | undefined): string {
  // In production, IP_HASH_SECRET is required (checked earlier in handler).
  // In dev, use a deterministic but non-production-safe fallback.
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("IP_HASH_SECRET is required in production");
  }
  const key = secret || "dev-only-local-not-for-production";
  return crypto.createHmac("sha256", key).update(ip).digest("hex").slice(0, 16);
}
