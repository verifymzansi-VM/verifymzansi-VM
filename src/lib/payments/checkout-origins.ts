import { isPlaywrightFoundationCopy } from "../supabase/playwright-mode";

/** The only website address live checkout accepts. Unchanged by test settings. */
export const PRODUCTION_CHECKOUT_ORIGIN = "https://verifymzansi.com";

/**
 * The private local foundation test copy (roadmap M0.7): the website, its
 * database gateway and the mock payment page, all on this machine. Exact
 * addresses, never patterns. The values match scripts/lib/foundation-e2e-target.mjs
 * (checked by scripts/foundation-e2e-target.test.mjs).
 */
export const TEST_COPY_CHECKOUT = Object.freeze({
  appOrigin: "http://127.0.0.1:3110",
  databaseUrl: "http://127.0.0.1:55443",
  /** HTTPS because stored checkout URLs must be HTTPS; nothing listens there
   * outside the browser tests, which serve the page themselves. */
  mockPaymentOrigin: "https://127.0.0.1:55455",
});

// Staging (roadmap M0.15b, then M3.5) does not exist yet and has no profile
// here. When it does, it gets its own exact origin, its own project and Ozow's
// test system, and the same rule: every condition required, anything else refused.

/**
 * Checkout settings for the test copy, or null. Every condition is required and
 * a missing or unknown value refuses:
 * - not production: ENVIRONMENT is exactly "test", the e2e runtime and browser
 *   test mode are on (isPlaywrightFoundationCopy also refuses ENVIRONMENT=production
 *   and browsers);
 * - Ozow runs in mock mode against its test system: ENABLE_MOCK_OZOW is "true"
 *   and OZOW_ENV is exactly "staging";
 * - the database is not the production project: the foundation backend on the
 *   local project marker, at exactly the copy's loopback gateway.
 * Production sets ENVIRONMENT=production and the London project, and its deploy
 * blocks ENABLE_MOCK_OZOW and PLAYWRIGHT_TEST_MODE, so this is null there.
 */
export function testCopyCheckout(): typeof TEST_COPY_CHECKOUT | null {
  const env = process.env;
  if (
    isPlaywrightFoundationCopy() &&
    env.ENVIRONMENT === "test" &&
    env.VERIFYMZANSI_RUNTIME_MODE === "e2e" &&
    env.ENABLE_MOCK_OZOW === "true" &&
    env.OZOW_ENV === "staging" &&
    env.FOUNDATION_SUPABASE_URL === TEST_COPY_CHECKOUT.databaseUrl
  )
    return TEST_COPY_CHECKOUT;
  return null;
}
