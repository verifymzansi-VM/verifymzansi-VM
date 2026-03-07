/* eslint-disable no-console */

import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import {
  EXPECTED_ACTIVE_PLAN_ROWS,
  getPlanContractKey,
  normalizePlanBillingFrequency,
  type SeedPlanContractRow,
} from "./seed-contract";
import { verifySupabaseSchema } from "./check-supabase-schema";
import {
  validateLaunchConfiguration,
  type LaunchCheckStatus,
  type LaunchValidationMode,
} from "../src/lib/config/launch-validation";

loadEnvConfig(process.cwd());

type CheckResult = {
  name: string;
  status: LaunchCheckStatus;
  detail: string;
};

const results: CheckResult[] = [];

function parseModeArg(argv: string[]): LaunchValidationMode | undefined {
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  if (!modeArg) return undefined;

  const rawValue = modeArg.slice("--mode=".length);
  if (rawValue === "development" || rawValue === "e2e" || rawValue === "production") {
    return rawValue;
  }

  throw new Error(`Unsupported preflight mode: ${rawValue}`);
}

function addResult(name: string, status: LaunchCheckStatus, detail: string): void {
  results.push({ name, status, detail });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

async function checkSupabaseSchema(): Promise<void> {
  try {
    const result = await verifySupabaseSchema({
      url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    });

    if (result.ok) {
      addResult("Supabase schema", "pass", "Required public tables are queryable");
      return;
    }

    if (result.missingTables.length > 0) {
      addResult(
        "Supabase schema",
        "fail",
        `PGRST205 missing tables: ${result.missingTables.join(
          ", "
        )}. Run 'supabase db push' and reload PostgREST schema cache before deploy.`
      );
      return;
    }

    const otherErrors = result.otherErrors
      .map((item) => `${item.table} [${item.code}] ${item.message}`)
      .join("; ");
    addResult("Supabase schema", "fail", otherErrors || "Unknown schema verification failure");
  } catch (error) {
    addResult("Supabase schema", "fail", (error as Error).message);
  }
}

async function checkSupabasePlansSeeded(mode: LaunchValidationMode): Promise<void> {
  if (mode !== "production") {
    addResult(
      "Plans seeded",
      "warn",
      "Skipped outside production mode. Run 'pnpm preflight:prod' before deploy."
    );
    return;
  }

  try {
    const supabase = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );

    const { data, error } = await supabase
      .from("plans")
      .select("area,tier,name,price_cents,billing_frequency,active")
      .eq("active", true);

    if (error) {
      addResult("Plans seeded", "fail", error.message);
      return;
    }

    const actualRows = (data ?? []) as SeedPlanContractRow[];
    const actualByKey = new Map(actualRows.map((row) => [getPlanContractKey(row), row]));
    const missing = EXPECTED_ACTIVE_PLAN_ROWS.filter(
      (row) => !actualByKey.has(getPlanContractKey(row))
    ).map((row) => `${row.area}/${row.tier}`);
    const mismatched = EXPECTED_ACTIVE_PLAN_ROWS.filter((row) => {
      const actual = actualByKey.get(getPlanContractKey(row));
      return (
        actual &&
        (actual.name !== row.name ||
          actual.price_cents !== row.price_cents ||
          normalizePlanBillingFrequency(actual.billing_frequency) !== row.billing_frequency ||
          actual.active !== row.active)
      );
    }).map((row) => `${row.area}/${row.tier}`);
    const unexpected = actualRows
      .filter(
        (row) =>
          !EXPECTED_ACTIVE_PLAN_ROWS.some(
            (expected) => getPlanContractKey(expected) === getPlanContractKey(row)
          )
      )
      .map((row) => `${row.area}/${row.tier}`);

    const missingOnlyPromotionsRows =
      missing.length > 0 && missing.every((row) => row.startsWith("PROMOTIONS_EVENTS/"));
    const missingPromotionsHint = missingOnlyPromotionsRows
      ? " This usually means the linked Supabase database is missing the PROMOTIONS_EVENTS marketplace_area enum migration. Apply migrations, then rerun pnpm seed:prod."
      : "";

    if (missing.length > 0 || mismatched.length > 0 || unexpected.length > 0) {
      const details = [
        missing.length > 0 ? `missing ${missing.join(", ")}` : null,
        mismatched.length > 0 ? `mismatched ${mismatched.join(", ")}` : null,
        unexpected.length > 0 ? `unexpected ${unexpected.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("; ");

      addResult(
        "Plans seeded",
        "fail",
        `Expected ${EXPECTED_ACTIVE_PLAN_ROWS.length} active runtime plan rows; found ${actualRows.length}. ${details}. Run: pnpm seed:prod.${missingPromotionsHint}`
      );
      return;
    }

    addResult(
      "Plans seeded",
      "pass",
      `${actualRows.length} active plans match the runtime pricing contract`
    );
  } catch (error) {
    addResult("Plans seeded", "fail", (error as Error).message);
  }
}

async function checkR2Access(mode: LaunchValidationMode): Promise<void> {
  if (mode !== "production") {
    addResult("R2", "warn", "Endpoint reachability is only enforced in production mode.");
    return;
  }

  try {
    const accountId = requireEnv("R2_ACCOUNT_ID");
    const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
    const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
    const bucket = requireEnv("R2_PRIVATE_BUCKET");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    await client.send(
      new HeadBucketCommand({
        Bucket: bucket,
      })
    );

    addResult(
      "R2",
      "pass",
      `account=${accountId.slice(0, 6)}... bucket=${bucket} credentials valid and bucket reachable`
    );
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Unknown R2 error";
    const message =
      rawMessage.includes("EPROTO") || rawMessage.toLowerCase().includes("handshake failure")
        ? `${rawMessage}. Cloudflare R2 TLS negotiation failed from this environment; retry from WSL/CI or verify local TLS interception settings.`
        : rawMessage;
    addResult("R2", "fail", message);
  }
}

function checkPayFast(mode: LaunchValidationMode): void {
  try {
    const sandbox = optionalEnv("PAYFAST_SANDBOX");
    if (mode !== "production") {
      addResult(
        "PayFast",
        "warn",
        `Non-production mode allows PAYFAST_SANDBOX=${sandbox ?? "unset"}`
      );
      return;
    }

    const merchantId = requireEnv("PAYFAST_MERCHANT_ID");
    const merchantKey = requireEnv("PAYFAST_MERCHANT_KEY");
    const passphrase = requireEnv("PAYFAST_PASSPHRASE");

    if (merchantId.length < 5 || merchantKey.length < 5 || passphrase.length < 3) {
      addResult("PayFast", "fail", "Merchant credentials look too short for production");
      return;
    }

    addResult(
      "PayFast",
      "pass",
      `merchant=${merchantId} sandbox=${sandbox === "true" ? "true" : "false"}`
    );
  } catch (error) {
    addResult("PayFast", "fail", (error as Error).message);
  }
}

function checkAfricasTalking(mode: LaunchValidationMode): void {
  try {
    const username = requireEnv("AFRICASTALKING_USERNAME");
    const senderId = optionalEnv("AFRICASTALKING_SENDER_ID");

    if (mode !== "production") {
      addResult(
        "Africa's Talking",
        senderId ? "pass" : "warn",
        senderId
          ? `user=${username} sender=${senderId}`
          : "Sender ID is optional locally but required for production SMS delivery"
      );
      return;
    }

    if (username === "sandbox") {
      addResult("Africa's Talking", "fail", "Production cannot use the sandbox username");
      return;
    }

    addResult(
      "Africa's Talking",
      "pass",
      `user=${username} sender=${requireEnv("AFRICASTALKING_SENDER_ID")}`
    );
  } catch (error) {
    addResult("Africa's Talking", "fail", (error as Error).message);
  }
}

async function checkResend(mode: LaunchValidationMode): Promise<void> {
  try {
    const apiKey = requireEnv("RESEND_API_KEY");
    if (mode !== "production") {
      addResult(
        "Resend",
        "warn",
        "Live Resend API verification is skipped outside production mode."
      );
      return;
    }

    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      addResult("Resend", "pass", "API key validated against Resend domains endpoint");
    } else if (response.status === 401) {
      addResult("Resend", "fail", "Resend rejected the API key with 401");
    } else {
      addResult("Resend", "warn", `Resend returned HTTP ${response.status}`);
    }
  } catch (error) {
    addResult("Resend", "fail", (error as Error).message);
  }
}

async function checkTurnstile(mode: LaunchValidationMode): Promise<void> {
  if (mode !== "production") {
    addResult(
      "Turnstile",
      "warn",
      "Live Turnstile verification is skipped outside production mode."
    );
    return;
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: requireEnv("TURNSTILE_SECRET_KEY"),
        response: "preflight-dummy-token",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      addResult("Turnstile", "pass", "Turnstile endpoint reachable");
    } else {
      addResult("Turnstile", "warn", `Turnstile returned HTTP ${response.status}`);
    }
  } catch (error) {
    addResult("Turnstile", "fail", (error as Error).message);
  }
}

function appendLaunchChecks(mode: LaunchValidationMode): void {
  const summary = validateLaunchConfiguration(process.env, { mode });
  for (const check of summary.checks) {
    addResult(check.name, check.status, check.detail);
  }
}

async function main(): Promise<void> {
  const mode = parseModeArg(process.argv.slice(2)) ?? "development";

  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║         VerifyMzansi Pre-Launch Preflight       ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`Mode: ${mode}`);
  console.log("");

  appendLaunchChecks(mode);
  await checkSupabaseSchema();
  await checkSupabasePlansSeeded(mode);
  await checkR2Access(mode);
  checkPayFast(mode);
  checkAfricasTalking(mode);
  await checkResend(mode);
  await checkTurnstile(mode);

  const maxName = Math.max(...results.map((result) => result.name.length));

  for (const result of results) {
    const icon = result.status === "pass" ? "✓" : result.status === "warn" ? "!" : "✗";
    const paddedName = result.name.padEnd(maxName);
    console.log(`  ${icon} ${paddedName}  ${result.detail}`);
  }

  const failures = results.filter((result) => result.status === "fail");
  const warnings = results.filter((result) => result.status === "warn");

  console.log("");
  if (failures.length > 0) {
    console.log(`${failures.length} of ${results.length} checks failed. Fix before deploying.`);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(
      `${warnings.length} warning(s) in ${results.length} checks. Clear them before production launch.`
    );
    return;
  }

  console.log(`All ${results.length} checks passed for ${mode} mode.`);
}

main().catch((error) => {
  console.error("Preflight script crashed:", error);
  process.exit(1);
});
