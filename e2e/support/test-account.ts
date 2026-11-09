/**
 * Sign-in details for browser tests that need an existing account.
 *
 * E2E_EMAIL and E2E_PASSWORD still win when both are set (a run against a
 * real deployment). Otherwise the tests use a member of the local Supabase
 * stand-in that scripts/start-playwright-server.cjs always starts: it accepts
 * `<persona>@playwright.verifymzansi.test` with the persona's fixed test
 * password (src/lib/supabase/playwright-fixture-store.ts). These are not real
 * credentials; they work only against that stand-in.
 */
export function signInAccount(persona = "e2e-sign-in"): { email: string; password: string } {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (email && password) return { email, password };
  return {
    email: `${persona}@playwright.verifymzansi.test`,
    password: ["Playwright", persona, "Password1!"].join("-"),
  };
}
