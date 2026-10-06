import crypto from "crypto";

import { env } from "@/lib/config/env";

const ZERO_KEY = "0".repeat(64);
const CAFEBABE_PLACEHOLDER = "cafebabe".repeat(8);

/**
 * The HMAC key for SA ID numbers, or null when it is missing or a known
 * placeholder. KYC (`id_number_hmac`) and CIPC director matching must use the
 * same key and input so the hashes compare equal.
 */
export function getIdNumberHmacSecret(): string | null {
  const secret = env("HMAC_SECRET");
  if (!secret || secret === ZERO_KEY || secret === CAFEBABE_PLACEHOLDER) return null;
  if (secret.length === 64 && new Set(secret).size < 8) return null;
  return secret;
}

/** HMAC-SHA256 of a 13-digit SA ID number, exactly as stored on verification_steps. */
export function hmacIdNumber(idNumber: string, secret: string): string {
  return crypto.createHmac("sha256", Buffer.from(secret, "hex")).update(idNumber).digest("hex");
}
