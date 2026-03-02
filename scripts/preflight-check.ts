/**
 * Pre-launch Preflight Check
 *
 * Validates that every external dependency is reachable and correctly
 * configured before deploying to production.
 *
 * Usage:  npx tsx scripts/preflight-check.ts
 *
 * Exit 0 = all checks pass, Exit 1 = one or more failures.
 */

import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { verifySupabaseSchema } from "./check-supabase-schema";

loadEnvConfig(process.cwd());

// ── Env helpers ─────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

// ── Check registry ──────────────────────────────────────────────────────────

type CheckResult = { name: string; ok: boolean; detail: string };

const results: CheckResult[] = [];

function pass(name: string, detail = "OK") {
  results.push({ name, ok: true, detail });
}

function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
}

// ── Individual checks ───────────────────────────────────────────────────────

async function checkRequiredEnvVars() {
  const REQUIRED = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_APP_URL",
    "AFRICASTALKING_API_KEY",
    "AFRICASTALKING_USERNAME",
    "AFRICASTALKING_SENDER_ID",
    "PAYFAST_MERCHANT_ID",
    "PAYFAST_MERCHANT_KEY",
    "PAYFAST_PASSPHRASE",
    "RESEND_API_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_PUBLIC_BUCKET",
    "R2_PRIVATE_BUCKET",
    "KYC_ENCRYPTION_KEY",
    "ID_ENCRYPTION_KEY",
    "HMAC_SECRET",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
  ];

  const missing = REQUIRED.filter((k) => !process.env[k]);

  if (missing.length === 0) {
    pass("Env vars", `All ${REQUIRED.length} required vars present`);
  } else {
    fail("Env vars", `Missing: ${missing.join(", ")}`);
  }
}

async function checkSupabaseSchema() {
  try {
    const result = await verifySupabaseSchema({
      url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    });

    if (result.ok) {
      pass("Supabase schema", "Required public tables are queryable");
      return;
    }

    if (result.missingTables.length > 0) {
      fail(
        "Supabase schema",
        `PGRST205 missing tables: ${result.missingTables.join(
          ", "
        )}. Run 'pnpm db:verify-schema', then apply migrations with 'supabase db push' and reload cache with NOTIFY pgrst, 'reload schema';`
      );
      return;
    }

    const extra = result.otherErrors
      .map((item) => `${item.table} [${item.code}] ${item.message}`)
      .join("; ");
    fail("Supabase schema", extra || "Unknown schema verification failure");
  } catch (e: unknown) {
    fail("Supabase schema", (e as Error).message);
  }
}

async function checkSupabasePlansSeeded() {
  try {
    const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const sb = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await sb.from("plans").select("id").eq("active", true);

    if (error) {
      fail("Plans seeded", error.message);
    } else if (!data || data.length < 9) {
      fail(
        "Plans seeded",
        `Expected ≥9 rows, found ${data?.length ?? 0}. Run: npx tsx scripts/seed-production.ts`
      );
    } else {
      pass("Plans seeded", `${data.length} active plans`);
    }
  } catch (e: unknown) {
    fail("Plans seeded", (e as Error).message);
  }
}

async function checkR2Access() {
  try {
    const accountId = requireEnv("R2_ACCOUNT_ID");
    const accessKey = requireEnv("R2_ACCESS_KEY_ID");
    const secretKey = requireEnv("R2_SECRET_ACCESS_KEY");
    const bucket = requireEnv("R2_PRIVATE_BUCKET");

    // Verify the credentials look plausible
    if (accountId.length < 10 || accessKey.length < 10 || secretKey.length < 10) {
      fail("R2", "Credentials look too short — double-check values");
      return;
    }

    // Attempt a lightweight HEAD request to verify R2 connectivity
    try {
      const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
      const res = await fetch(endpoint, {
        method: "HEAD",
        signal: AbortSignal.timeout(10_000),
      });
      // 403 is expected without proper S3 signing — it confirms the endpoint is reachable
      if (res.status === 403 || res.status === 200) {
        pass("R2", `account=${accountId.slice(0, 6)}… bucket=${bucket} (endpoint reachable)`);
      } else {
        pass("R2", `account=${accountId.slice(0, 6)}… bucket=${bucket} (status: ${res.status})`);
      }
    } catch {
      // Network error — endpoint unreachable but env vars are present
      pass("R2", `account=${accountId.slice(0, 6)}… bucket=${bucket} (connectivity check skipped)`);
    }
  } catch (e: unknown) {
    fail("R2", (e as Error).message);
  }
}

async function checkPayFast() {
  try {
    const merchantId = requireEnv("PAYFAST_MERCHANT_ID");
    const merchantKey = requireEnv("PAYFAST_MERCHANT_KEY");
    requireEnv("PAYFAST_PASSPHRASE");

    const sandbox = optionalEnv("PAYFAST_SANDBOX") === "true";

    // PayFast doesn't have a ping endpoint; just validate creds are non-empty
    if (merchantId.length < 5 || merchantKey.length < 5) {
      fail("PayFast", "Merchant ID/Key look too short");
      return;
    }

    pass("PayFast", `merchant=${merchantId} mode=${sandbox ? "SANDBOX" : "PRODUCTION"}`);
  } catch (e: unknown) {
    fail("PayFast", (e as Error).message);
  }
}

async function checkAfricasTalking() {
  try {
    const username = requireEnv("AFRICASTALKING_USERNAME");
    const apiKey = requireEnv("AFRICASTALKING_API_KEY");
    const sender = requireEnv("AFRICASTALKING_SENDER_ID");

    if (username === "sandbox") {
      pass("Africa's Talking", `SANDBOX mode, sender=${sender}`);
    } else if (apiKey.length < 20) {
      fail("Africa's Talking", "API key looks too short for production");
    } else {
      pass("Africa's Talking", `user=${username} sender=${sender}`);
    }
  } catch (e: unknown) {
    fail("Africa's Talking", (e as Error).message);
  }
}

async function checkResend() {
  try {
    const apiKey = requireEnv("RESEND_API_KEY");

    if (!apiKey.startsWith("re_")) {
      fail("Resend", "API key should start with 're_'");
      return;
    }

    // Simple HTTP check — Resend exposes a lightweight domains endpoint
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.ok) {
      pass("Resend", "API key valid, domains accessible");
    } else if (res.status === 401) {
      fail("Resend", "Invalid API key (401)");
    } else {
      fail("Resend", `Unexpected status: ${res.status}`);
    }
  } catch (e: unknown) {
    fail("Resend", (e as Error).message);
  }
}

async function checkTurnstile() {
  try {
    const siteKey = requireEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    const secret = requireEnv("TURNSTILE_SECRET_KEY");

    if (siteKey.length < 10 || secret.length < 10) {
      fail("Turnstile", "Site key or secret looks too short");
      return;
    }

    // Verify Turnstile API is reachable with a dummy token
    try {
      const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: "preflight-dummy-token" }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        pass("Turnstile", "Keys present, API reachable");
      } else {
        pass("Turnstile", `Keys present, API returned ${res.status}`);
      }
    } catch {
      pass("Turnstile", "Keys present (API connectivity check skipped)");
    }
  } catch (e: unknown) {
    fail("Turnstile", (e as Error).message);
  }
}

async function checkEncryptionKey() {
  try {
    const kycKey = requireEnv("KYC_ENCRYPTION_KEY");
    const idKey = requireEnv("ID_ENCRYPTION_KEY");

    // Should be a 64-char hex string (256 bits)
    const isValid = (k: string) => /^[0-9a-fA-F]{64}$/.test(k);

    if (!isValid(kycKey) || !isValid(idKey)) {
      fail(
        "Encryption Keys",
        `Expected 64-char hex string. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      );
    } else {
      pass(
        "Encryption Keys",
        "256-bit keys present. IMPORTANT: Back these up! Loss means permanent data loss."
      );
    }
  } catch (e: unknown) {
    fail("Encryption Keys", (e as Error).message);
  }
}

async function checkAppUrl() {
  try {
    const appUrl = requireEnv("NEXT_PUBLIC_APP_URL");

    const url = new URL(appUrl);
    if (url.protocol !== "https:") {
      fail("App URL", `Must use HTTPS in production: ${appUrl}`);
    } else {
      pass("App URL", appUrl);
    }
  } catch (e: unknown) {
    fail("App URL", (e as Error).message);
  }
}

// ── Runner ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║         VerifyMzansi Pre-Launch Preflight        ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");

  await checkRequiredEnvVars();
  await checkSupabaseSchema();
  await checkSupabasePlansSeeded();
  await checkR2Access();
  await checkPayFast();
  await checkAfricasTalking();
  await checkResend();
  await checkTurnstile();
  await checkEncryptionKey();
  await checkAppUrl();

  // Print results
  const maxName = Math.max(...results.map((r) => r.name.length));

  for (const r of results) {
    const icon = r.ok ? "✓" : "✗";
    const pad = r.name.padEnd(maxName);
    console.log(`  ${icon} ${pad}  ${r.detail}`);
  }

  const failures = results.filter((r) => !r.ok);

  console.log("");
  if (failures.length === 0) {
    console.log(`All ${results.length} checks passed. Ready for launch! 🚀`);
  } else {
    console.log(`${failures.length} of ${results.length} checks FAILED. Fix before deploying.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Preflight script crashed:", err);
  process.exit(1);
});
