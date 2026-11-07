// Environment for the website when it runs against the foundation test copy
// (M0.7). It reuses the existing browser-test switches from
// scripts/start-playwright-server.cjs (test mode, mock Ozow, Turnstile test
// keys, e2e runtime, synthetic provider placeholders) and swaps the retired
// stub database for the local foundation stack. The result always passes
// assertLocalFoundationTarget, so the website cannot be pointed elsewhere.
import { createRequire } from "node:module";
import { E2E_FIXTURE, assertLocalFoundationTarget } from "./foundation-e2e-target.mjs";

const require = createRequire(import.meta.url);
const { createDeterministicEnv } = require("../start-playwright-server.cjs");

export const E2E_APP_URL = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;

/** Inherited settings that could point the website at another database or
 * switch on the retired stub's persona shortcuts; always replaced or removed. */
const DROPPED =
  /^(SUPABASE_|NEXT_PUBLIC_SUPABASE_|FOUNDATION_|PLAYWRIGHT_SUPABASE_MODE$|NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE$|PLAYWRIGHT_E2E_AUTH$|PLAYWRIGHT_E2E_AUTO_APPROVE$|DATABASE_URL$|POSTGRES_URL$)/;

export function foundationWebsiteEnv(status) {
  // createDeterministicEnv() is the caller's environment plus the stub
  // suite's fixed test values; database and persona settings are dropped.
  const base = Object.fromEntries(
    Object.entries(createDeterministicEnv()).filter(
      ([key, value]) => value !== undefined && !DROPPED.test(key)
    )
  );
  const env = {
    ...base,
    NODE_OPTIONS: base.NODE_OPTIONS || "--max-old-space-size=6144",
    PORT: String(E2E_FIXTURE.appPort),
    NEXT_PUBLIC_DATA_BACKEND: "foundation",
    NEXT_PUBLIC_APP_URL: E2E_APP_URL,
    NEXT_PUBLIC_MEDIA_URL: `${E2E_APP_URL}/e2e-media`,
    NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.publishableKey,
    FOUNDATION_SUPABASE_URL: status.apiUrl,
    FOUNDATION_PROJECT_REF: E2E_FIXTURE.projectRef,
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
    FOUNDATION_SUPABASE_SECRET_KEY: status.secretKey,
    SUPABASE_SERVICE_ROLE_KEY: status.secretKey,
    // Same switches as production (wrangler.toml [vars]).
    FOUNDATION_PASSWORD_AUTH_MODE: "native-captcha",
    FOUNDATION_REGISTRATION_ENABLED: "true",
    FOUNDATION_AUTH_CALLBACK_ENABLED: "true",
    FOUNDATION_RECOVERY_ENABLED: "true",
    FOUNDATION_PHONE_VERIFICATION_ENABLED: "true",
    KYC_PROVIDER: "manual",
  };
  assertLocalFoundationTarget({ apiUrl: status.apiUrl, env });
  return env;
}
