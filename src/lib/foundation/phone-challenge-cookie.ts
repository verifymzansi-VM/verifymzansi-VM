import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { FoundationPhoneError } from "./phone-verification";

export const FOUNDATION_PHONE_CHALLENGE_COOKIE = "vm_foundation_phone_challenge";
export const FOUNDATION_PHONE_CHALLENGE_PATH = "/api/otp";
const proof = z.strictObject({
  owner: z.uuid(),
  phone: z.string().regex(/^\+27[6-8][0-9]{8}$/),
  challenge_id: z.uuid(),
  expires_at: z.number().int().positive(),
});
function signature(payload: string) {
  const key = process.env.FOUNDATION_PHONE_OTP_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key) || new Set(key.toLowerCase()).size < 8)
    throw new FoundationPhoneError(503);
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(`restored-phone-challenge:${payload}`)
    .digest();
}
export function sealPhoneChallenge(
  owner: string,
  phone: string,
  challenge_id: string,
  expires: string
) {
  const expires_at = Math.min(Date.parse(expires), Date.now() + 300_000);
  const value = proof.safeParse({ owner, phone, challenge_id, expires_at });
  if (!value.success || expires_at <= Date.now()) throw new FoundationPhoneError(503);
  const payload = Buffer.from(JSON.stringify(value.data)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function readPhoneChallenge(cookie: string | undefined, owner: string, phone: string) {
  if (!cookie || cookie.length > 1024) throw new FoundationPhoneError(400);
  const parts = cookie.split(".");
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[1])
  )
    throw new FoundationPhoneError(400);
  const supplied = Buffer.from(parts[1], "base64url");
  const expected = signature(parts[0]);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new FoundationPhoneError(400);
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  } catch {
    throw new FoundationPhoneError(400);
  }
  const value = proof.safeParse(decoded);
  if (
    !value.success ||
    value.data.owner !== owner ||
    value.data.phone !== phone ||
    value.data.expires_at <= Date.now()
  )
    throw new FoundationPhoneError(400);
  return value.data.challenge_id;
}
