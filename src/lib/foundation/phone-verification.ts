import "server-only";

import { z } from "zod";
import type { FoundationServiceApi } from "./service-api";
import { sendOtpSms } from "../services/sms";
import {
  foundationPhoneSendSchema,
  foundationPhoneVerifySchema,
  foundationPhoneChallengeSchema,
} from "./phone-verification-input";
const claimed = z.strictObject({
  challenge_id: z.uuid(),
  phone: z.string().regex(/^\+27[6-8][0-9]{8}$/),
  otp_hash: z.string().regex(/^v1\.[0-9a-f]{32}\.[0-9a-f]{64}$/),
});
const proof = z.strictObject({
  verified: z.literal(true),
  reused: z.boolean(),
  proof_id: z.uuid(),
});

export class FoundationPhoneError extends Error {
  constructor(readonly status: 400 | 403 | 409 | 429 | 503) {
    super("Phone verification could not be completed");
  }
}
const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
const hexToBytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g)!, (value) => Number.parseInt(value, 16));
type PhoneEnvironment = Readonly<Record<string, string | undefined>>;
async function otpKey(environment: PhoneEnvironment) {
  const raw = environment.FOUNDATION_PHONE_OTP_KEY;
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw) || new Set(raw.toLowerCase()).size < 8)
    throw new FoundationPhoneError(503);
  return crypto.subtle.importKey("raw", hexToBytes(raw), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}
function generateCode() {
  const value = new Uint32Array(1);
  // Rejection sampling keeps all one million codes equally likely.
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= 4294000000);
  return String(value[0] % 1000000).padStart(6, "0");
}
const message = (owner: string, phone: string, nonce: string, code: string) =>
  new TextEncoder().encode([owner, phone, nonce, code].join("\0"));
function failed(error: { code?: string }) {
  throw new FoundationPhoneError(
    error.code === "42501"
      ? 403
      : error.code === "PT409" || error.code === "23505"
        ? 409
        : error.code === "22023"
          ? 400
          : 503
  );
}

/** Caller id comes only from the verified server account context. No code,
 * stored digest or recipient is ever returned to the browser. The separate
 * random key stays outside the database; a copied DB digest cannot test codes.
 * Delivery is attempted once. A failure never retries the SMS implicitly. */
export async function issueFoundationPhoneChallenge(
  api: FoundationServiceApi,
  owner: string,
  input: unknown,
  environment: PhoneEnvironment = process.env,
  deliver: (phone: string, code: string) => Promise<{ success: boolean }> = sendOtpSms
) {
  const parsed = foundationPhoneSendSchema.safeParse(input);
  if (!z.uuid().safeParse(owner).success || !parsed.success) throw new FoundationPhoneError(400);
  const key = await otpKey(environment);
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const code = generateCode();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    message(owner, parsed.data.phone, nonce, code)
  );
  const hash = `v1.${nonce}.${bytesToHex(new Uint8Array(signature))}`;
  const result = await api.rpc("create_verification_phone_challenge", {
    p_owner: owner,
    p_phone: parsed.data.phone,
    p_hash: hash,
  });
  if (result.error) failed(result.error);
  const created = foundationPhoneChallengeSchema.safeParse(result.data);
  if (!created.success) throw new FoundationPhoneError(503);
  try {
    if (!(await deliver(parsed.data.phone, code)).success) throw new Error();
  } catch {
    throw new FoundationPhoneError(503);
  }
  return created.data;
}

export async function verifyFoundationPhoneChallenge(
  api: FoundationServiceApi,
  owner: string,
  input: unknown,
  environment: PhoneEnvironment = process.env
) {
  const parsed = foundationPhoneVerifySchema.safeParse(input);
  if (!z.uuid().safeParse(owner).success || !parsed.success) throw new FoundationPhoneError(400);
  const key = await otpKey(environment);
  // SQL increments the bounded attempt count atomically before any comparison.
  const result = await api.rpc("claim_verification_phone_attempt", {
    p_owner: owner,
    p_challenge: parsed.data.challenge_id,
  });
  if (result.error) failed(result.error);
  const current = claimed.safeParse(result.data);
  if (!current.success || current.data.challenge_id !== parsed.data.challenge_id)
    throw new FoundationPhoneError(503);
  const [, nonce, signature] = current.data.otp_hash.split(".");
  const matches = await crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(signature),
    message(owner, current.data.phone, nonce, parsed.data.code)
  );
  if (!matches) throw new FoundationPhoneError(400);
  const finalized = await api.rpc("finalize_verification_phone", {
    p_owner: owner,
    p_challenge: parsed.data.challenge_id,
    p_expected_hash: current.data.otp_hash,
  });
  if (finalized.error) failed(finalized.error);
  if (!proof.safeParse(finalized.data).success) throw new FoundationPhoneError(503);
  return { verified: true as const };
}
