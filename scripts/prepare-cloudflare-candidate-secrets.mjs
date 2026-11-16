import { writeFile } from "node:fs/promises";
import path from "node:path";

// Additive scoped secrets only. Omitted provider, encryption, HMAC, R2 and
// provider secrets must be inherited from the current Worker version. Activate
// the limiter's bounded overlap before directing requests to this new key.
if (process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP)
  throw new Error("Candidate secret preparation requires an isolated Actions runner");
const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== "--include-workers"))
  throw new Error("Unsupported secret preparation argument");
const names = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "FOUNDATION_SUPABASE_SECRET_KEY",
  "FOUNDATION_PHONE_OTP_KEY",
  "INTERNAL_JOBS_SECRET",
  "OPS_JOBS_SECRET",
  "KYC_WEBHOOK_SECRET",
  "TURNSTILE_SECRET_KEY",
  "HEALTH_DIAGNOSTIC_TOKEN",
  "RATE_LIMITER_API_KEY",
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
if (args.includes("--include-workers")) {
  const monitorKey = process.env.SITE_MONITOR_API_KEY;
  if (!monitorKey || monitorKey.length < 32 || monitorKey !== monitorKey.trim())
    throw new Error("Site monitor credential is missing or malformed");
  for (const name of ["INTERNAL_JOBS_SECRET", "RATE_LIMITER_API_KEY", "OPS_JOBS_SECRET"])
    if (values[name].length < 32) throw new Error("Worker shared credential is too short");
  for (const [file, secrets] of [
    [
      "cloudflare-cleanup-secrets.json",
      {
        WORKER_API_KEY: values.INTERNAL_JOBS_SECRET, // secret-scan: allow runtime reference, no credential literal
      },
    ],
    [
      "cloudflare-limiter-secrets.json",
      {
        WORKER_API_KEY: values.RATE_LIMITER_API_KEY, // secret-scan: allow runtime reference, no credential literal
      },
    ],
    ["cloudflare-ops-secrets.json", { OPS_JOBS_SECRET: values.OPS_JOBS_SECRET }],
    ["cloudflare-monitor-secrets.json", { MONITOR_API_KEY: monitorKey }],
  ])
    await writeFile(path.join(process.env.RUNNER_TEMP, file), JSON.stringify(secrets), {
      mode: 0o600,
      flag: "wx",
    });
}
console.log("Scoped candidate bindings prepared outside the checkout. No master keys changed.");
