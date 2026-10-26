import { writeFile } from "node:fs/promises";
import path from "node:path";

// Additive scoped secrets only. Omitted provider, encryption, HMAC, R2 and
// rate-limiter secrets must be inherited from the current Worker version.
// In particular, do not rotate the live limiter before coordinated rollout.
if (process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP)
  throw new Error("Candidate secret preparation requires an isolated Actions runner");
const names = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "FOUNDATION_SUPABASE_SECRET_KEY",
  "FOUNDATION_PHONE_OTP_KEY",
  "INTERNAL_JOBS_SECRET",
  "OPS_JOBS_SECRET",
  "KYC_WEBHOOK_SECRET",
  "TURNSTILE_SECRET_KEY",
  "HEALTH_DIAGNOSTIC_TOKEN",
];
const values = {};
for (const name of names) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length < 20 || value !== value.trim())
    throw new Error(`Missing or malformed candidate binding: ${name}`);
  values[name] = value;
}
if (values.SUPABASE_SERVICE_ROLE_KEY !== values.FOUNDATION_SUPABASE_SECRET_KEY)
  throw new Error("Candidate Supabase aliases differ");
if (values.HEALTH_DIAGNOSTIC_TOKEN.length < 32)
  throw new Error("Candidate diagnostic credential is too short");
await writeFile(
  path.join(process.env.RUNNER_TEMP, "cloudflare-candidate-secrets.json"),
  JSON.stringify(values),
  { mode: 0o600, flag: "wx" }
);
console.log("Scoped candidate bindings prepared outside the checkout. No master keys changed.");
