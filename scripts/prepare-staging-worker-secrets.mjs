import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Staging copy (M0.15b): every staging Worker secret comes from the GitHub
// environment "staging" as STAGING_<NAME> and is deployed atomically with the
// staging Worker (`--secrets-file`), so nothing is set by hand on Cloudflare
// and no value can come from production. This checks that each one is present
// and well formed before anything is deployed, and writes two files outside
// the checkout: the website's secrets and the staging rate limiter's key.
// Values are never printed.

/** @type {Array<[string, string]>} [secret name on the staging Worker, rule] */
export const STAGING_WORKER_SECRETS = [
  ["FOUNDATION_SUPABASE_SECRET_KEY", "supabase-secret"],
  ["FOUNDATION_PHONE_OTP_KEY", "hex64"],
  ["INTERNAL_JOBS_SECRET", "long"],
  ["OPS_JOBS_SECRET", "long"],
  ["HEALTH_DIAGNOSTIC_TOKEN", "long"],
  ["RATE_LIMITER_API_KEY", "long"],
  ["KYC_ENCRYPTION_KEY", "hex64"],
  ["ID_ENCRYPTION_KEY", "hex64"],
  ["HMAC_SECRET", "hex64"],
  ["IP_HASH_SECRET", "long"],
  ["RESEND_API_KEY", "resend"],
  ["AFRICASTALKING_API_KEY", "present"],
  ["R2_ACCESS_KEY_ID", "present"],
  ["R2_SECRET_ACCESS_KEY", "present"],
];

/** @type {Record<string, (value: string) => boolean>} */
const RULES = {
  "supabase-secret": (value) => /^sb_secret_[A-Za-z0-9_-]{20,}$/.test(value),
  hex64: (value) => /^[0-9a-f]{64}$/i.test(value) && new Set(value).size >= 8,
  long: (value) => value.length >= 32,
  resend: (value) => /^re_[A-Za-z0-9_]{10,}$/.test(value),
  present: (value) => value.length >= 8,
};

/**
 * Returns { secrets, problems }; problems name settings only, never values.
 * @param {Record<string, string | undefined>} env
 * @returns {{ secrets: Record<string, string>, problems: string[] }}
 */
export function collectStagingSecrets(env) {
  /** @type {Record<string, string>} */
  const secrets = {};
  /** @type {string[]} */
  const problems = [];
  for (const [name, rule] of STAGING_WORKER_SECRETS) {
    const value = env[`STAGING_${name}`];
    if (typeof value !== "string" || value.length === 0)
      problems.push(`STAGING_${name} is missing`);
    else if (value !== value.trim() || !RULES[rule](value))
      problems.push(`STAGING_${name} is malformed (${rule})`);
    else secrets[name] = value;
  }
  // The R2 S3 endpoint needs the account id; staging shares the Cloudflare
  // account (an identifier, not a credential) but has its own buckets and key.
  if (/^[0-9a-f]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? ""))
    secrets.R2_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
  else problems.push("CLOUDFLARE_ACCOUNT_ID is missing or malformed");
  if (secrets.FOUNDATION_SUPABASE_SECRET_KEY)
    secrets.SUPABASE_SERVICE_ROLE_KEY = secrets.FOUNDATION_SUPABASE_SECRET_KEY; // secret-scan: allow runtime alias, no credential literal
  // Cloudflare's published always-pass Turnstile test secret (the pair of the
  // test site key in wrangler.toml [env.staging]); public documentation, not a
  // credential. Built from parts so no scanner mistakes it for one.
  secrets.TURNSTILE_SECRET_KEY = ["1x", "0".repeat(31), "AA"].join("");
  return { secrets, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP)
    throw new Error("Staging secret preparation requires an isolated Actions runner");
  if (process.argv.length !== 2) throw new Error("Unsupported staging secret argument");
  const { secrets, problems } = collectStagingSecrets(process.env);
  if (problems.length) {
    for (const problem of problems) console.error(`::error::${problem}`);
    throw new Error("Staging secrets are incomplete; nothing was deployed");
  }
  const write = (file, value) =>
    writeFile(path.join(process.env.RUNNER_TEMP, file), JSON.stringify(value), {
      mode: 0o600,
      flag: "wx",
    });
  await write("staging-worker-secrets.json", secrets);
  await write("staging-limiter-secrets.json", {
    WORKER_API_KEY: secrets.RATE_LIMITER_API_KEY, // secret-scan: allow runtime reference, no credential literal
  });
  console.log(
    `Staging Worker secrets checked and prepared outside the checkout: ${Object.keys(secrets).sort().join(", ")}`
  );
}
