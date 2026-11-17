// Test-only secrets must never become production settings. The browser tests
// use fixed or derived values that anyone can recompute: the foundation test
// copy's synthetic keys (foundation-e2e-target.mjs) and the notification
// secret of the retired stub suite, which stays public in the history. The
// production launch check (scripts/validate-launch-env.ts) refuses them.
import {
  LOCAL_ID_ENCRYPTION_KEY,
  LOCAL_INTERNAL_JOBS_SECRET,
  LOCAL_OPS_JOBS_SECRET,
  LOCAL_OZOW_WEBHOOK_SECRET,
  LOCAL_PHONE_OTP_KEY,
} from "./foundation-e2e-target.mjs";

/** The retired stub suite's Ozow notification secret (Svix form). */
export const RETIRED_STUB_OZOW_WEBHOOK_SECRET = `whsec_${Buffer.from(
  "playwright-ozow-webhook-secret-32hars"
).toString("base64")}`;

/** Every known test-only secret value. */
export function testFixtureSecrets() {
  return new Set(
    [
      RETIRED_STUB_OZOW_WEBHOOK_SECRET,
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
