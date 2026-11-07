// Test-only secrets must never become production settings. The browser test
// suites use fixed or derived values that anyone can recompute: the stub
// suite's notification secret (scripts/start-playwright-server.cjs) and the
// foundation test copy's synthetic keys (foundation-e2e-target.mjs). The
// production launch check (scripts/validate-launch-env.ts) refuses them.
import { createRequire } from "node:module";
import {
  LOCAL_ID_ENCRYPTION_KEY,
  LOCAL_INTERNAL_JOBS_SECRET,
  LOCAL_OPS_JOBS_SECRET,
  LOCAL_OZOW_WEBHOOK_SECRET,
  LOCAL_PHONE_OTP_KEY,
} from "./foundation-e2e-target.mjs";

const require = createRequire(import.meta.url);

/** Every known test-only secret value. */
export function testFixtureSecrets() {
  const { createDeterministicEnv } = require("../start-playwright-server.cjs");
  const stub = createDeterministicEnv();
  return new Set(
    [
      stub.OZOW_WEBHOOK_SECRET,
      LOCAL_OZOW_WEBHOOK_SECRET,
      LOCAL_INTERNAL_JOBS_SECRET,
      LOCAL_OPS_JOBS_SECRET,
      LOCAL_PHONE_OTP_KEY,
      LOCAL_ID_ENCRYPTION_KEY,
    ].filter((value) => typeof value === "string" && value.length > 0)
  );
}

/**
 * Names of the settings whose value is a known test-only secret (names only,
 * never values), sorted.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function testFixtureSecretFindings(env) {
  const known = testFixtureSecrets();
  return Object.entries(env)
    .filter(([, value]) => typeof value === "string" && known.has(value.trim()))
    .map(([name]) => name)
    .sort();
}
