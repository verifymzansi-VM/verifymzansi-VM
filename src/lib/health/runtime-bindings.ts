import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Fixed names prevent this operator-only check becoming an environment reader.
export const runtimeBindingNames = [
  "FOUNDATION_SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TURNSTILE_SECRET_KEY",
  "FOUNDATION_PHONE_OTP_KEY",
  "RATE_LIMITER_API_KEY",
  "OPS_JOBS_SECRET",
  "INTERNAL_JOBS_SECRET",
  "KYC_WEBHOOK_SECRET",
  "KYC_ENCRYPTION_KEY",
  "ID_ENCRYPTION_KEY",
  "HMAC_SECRET",
  "IP_HASH_SECRET",
  "RESEND_API_KEY",
  "AFRICASTALKING_API_KEY",
  "AFRICASTALKING_USERNAME",
  "AFRICASTALKING_SENDER_ID",
  "OZOW_ENV",
  "OZOW_CLIENT_ID",
  "OZOW_CLIENT_SECRET",
  "OZOW_SITE_CODE",
  "OZOW_WEBHOOK_SECRET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;
const requestSchema = z
  .strictObject({
    expected: z.partialRecord(z.enum(runtimeBindingNames), z.string().regex(/^[a-f0-9]{64}$/)),
  })
  .refine((value) => Object.keys(value.expected).length > 0);

export function hasRuntimeDiagnosticAccess(header: string | null, expected: unknown) {
  if (typeof expected !== "string" || expected.length < 32 || !header?.startsWith("Bearer "))
    return false;
  const provided = Buffer.from(header.slice(7));
  const actual = Buffer.from(expected);
  return actual.length === provided.length && timingSafeEqual(actual, provided);
}

/** Compare caller-known hashes without returning values, hashes or exceptions
 * from bindings. Only the dedicated operator diagnostic credential can call it. */
export function verifyRuntimeBindings(
  environment: Readonly<Record<string, unknown>>,
  input: unknown
) {
  const { expected } = requestSchema.parse(input);
  const checks = Object.fromEntries(
    Object.entries(expected).map(([name, digest]) => {
      const value = environment[name];
      const present = typeof value === "string" && value.length > 0;
      const actual = createHash("sha256")
        .update(present ? value : "")
        .digest();
      return [
        name,
        { present, matches: present && timingSafeEqual(actual, Buffer.from(digest, "hex")) },
      ];
    })
  );
  return { ok: Object.values(checks).every((value) => value.matches), checks };
}
