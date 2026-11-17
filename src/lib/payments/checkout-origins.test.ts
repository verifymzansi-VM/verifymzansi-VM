/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRODUCTION_CHECKOUT_ORIGIN,
  TEST_COPY_CHECKOUT,
  testCopyCheckout,
} from "./checkout-origins";

// Checkout outside production (roadmap M0.8): the test copy profile switches on
// only when every condition holds, and never with production settings.

type Env = Record<string, string | undefined>;
const COPY: Env = {
  NODE_ENV: "production",
  ENVIRONMENT: "test",
  VERIFYMZANSI_RUNTIME_MODE: "e2e",
  PLAYWRIGHT_TEST_MODE: "1",
  ENABLE_MOCK_OZOW: "true",
  OZOW_ENV: "staging",
  FOUNDATION_PROJECT_REF: "local-foundation",
  FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55443",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3110",
};
/** Each change alone must switch the profile off; unset means missing. */
const SINGLE_CHANGES: [string, Env][] = [
  ["ENVIRONMENT=production", { ENVIRONMENT: "production" }],
  ["ENVIRONMENT=staging", { ENVIRONMENT: "staging" }],
  ["ENVIRONMENT=development", { ENVIRONMENT: "development" }],
  ["ENVIRONMENT in capitals", { ENVIRONMENT: "TEST" }],
  ["ENVIRONMENT missing", { ENVIRONMENT: undefined }],
  ["no e2e runtime", { VERIFYMZANSI_RUNTIME_MODE: undefined }],
  ["a development runtime", { VERIFYMZANSI_RUNTIME_MODE: "development" }],
  ["browser test mode missing", { PLAYWRIGHT_TEST_MODE: undefined }],
  ["browser test mode 0", { PLAYWRIGHT_TEST_MODE: "0" }],
  ["mock Ozow missing", { ENABLE_MOCK_OZOW: undefined }],
  ["mock Ozow false", { ENABLE_MOCK_OZOW: "false" }],
  ["mock Ozow 1", { ENABLE_MOCK_OZOW: "1" }],
  ["OZOW_ENV=production", { OZOW_ENV: "production" }],
  ["OZOW_ENV missing", { OZOW_ENV: undefined }],
  ["OZOW_ENV unknown", { OZOW_ENV: "sandbox" }],
  ["the London project ref", { FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy" }],
  ["project ref missing", { FOUNDATION_PROJECT_REF: undefined }],
  ["the London database", { FOUNDATION_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co" }],
  ["database missing", { FOUNDATION_SUPABASE_URL: undefined }],
  ["another local database port", { FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55441" }],
  ["localhost instead of 127.0.0.1", { FOUNDATION_SUPABASE_URL: "http://localhost:55443" }],
  ["a trailing slash", { FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55443/" }],
  ["HTTPS to the local gateway", { FOUNDATION_SUPABASE_URL: "https://127.0.0.1:55443" }],
];

function stubEnv(values: Env) {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("document", undefined);
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

/** Production Worker settings, as committed in wrangler.toml. */
function wrangler() {
  return parse(readFileSync("wrangler.toml", "utf8")) as {
    vars: Env;
    env: { production: { vars: Env }; staging?: { vars: Env } };
  };
}
/** Values production also needs but keeps in secrets; test switches as if leaked. */
const LEAKED_TEST_SWITCHES: Env = {
  VERIFYMZANSI_RUNTIME_MODE: "e2e",
  PLAYWRIGHT_TEST_MODE: "1",
  ENABLE_MOCK_OZOW: "true",
  OZOW_ENV: "staging",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("testCopyCheckout", () => {
  for (const nodeEnv of ["production", "test"])
    it(`is on for the local test copy (NODE_ENV=${nodeEnv})`, () => {
      stubEnv({ ...COPY, NODE_ENV: nodeEnv });
      expect(testCopyCheckout()).toBe(TEST_COPY_CHECKOUT);
    });

  for (const nodeEnv of ["production", "test"])
    for (const [label, change] of SINGLE_CHANGES)
      it(`is off with ${label} (NODE_ENV=${nodeEnv})`, () => {
        stubEnv({ ...COPY, NODE_ENV: nodeEnv, ...change });
        expect(testCopyCheckout()).toBeNull();
      });

  it("is off in the browser, even with the browser test-mode markers", () => {
    stubEnv({ ...COPY, NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE: "1" });
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { documentElement: { dataset: { playwright: "1" } } });
    expect(testCopyCheckout()).toBeNull();
  });

  it("names only exact loopback addresses, the payment page on HTTPS", () => {
    expect(TEST_COPY_CHECKOUT).toEqual({
      appOrigin: "http://127.0.0.1:3110",
      databaseUrl: "http://127.0.0.1:55443",
      mockPaymentOrigin: "https://127.0.0.1:55455",
      providerOrigin: "http://127.0.0.1:55448",
    });
    expect(Object.isFrozen(TEST_COPY_CHECKOUT)).toBe(true);
    for (const value of Object.values(TEST_COPY_CHECKOUT))
      expect(new URL(value).origin).toBe(value);
  });
});

describe("production settings", () => {
  it("keep the one live checkout address", () => {
    const toml = wrangler();
    expect(PRODUCTION_CHECKOUT_ORIGIN).toBe("https://verifymzansi.com");
    for (const vars of [toml.vars, toml.env.production.vars]) {
      expect(vars.NEXT_PUBLIC_APP_URL).toBe(PRODUCTION_CHECKOUT_ORIGIN);
      // Three independent refusals, each enough on its own.
      expect(vars.ENVIRONMENT).toBe("production");
      expect(vars.FOUNDATION_PROJECT_REF).toBe("gntzjtuncsyefujajmjy");
      expect(vars.FOUNDATION_SUPABASE_URL).toBe("https://gntzjtuncsyefujajmjy.supabase.co");
    }
  });

  it("switch the test copy profile off, even if every test switch leaked in", () => {
    const toml = wrangler();
    const sections = [toml.vars, toml.env.production.vars];
    // The committed staging section (if still present) names the production project.
    if (toml.env.staging) sections.push(toml.env.staging.vars);
    for (const vars of sections) {
      for (const extra of [{ OZOW_ENV: "production" }, LEAKED_TEST_SWITCHES]) {
        vi.unstubAllEnvs();
        stubEnv({ ...vars, ...extra });
        expect(testCopyCheckout()).toBeNull();
      }
    }
  });

  it("are refused by the deploy preflight if the test switches are set", () => {
    // scripts/preflight-cloudflare.js neutralises these in every production build.
    const source = readFileSync("scripts/preflight-cloudflare.js", "utf8");
    const blocked = /const blockedProductionVars = \[([^\]]+)\]/.exec(source)?.[1] ?? "";
    for (const name of ["ENABLE_MOCK_OZOW", "PLAYWRIGHT_TEST_MODE"])
      expect(blocked).toContain(`"${name}"`);
  });
});
