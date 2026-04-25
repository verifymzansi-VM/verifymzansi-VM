#!/usr/bin/env node
/* eslint-disable no-console */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const args = process.argv.slice(2);
const envArg = args.find((arg) => arg.startsWith("--env="));
const workerArg = args.find((arg) => arg.startsWith("--name="));

const targetEnv = envArg ? envArg.slice("--env=".length) : "";
const workerName = workerArg ? workerArg.slice("--name=".length) : "verifymzansi";

const requiredSecrets = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "AFRICASTALKING_API_KEY",
  "AFRICASTALKING_USERNAME",
  "AFRICASTALKING_SENDER_ID",
  "OZOW_ENV",
  "OZOW_CLIENT_ID",
  "OZOW_CLIENT_SECRET",
  "OZOW_SITE_CODE",
  "OZOW_PAYMENT_OAUTH_SCOPE",
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
];

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

function buildWranglerCommand(commandParts) {
  const parts = ["pnpm", "wrangler", ...commandParts, "--name", workerName];
  if (envArg) {
    parts.push("--env", targetEnv);
  }
  return parts.map((part) => (part.includes(" ") ? `\"${part}\"` : part)).join(" ");
}

async function runWranglerJson(commandParts) {
  const command = buildWranglerCommand([...commandParts, "--json"]);
  const { stdout } = await execAsync(command, {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function getCurrentVersionId(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("No deployments found for worker");
  }

  const sorted = [...deployments].sort((a, b) => {
    const aTime = Date.parse(a?.created_on ?? "") || 0;
    const bTime = Date.parse(b?.created_on ?? "") || 0;
    return bTime - aTime;
  });

  const current = sorted[0];
  const activeVersion = Array.isArray(current?.versions)
    ? current.versions.find((entry) => Number(entry?.percentage) > 0)
    : null;

  if (!activeVersion?.version_id) {
    throw new Error("Unable to determine active deployed version id");
  }

  return activeVersion.version_id;
}

async function main() {
  const deployments = await runWranglerJson(["deployments", "list"]);
  const currentVersionId = getCurrentVersionId(deployments);
  const version = await runWranglerJson(["versions", "view", currentVersionId]);

  const bindings = version?.resources?.bindings;
  if (!Array.isArray(bindings)) {
    throw new Error("Unexpected versions view format: missing resources.bindings");
  }

  const existingNames = new Set(
    bindings.map((entry) => entry?.name).filter((value) => typeof value === "string")
  );

  const missing = requiredSecrets.filter((name) => !existingNames.has(name));
  const forbiddenPresent = forbiddenProductionSecrets.filter((name) => existingNames.has(name));

  const scopeLabel = targetEnv ? `${workerName} (${targetEnv})` : `${workerName} (production)`;
  console.log(`Cloudflare Worker secret check: ${scopeLabel}`);
  console.log(`Active deployed version: ${currentVersionId}`);

  if (missing.length === 0) {
    console.log("PASS: All required launch secrets are present.");
  } else {
    console.log(`FAIL: Missing required secrets (${missing.length}): ${missing.join(", ")}`);
  }

  if (forbiddenPresent.length === 0) {
    console.log("PASS: No forbidden production bypass secrets detected.");
  } else {
    console.log(
      `FAIL: Forbidden bypass secrets present (${forbiddenPresent.length}): ${forbiddenPresent.join(", ")}`
    );
  }

  if (missing.length > 0 || forbiddenPresent.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Cloudflare Worker secret check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
