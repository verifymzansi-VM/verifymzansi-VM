import { z } from "zod";
import { storedSaBusinessContactNumberSchema } from "./business-contact-number";

export const BUSINESS_CONTACT_OTP_PROTOCOL = "business-contact-otp-hmac-sha256-v1" as const;
const keyId = z.string().regex(/^business-contact-otp-v[1-9][0-9]{0,3}$/);
const uuid = z.uuid().transform((value) => value.toLowerCase());
const contextSchema = z.strictObject({
  owner_id: uuid,
  root_post_id: uuid,
  challenge_id: uuid,
  number: storedSaBusinessContactNumberSchema,
  method: z.enum(["sms_otp", "voice_otp"]),
});
const digestSchema = z.strictObject({
  protocol: z.literal(BUSINESS_CONTACT_OTP_PROTOCOL),
  key_id: keyId,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
const configuration = z.strictObject({
  key_id: keyId,
  key_hex: z.string().regex(/^[a-f0-9]{64}$/),
});
type Context = z.infer<typeof contextSchema>;
export type BusinessContactOtpDigest = z.infer<typeof digestSchema>;

function bytesFromHex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g)!, (pair) => Number.parseInt(pair, 16));
}
function context(value: unknown): Context {
  const parsed = contextSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid business contact challenge context");
  return parsed.data;
}
function message(subject: Context, id: string, code: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([
      BUSINESS_CONTACT_OTP_PROTOCOL,
      id,
      "business-contact-number-control",
      subject.owner_id,
      subject.root_post_id,
      subject.number,
      subject.challenge_id,
      subject.method,
      code,
    ])
  );
}

/** Trusted adapter primitive only. Supply a distinct, server-owned CSPRNG key;
 * never reuse identity/account-phone keys or expose this codec/key to a client.
 * The adapter must derive context from current authorized SQL state.
 *
 * A matching digest is not a proof grant. SQL must separately enforce expiry,
 * current owner/account/selection, leased attempts, send budgets, consumed/revoked
 * state and closure serialization. Neither SMS nor voice proves WhatsApp
 * registration or exclusive business ownership. This code sends no message.
 */
export async function createBusinessContactOtpCodec(input: unknown) {
  const parsed = configuration.safeParse(input);
  if (!parsed.success) throw new Error("Valid business contact OTP key required");
  const config = parsed.data;
  const key = await crypto.subtle.importKey(
    "raw",
    bytesFromHex(config.key_hex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  return Object.freeze({
    /** The code is ephemeral delivery material for the trusted sender only.
     * Persist only the digest; never log or return the code to the member.
     * Any durable delivery payload requires its own reviewed encryption protocol.
     */
    async create(value: unknown): Promise<{ code: string; digest: BusinessContactOtpDigest }> {
      const subject = context(value);
      // Rejection sampling avoids modulo bias and preserves leading zeroes.
      const range = 1_000_000;
      const limit = Math.floor(2 ** 32 / range) * range;
      for (let attempt = 0; attempt < 8; attempt++) {
        const sample = crypto.getRandomValues(new Uint32Array(1))[0];
        if (sample >= limit) continue;
        const code = String(sample % range).padStart(6, "0");
        const signed = await crypto.subtle.sign("HMAC", key, message(subject, config.key_id, code));
        return {
          code,
          digest: {
            protocol: BUSINESS_CONTACT_OTP_PROTOCOL,
            key_id: config.key_id,
            hash: Array.from(new Uint8Array(signed), (byte) =>
              byte.toString(16).padStart(2, "0")
            ).join(""),
          },
        };
      }
      throw new Error("Business contact challenge generation unavailable");
    },
    async matches(value: unknown, code: unknown, digest: unknown): Promise<boolean> {
      const subject = context(value);
      const stored = digestSchema.safeParse(digest);
      if (
        typeof code !== "string" ||
        !/^[0-9]{6}$/.test(code) ||
        !stored.success ||
        stored.data.key_id !== config.key_id
      )
        return false;
      return crypto.subtle.verify(
        "HMAC",
        key,
        bytesFromHex(stored.data.hash),
        message(subject, config.key_id, code)
      );
    },
  });
}
