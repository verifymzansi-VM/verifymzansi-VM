/* eslint-disable no-console */

import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { loadEnvConfig } from "@next/env";
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
const SUPABASE_SCHEMA_TIMEOUT_MS = 12_000;
const R2_HEAD_BUCKET_TIMEOUT_MS = 10_000;
const R2_HEAD_BUCKET_MAX_ATTEMPTS = 3;

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

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function retryWithBackoff<T>(
  task: (attempt: number) => Promise<T>,
  options: { maxAttempts: number; baseDelayMs: number }
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === options.maxAttempts) {
        break;
      }
      const delayMs = options.baseDelayMs * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown retry failure");
}

const SUPABASE_CONNECTIVITY_ERROR_PATTERN =
  /\b(fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b/i;

export function classifySupabaseSchemaPreflightError(
  mode: LaunchValidationMode,
  error: unknown
): Pick<CheckResult, "status" | "detail"> {
  const message = error instanceof Error ? error.message : "Unknown schema verification failure";

  if (mode !== "production" && SUPABASE_CONNECTIVITY_ERROR_PATTERN.test(message)) {
    return {
      status: "warn",
      detail:
        `Schema verification could not reach Supabase (${message}). ` +
        "Local preflight will continue, but rerun with working network access and require " +
        "'pnpm preflight:prod' before deploy.",
    };
  }

  return {
    status: "fail",
    detail: message,
  };
}

export function classifyOzowPreflightCheck({
  mode,
  ozowEnv,
  clientId,
  clientSecret,
  siteCode,
  webhookSecret,
  paymentScope = "payments",
}: {
  mode: LaunchValidationMode;
  ozowEnv?: string;
  clientId: string;
  clientSecret: string;
  siteCode: string;
  webhookSecret: string;
  paymentScope?: string;
}): Pick<CheckResult, "status" | "detail"> {
  if (mode !== "production") {
    return {
      status: "warn",
      detail: `Non-production mode allows OZOW_ENV=${ozowEnv ?? "unset"} scope=${paymentScope}`,
    };
  }

  if (ozowEnv !== "production") {
    return {
      status: "fail",
      detail: "OZOW_ENV must be production in production mode",
    };
  }

  if (
    clientId.length < 5 ||
    clientSecret.length < 8 ||
    siteCode.length < 3 ||
    webhookSecret.length < 8
  ) {
    return {
      status: "fail",
      detail: "Ozow credentials look too short for production",
    };
  }

  if (paymentScope !== "payments") {
    return {
      status: "fail",
      detail: "OZOW_PAYMENT_OAUTH_SCOPE must be payments in production mode",
    };
  }

  return {
    status: "pass",
    detail: `env=production site=${siteCode} scope=${paymentScope}`,
  };
}

async function checkSupabaseSchema(mode: LaunchValidationMode): Promise<void> {
  try {
    const result = await withTimeout(
      verifySupabaseSchema({
        url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
        serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      }),
      SUPABASE_SCHEMA_TIMEOUT_MS,
      "Supabase schema verification"
    );

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
    const classifiedError = classifySupabaseSchemaPreflightError(mode, error);
    addResult("Supabase schema", classifiedError.status, classifiedError.detail);
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

    await retryWithBackoff(
      async () => {
        await withTimeout(
          client.send(
            new HeadBucketCommand({
              Bucket: bucket,
            })
          ),
          R2_HEAD_BUCKET_TIMEOUT_MS,
          "R2 head bucket check"
        );
      },
      {
        maxAttempts: R2_HEAD_BUCKET_MAX_ATTEMPTS,
        baseDelayMs: 500,
      }
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

function checkOzow(mode: LaunchValidationMode): void {
  try {
    const ozowEnv = optionalEnv("OZOW_ENV");
    const clientId = requireEnv("OZOW_CLIENT_ID");
    const clientSecret = requireEnv("OZOW_CLIENT_SECRET");
    const siteCode = requireEnv("OZOW_SITE_CODE");
    const webhookSecret = requireEnv("OZOW_WEBHOOK_SECRET");
    const paymentScope = optionalEnv("OZOW_PAYMENT_OAUTH_SCOPE") ?? "payments";
    const result = classifyOzowPreflightCheck({
      mode,
      ozowEnv,
      clientId,
      clientSecret,
      siteCode,
      webhookSecret,
      paymentScope,
    });

    addResult("Ozow", result.status, result.detail);
  } catch (error) {
    addResult("Ozow", "fail", (error as Error).message);
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
  await checkSupabaseSchema(mode);
  await checkR2Access(mode);
  checkOzow(mode);
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

const currentScriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (currentScriptPath.endsWith("/scripts/preflight-check.ts")) {
  main().catch((error) => {
    console.error("Preflight script crashed:", error);
    process.exit(1);
  });
}
