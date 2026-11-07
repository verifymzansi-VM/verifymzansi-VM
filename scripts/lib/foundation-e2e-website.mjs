// Environment for the website when it runs against the foundation test copy
// (M0.7). It reuses the existing browser-test switches from
// scripts/start-playwright-server.cjs (test mode, mock Ozow, Turnstile test
// keys, e2e runtime, synthetic provider placeholders) and swaps the retired
// stub database for the local foundation stack. The result always passes
// assertLocalFoundationTarget, so the website cannot be pointed elsewhere.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { E2E_FIXTURE, assertLocalFoundationTarget } from "./foundation-e2e-target.mjs";

const require = createRequire(import.meta.url);
const { createDeterministicEnv } = require("../start-playwright-server.cjs");

export const E2E_APP_URL = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;

/** Inherited settings that could point the website at another database,
 * switch on the retired stub's persona shortcuts, or carry real provider and
 * operations credentials the stub suite does not replace; always replaced or
 * removed (and blanked when an .env file names them). */
const DROPPED = new RegExp(
  "^(SUPABASE_|NEXT_PUBLIC_SUPABASE_|FOUNDATION_|PLAYWRIGHT_SUPABASE_MODE$|" +
    "NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE$|PLAYWRIGHT_E2E_AUTH$|PLAYWRIGHT_E2E_AUTO_APPROVE$|" +
    "DATABASE_URL$|POSTGRES_URL$|OZOW_CLIENT_|PAYFAST_|SENTRY_|NEXT_PUBLIC_SENTRY_|" +
    "CLOUDFLARE_|KYC_WEBHOOK_SECRET$|INTERNAL_JOBS_SECRET$|OPS_JOBS_SECRET$|" +
    "HEALTH_DIAGNOSTIC_TOKEN$|SITE_MONITOR_API_KEY$)"
);

/**
 * Key NAMES (never values) defined in the root .env* files. `next build` and
 * `next start` fill every key missing from the process environment from
 * .env.production.local, .env.local, .env.production and .env, so a developer's
 * real settings (rate limiter, provider keys, hosted URLs) would leak into the
 * copy. Each such key the copy does not set is passed explicitly as "", which
 * Next never overwrites.
 */
export function envFileKeyNames(root = process.cwd()) {
  const names = new Set();
  const files = existsSync(root)
    ? readdirSync(root).filter((name) => /^\.env(\..+)?$/.test(name) && name !== ".env.example")
    : [];
  for (const file of files) {
    for (const line of readFileSync(path.join(root, file), "utf8").split(/\r?\n/)) {
      const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/.exec(line)?.[1];
      if (name) names.add(name);
    }
  }
  return names;
}

/** The copy's local rate limiter stub, started by `serve` on loopback. */
export const LOCAL_LIMITER_URL = `http://127.0.0.1:${E2E_FIXTURE.limiterPort}/check`;
/** Synthetic key the stub expects; it exists only in the copy. */
export const LOCAL_LIMITER_KEY = "local-fixture-limiter-key";

/** Keys Next itself manages; never blanked. */
const NEXT_MANAGED = new Set(["NODE_ENV"]);

export function foundationWebsiteEnv(status, { root = process.cwd() } = {}) {
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
    // The stub suite unsets these; unset keys would be refilled from .env files.
    // The e2e runtime validates the environment strictly (a limiter key needs a
    // limiter URL, formatted keys reject ""), so these get neutral valid
    // values. The limiter is the copy's own loopback stub (started by `serve`),
    // so fail-closed actions such as checkout are not blocked as "degraded".
    OTP_RATE_LIMITER_URL: LOCAL_LIMITER_URL,
    OTP_RATE_LIMITER_TIMEOUT_MS: "500",
    RATE_LIMITER_API_KEY: LOCAL_LIMITER_KEY,
    OZOW_ENV: "staging",
    NEXT_PUBLIC_CF_IMAGE_RESIZING: "false",
  };
  for (const name of envFileKeyNames(root))
    if (!(name in env) && !NEXT_MANAGED.has(name)) env[name] = "";
  assertLocalFoundationTarget({ apiUrl: status.apiUrl, env });
  if (new URL(env.OTP_RATE_LIMITER_URL).hostname !== "127.0.0.1")
    throw new Error("Foundation test copy refused: the rate limiter must stay local");
  return env;
}

/** Written into .next after a copy build; `serve` refuses a build without it. */
export const BUILD_STAMP = ".next/foundation-e2e-stamp.json";

/** Hash of the values that `next build` inlines or binds for the copy
 * (NEXT_PUBLIC_* and FOUNDATION_*). Only the hash is stored. */
export function buildFingerprint(env) {
  const entries = Object.entries(env)
    .filter(([key]) => /^(NEXT_PUBLIC_|FOUNDATION_)/.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function writeBuildStamp(env, root = process.cwd()) {
  writeFileSync(
    path.join(root, BUILD_STAMP),
    `${JSON.stringify({ fingerprint: buildFingerprint(env) })}\n`
  );
}

/** Hosted Supabase addresses or foreign publishable keys in the client bundle. */
export function hostedMarkersIn(text, localPublishableKey) {
  const found = new Set();
  for (const match of text.matchAll(/[a-z]{20}\.supabase\.(?:co|in)\b/g)) found.add(match[0]);
  for (const match of text.matchAll(/sb_publishable_[A-Za-z0-9_-]+/g))
    if (match[0] !== localPublishableKey) found.add("a non-local publishable key");
  return [...found];
}

function* filesUnder(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* filesUnder(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Refuses to serve a .next folder that was not built for this copy: the stamp
 * must match the copy's environment (a normal build deletes the stamp), and
 * the client bundle must name no hosted project or foreign key.
 */
export function assertBuildIsCopy(env, root = process.cwd()) {
  const stampFile = path.join(root, BUILD_STAMP);
  if (!existsSync(stampFile))
    throw new Error(
      "The .next build is not a test copy build; build it with `foundation-e2e.mjs build`"
    );
  const stamp = JSON.parse(readFileSync(stampFile, "utf8"));
  if (stamp.fingerprint !== buildFingerprint(env))
    throw new Error("The .next build was made with other settings; rebuild the test copy");
  const markers = new Set();
  for (const file of filesUnder(path.join(root, ".next", "static")))
    if (/\.(js|css|json|html|txt)$/.test(file))
      for (const marker of hostedMarkersIn(
        readFileSync(file, "utf8"),
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ))
        markers.add(marker);
  if (markers.size > 0)
    throw new Error(`The client bundle names hosted settings: ${[...markers].join(", ")}`);
}
