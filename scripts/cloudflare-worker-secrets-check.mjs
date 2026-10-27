#!/usr/bin/env node

import nextEnv from "@next/env";
import { readFile } from "node:fs/promises";
import {
  activeVersionIds,
  inspectSecretBindings,
  withPendingSecretBindings,
} from "./lib/cloudflare-deployment-bindings.mjs";
import { runWranglerJson } from "./lib/cloudflare-wrangler.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const envArg = args.find((arg) => arg.startsWith("--env="));
const workerArg = args.find((arg) => arg.startsWith("--name="));
const pendingArg = args.find((arg) => arg.startsWith("--pending-secrets-file="));
if (args.some((arg) => !/^(--env=|--name=|--pending-secrets-file=)/.test(arg)))
  throw new Error("Unsupported secret-check argument");

const targetEnv = envArg ? envArg.slice("--env=".length) : "";
// Let Wrangler resolve the configured environment's name unless explicitly overridden.
// A default --name would override env.staging.name and inspect production instead.
const workerName = workerArg ? workerArg.slice("--name=".length) : undefined;

const requiredSecrets = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "FOUNDATION_SUPABASE_SECRET_KEY",
  "FOUNDATION_PHONE_OTP_KEY",
  "RESEND_API_KEY",
  "AFRICASTALKING_API_KEY",
  "AFRICASTALKING_USERNAME",
  "AFRICASTALKING_SENDER_ID",
  "OZOW_ENV",
  "OZOW_CLIENT_ID",
  "OZOW_CLIENT_SECRET",
  "OZOW_SITE_CODE",
  "OZOW_WEBHOOK_SECRET",
  "KYC_WEBHOOK_SECRET",
  "TURNSTILE_SECRET_KEY",
  "KYC_ENCRYPTION_KEY",
  "ID_ENCRYPTION_KEY",
  "HMAC_SECRET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "IP_HASH_SECRET",
  "RATE_LIMITER_API_KEY",
  "OPS_JOBS_SECRET",
  "INTERNAL_JOBS_SECRET",
];

function hasCloudflareApiToken() {
  return (
    typeof process.env.CLOUDFLARE_API_TOKEN === "string" &&
    process.env.CLOUDFLARE_API_TOKEN.trim().length > 0
  );
}

function assertCloudflareApiToken() {
  if (hasCloudflareApiToken()) {
    return;
  }

  throw new Error(
    "CLOUDFLARE_API_TOKEN is required to inspect deployed Worker secrets in non-interactive release checks. Set a Cloudflare API token with Workers Scripts Read and Account Workers Scripts Read access, then rerun pnpm cloudflare:secrets:check."
  );
}

const forbiddenProductionSecrets = [
  "PLAYWRIGHT_E2E_AUTH",
  "PLAYWRIGHT_TEST_MODE",
  "PLAYWRIGHT_SUPABASE_MODE",
  "NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE",
  "NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE",
  "BYPASS_OTP_CODE",
  "TEST_PHONE_NUMBERS",
  "ENABLE_DEV_PAYMENT_BYPASS",
  "ENABLE_MOCK_OZOW",
  "ENABLE_DEV_KYC_WEBHOOK_BYPASS",
  "ENABLE_DEV_TURNSTILE_BYPASS",
  "ENABLE_TEST_POSTING_BYPASS",
  "NEXT_PUBLIC_ENABLE_TEST_POSTING_BYPASS",
  "DEV_EXPOSE_OTP",
  "SMS_MOCK",
];

async function main() {
  assertCloudflareApiToken();
  const selectors = { workerName, targetEnv };
  let pending = null;
  if (pendingArg) {
    try {
      pending = JSON.parse(
        await readFile(pendingArg.slice("--pending-secrets-file=".length), "utf8")
      );
    } catch {
      throw new Error("Unable to read the pending secret bindings file");
    }
  }
  const deployments = await runWranglerJson(["deployments", "list"], selectors);
  const versionIds = activeVersionIds(deployments);
  let failed = false;
  console.log(
    `Cloudflare Worker secret check: ${workerName || "configured Worker"} (${targetEnv || "production"})`
  );
  for (const versionId of versionIds) {
    const version = await runWranglerJson(["versions", "view", versionId], selectors);
    const result = inspectSecretBindings(
      pending
        ? withPendingSecretBindings(version?.resources?.bindings, pending)
        : version?.resources?.bindings,
      requiredSecrets,
      forbiddenProductionSecrets
    );
    console.log(
      `Active deployed version: ${versionId}${pending ? " (including validated secrets for the pending atomic deploy)" : ""}`
    );
    for (const [kind, names] of Object.entries(result)) {
      if (names.length) {
        failed = true;
        console.log(`FAIL: ${kind} secret bindings: ${names.join(", ")}`);
      }
    }
    if (!result.missing.length && !result.unsafe.length && !result.forbidden.length) {
      console.log("PASS: Required secrets use secret bindings; no forbidden bypass bindings.");
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    "Cloudflare Worker secret check failed:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
