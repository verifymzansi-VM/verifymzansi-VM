import assert from "node:assert/strict";
import { test } from "node:test";
import {
  E2E_FIXTURE,
  HOSTED_PROJECT_REFS,
  KNOWN_BREACHED_PASSWORD,
  LOCAL_ID_ENCRYPTION_KEY,
  LOCAL_INTERNAL_JOBS_SECRET,
  LOCAL_OPS_JOBS_SECRET,
  LOCAL_OZOW_SITE_CODE,
  LOCAL_OZOW_WEBHOOK_SECRET,
  LOCAL_PHONE_OTP_KEY,
  OUTBOUND_LOG_FILE,
  assertLocalFoundationTarget,
  assertLoopbackUrl,
  replayMigrationNames,
} from "./lib/foundation-e2e-target.mjs";
import { replaySteps } from "./lib/foundation-replay.mjs";
import {
  BUILD_STAMP,
  E2E_APP_URL,
  LOCAL_LIMITER_KEY,
  LOCAL_LIMITER_URL,
  LOCAL_MAIL_RELAY_KEY,
  LOCAL_MAIL_RELAY_URL,
  assertBuildIsCopy,
  envFileKeyNames,
  foundationWebsiteEnv,
  hostedMarkersIn,
  writeBuildStamp,
} from "./lib/foundation-e2e-website.mjs";
import { startLocalLimiter } from "./lib/foundation-e2e-limiter.mjs";
import { testFixtureSecretFindings } from "./lib/test-fixture-secrets.mjs";
import { createCloudflareStartupFixture } from "./lib/cloudflare-startup-fixture.mjs";
import {
  IDEMPOTENCY_HEADER,
  startLocalMailRelay,
  toMailCatcherMessage,
} from "./lib/foundation-e2e-mail-relay.mjs";
import {
  breachCheckReply,
  classifyOutbound,
  installOutboundGuard,
} from "./lib/foundation-e2e-outbound-guard.mjs";
import { getPwnedPasswordCount } from "../src/lib/security/pwned-passwords.ts";
import { TEST_COPY_CHECKOUT, testCopyCheckout } from "../src/lib/payments/checkout-origins.ts";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EOL, tmpdir } from "node:os";
import path from "node:path";

const API = "http://127.0.0.1:55443";
const DB = "postgresql://postgres:postgres@127.0.0.1:55452/postgres";
const refused = /Foundation test copy refused/;

test("the local throwaway stack is accepted", () => {
  assert.equal(assertLocalFoundationTarget({ apiUrl: API, dbUrl: DB }), API);
  assert.equal(
    assertLocalFoundationTarget({
      apiUrl: API,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: API,
        FOUNDATION_SUPABASE_URL: API,
        FOUNDATION_PROJECT_REF: "local-foundation",
        ENVIRONMENT: "test",
      },
    }),
    API
  );
});

for (const [label, apiUrl] of [
  ["production London project", "https://gntzjtuncsyefujajmjy.supabase.co"],
  ["any hosted Supabase project", "https://abcdefghijklmnopqrst.supabase.co"],
  ["hosted Supabase over http", "http://abcdefghijklmnopqrst.supabase.co:55443"],
  ["a LAN address", "http://192.168.1.20:55443"],
  ["a public host", "http://example.com:55443"],
  ["a loopback-looking host name", "http://127.0.0.1.example.com:55443"],
  ["another local port", "http://127.0.0.1:55441"],
  ["the default CLI port", "http://127.0.0.1:54321"],
  ["https on loopback", "https://127.0.0.1:55443"],
  ["credentials in the URL", "http://user:pass@127.0.0.1:55443"],
  ["user info before another host", "http://127.0.0.1:55443@evil"],
  ["a look-alike host", "http://127.0.0.1:55443.evil"],
  ["a production ref in the path", "http://127.0.0.1:55443/gntzjtuncsyefujajmjy"],
  ["a query string", "http://127.0.0.1:55443/?target=remote"],
  ["localhost (the website accepts only 127.0.0.1)", "http://localhost:55443"],
  ["a malformed value", "not a url"],
  ["an empty value", ""],
  ["no value", undefined],
]) {
  test(`the API address is refused: ${label}`, () => {
    assert.throws(() => assertLocalFoundationTarget({ apiUrl }), refused);
  });
}

for (const [label, dbUrl] of [
  [
    "a hosted pooler",
    "postgresql://postgres.gntzjtuncsyefujajmjy:x@aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
  ],
  [
    "a hosted direct host",
    "postgresql://postgres:x@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
  ],
  ["another machine", "postgresql://postgres:postgres@10.0.0.5:55452/postgres"],
  ["the native fixture database", "postgresql://postgres:postgres@127.0.0.1:55442/postgres"],
  ["an http address", "http://127.0.0.1:55452/postgres"],
]) {
  test(`the database address is refused: ${label}`, () => {
    assert.throws(() => assertLocalFoundationTarget({ apiUrl: API, dbUrl }), refused);
  });
}

for (const [label, env] of [
  ["a hosted public URL", { NEXT_PUBLIC_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co" }],
  ["a hosted server URL", { FOUNDATION_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }],
  ["the production project ref", { FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy" }],
  ["the retired project ref", { FOUNDATION_PROJECT_REF: "tnygdgormnofpgjknlhr" }],
  [
    "a remote database URL",
    { DATABASE_URL: "postgresql://postgres:x@db.example.com:5432/postgres" },
  ],
  ["production mode", { ENVIRONMENT: "production" }],
]) {
  test(`the website environment is refused: ${label}`, () => {
    assert.throws(() => assertLocalFoundationTarget({ apiUrl: API, env }), refused);
  });
}

test("refusals never echo the refused value", () => {
  try {
    assertLocalFoundationTarget({ apiUrl: "https://SECRETVALUE.supabase.co" });
    assert.fail("expected a refusal");
  } catch (error) {
    assert.equal(String(error.message).includes("SECRETVALUE"), false);
  }
});

test("every known hosted ref is refused wherever it appears", () => {
  for (const ref of HOSTED_PROJECT_REFS)
    assert.throws(
      () =>
        assertLoopbackUrl(`http://127.0.0.1:55443/#${ref}`, { what: "x", protocols: ["http:"] }),
      refused
    );
});

test("the workspace copy keeps the database/foundation replay order", () => {
  const { steps } = replaySteps();
  const names = replayMigrationNames(steps);
  assert.equal(names[0].file, "database/foundation/candidate.sql");
  assert.equal(
    names.some((step) => step.label === "platform-prelude.sql"),
    false
  );
  const supplement = names.findIndex((step) => step.label === "baseline-supplement.sql");
  assert.equal(names[supplement + 1].label, "20261103154538_owner_signup_access.sql");
  assert.equal(names[supplement].name, "20261103154537_replay_baseline_supplement.sql");
  assert.equal(names.length, steps.length - 1);
  for (const step of names) assert.match(step.file, /^database\/foundation\//);
  assert.deepEqual(
    names.map((step) => step.name),
    [...names.map((step) => step.name)].sort()
  );
  assert.throws(
    () => replayMigrationNames([...steps, { label: "../../supabase/migrations/x.sql" }]),
    /Unexpected replay step/
  );
});

test("the website runs in foundation mode against the copy only, with the existing test switches", () => {
  const status = {
    apiUrl: API,
    publishableKey: "sb_publishable_local_fixture",
    secretKey: "sb_secret_local_fixture_value_000000",
  };
  const saved = { ...process.env };
  try {
    // Inherited settings that point elsewhere are dropped, never forwarded.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://gntzjtuncsyefujajmjy.supabase.co";
    process.env.SUPABASE_URL = "https://gntzjtuncsyefujajmjy.supabase.co";
    process.env.FOUNDATION_PROJECT_REF = "gntzjtuncsyefujajmjy";
    process.env.PLAYWRIGHT_E2E_AUTH = "1";
    process.env.OZOW_CLIENT_SECRET = "caller-provider-secret";
    process.env.SENTRY_DSN = "https://caller@example.invalid/1";
    // The caller cannot open paid add-on sales in the copy: production keeps them paused.
    process.env.ADDON_SALES_ENABLED = "true";
    // An empty folder: no .env files to neutralise in this test.
    const env = foundationWebsiteEnv(status, {
      root: mkdtempSync(path.join(tmpdir(), "vm-noenv-")),
    });
    assert.equal(env.NEXT_PUBLIC_DATA_BACKEND, undefined);
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, API);
    assert.equal(env.FOUNDATION_SUPABASE_URL, API);
    assert.equal(env.FOUNDATION_PROJECT_REF, E2E_FIXTURE.projectRef);
    assert.equal(env.SUPABASE_URL, undefined);
    assert.equal(env.PLAYWRIGHT_E2E_AUTH, undefined);
    assert.equal(env.OZOW_CLIENT_SECRET, undefined);
    assert.equal(env.SENTRY_DSN, undefined);
    assert.equal(env.ADDON_SALES_ENABLED, "false");
    assert.equal(env.PLAYWRIGHT_SUPABASE_MODE, undefined);
    assert.equal(env.NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE, undefined);
    // Reused switches from scripts/start-playwright-server.cjs.
    assert.equal(env.ENVIRONMENT, "test");
    assert.equal(env.VERIFYMZANSI_RUNTIME_MODE, "e2e");
    assert.equal(env.PLAYWRIGHT_TEST_MODE, "1");
    assert.equal(env.ENABLE_MOCK_OZOW, "true");
    assert.equal(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, "dummy_site_key");
    assert.equal(env.NEXT_PUBLIC_APP_URL, "http://127.0.0.1:3110");
    assert.throws(
      () => foundationWebsiteEnv({ ...status, apiUrl: "https://x.supabase.co" }),
      refused
    );
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

const LOCAL_STATUS = {
  apiUrl: API,
  publishableKey: "sb_publishable_local_fixture",
  secretKey: "sb_secret_local_fixture_value_000000",
};

// Hostile .env files, as a developer machine may hold: hosted URLs, the
// production limiter and provider keys. Synthetic values only.
const HOSTILE = {
  ".env.production.local": [
    "OTP_RATE_LIMITER_URL=https://limiter.example.invalid",
    "RATE_LIMITER_API_KEY=hostile-limiter-key",
    "FOUNDATION_SUPABASE_URL=https://gntzjtuncsyefujajmjy.supabase.co",
    "FOUNDATION_PHONE_OTP_KEY=hostile-otp-key",
  ],
  ".env.local": [
    "export OZOW_CLIENT_ID=hostile-ozow-client",
    "OZOW_CLIENT_SECRET = hostile-ozow-secret",
    "PAYFAST_MERCHANT_KEY=hostile-payfast",
    "NEXT_PUBLIC_SUPABASE_URL=https://gntzjtuncsyefujajmjy.supabase.co",
    "SUPABASE_URL=https://gntzjtuncsyefujajmjy.supabase.co",
    "PLAYWRIGHT_E2E_AUTH=1",
  ],
  ".env": [
    "RESEND_API_KEY=re_hostile",
    "RESEND_BASE_URL=https://mail.example.invalid",
    "OPS_JOBS_SECRET=hostile-ops-jobs-secret-0123456789abcdef",
    "SENTRY_DSN=https://hostile@example.invalid/1",
  ],
};

test("no value from .env files reaches the website, as Next loads them", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vm-env-"));
  try {
    for (const [file, lines] of Object.entries(HOSTILE))
      writeFileSync(path.join(dir, file), lines.map((line) => `${line}${EOL}`).join(""));
    assert.deepEqual(
      [...envFileKeyNames(dir)].sort(),
      Object.values(HOSTILE)
        .flat()
        .map((line) =>
          line
            .replace(/^export /, "")
            .split("=")[0]
            .trim()
        )
        .sort()
    );
    // Hermetic: the caller's own environment must not already hold these keys.
    const names = [...envFileKeyNames(dir)];
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
    let env;
    try {
      env = foundationWebsiteEnv(LOCAL_STATUS, { root: dir });
    } finally {
      for (const [name, value] of Object.entries(saved))
        if (value !== undefined) process.env[name] = value;
    }
    const nextEnv = createRequire(import.meta.url).resolve("@next/env");
    // A fresh process, as `next build` / `next start` load env files at startup.
    const probe = spawnSync(
      process.execPath,
      [
        "-e",
        `require(${JSON.stringify(nextEnv)}).loadEnvConfig(${JSON.stringify(dir)}, false, { info() {}, error() {} });` +
          "process.stdout.write(JSON.stringify(process.env));",
      ],
      { env: { ...env, NODE_ENV: "production" }, encoding: "utf8" }
    );
    assert.equal(probe.status, 0, probe.stderr);
    const loaded = JSON.parse(probe.stdout);
    for (const value of Object.values(loaded))
      assert.equal(/hostile|supabase\.co|example\.invalid|re_hostile/.test(String(value)), false);
    assert.equal(loaded.FOUNDATION_SUPABASE_URL, API);
    assert.equal(loaded.NEXT_PUBLIC_SUPABASE_URL, API);
    assert.equal(loaded.OTP_RATE_LIMITER_URL, "http://127.0.0.1:55456/check");
    assert.equal(loaded.RATE_LIMITER_API_KEY, LOCAL_LIMITER_KEY);
    assert.equal(loaded.OZOW_CLIENT_SECRET, "");
    assert.equal(loaded.PLAYWRIGHT_E2E_AUTH, "");
    assert.equal(loaded.RESEND_BASE_URL, LOCAL_MAIL_RELAY_URL);
    assert.equal(loaded.RESEND_API_KEY, LOCAL_MAIL_RELAY_KEY);
    assert.equal(loaded.OPS_JOBS_SECRET, LOCAL_OPS_JOBS_SECRET);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("inherited settings in any letter case never reach the website (Windows reads names case-insensitively)", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      Ozow_Client_Id: "caller-ozow-client",
      ozow_client_secret: "caller-ozow-secret",
      Ozow_Api_Base_Url: "https://proxy.example.invalid",
      Ozow_Site_Code: "caller-site-code",
      Ozow_Env: "production",
      Ozow_Payment_Oauth_Scope: "caller-scope",
      Supabase_Url: "https://gntzjtuncsyefujajmjy.supabase.co",
      Foundation_Project_Ref: "gntzjtuncsyefujajmjy",
      Kyc_Provider: "stub",
      Environment: "production",
    });
    const env = foundationWebsiteEnv(LOCAL_STATUS, {
      root: mkdtempSync(path.join(tmpdir(), "vm-noenv-")),
    });
    const spellings = (name) => Object.entries(env).filter(([key]) => key.toUpperCase() === name);
    for (const name of [
      "OZOW_CLIENT_ID",
      "OZOW_CLIENT_SECRET",
      "OZOW_PAYMENT_OAUTH_SCOPE",
      "SUPABASE_URL",
    ])
      assert.deepEqual(spellings(name), [], name);
    assert.deepEqual(spellings("OZOW_ENV"), [["OZOW_ENV", "staging"]]);
    assert.deepEqual(spellings("OZOW_SITE_CODE"), [["OZOW_SITE_CODE", LOCAL_OZOW_SITE_CODE]]);
    assert.deepEqual(spellings("OZOW_API_BASE_URL"), [
      ["OZOW_API_BASE_URL", "https://stagingone.ozow.com"],
    ]);
    assert.deepEqual(spellings("FOUNDATION_PROJECT_REF"), [
      ["FOUNDATION_PROJECT_REF", E2E_FIXTURE.projectRef],
    ]);
    assert.deepEqual(spellings("KYC_PROVIDER"), [["KYC_PROVIDER", "manual"]]);
    assert.deepEqual(spellings("ENVIRONMENT"), [["ENVIRONMENT", "test"]]);
    for (const value of Object.values(env))
      assert.equal(/caller-|proxy\.example|gntzjtuncsyefujajmjy/.test(String(value)), false);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("the target guard reads setting names in any letter case", () => {
  for (const env of [
    { Supabase_Url: "https://gntzjtuncsyefujajmjy.supabase.co" },
    { next_public_supabase_url: "http://127.0.0.1:55441" },
    { Foundation_Project_Ref: "gntzjtuncsyefujajmjy" },
    { Database_Url: "postgresql://postgres@db.example.invalid:5432/postgres" },
    { Environment: "production" },
    { ENVIRONMENT: "Production" },
  ])
    assert.throws(() => assertLocalFoundationTarget({ apiUrl: API, env }), refused);
});

test(".env names spelled in another case are blanked or left to the copy's own value", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vm-env-case-"));
  try {
    writeFileSync(
      path.join(dir, ".env.local"),
      ["ozow_client_id=hostile-lower", "Ozow_Env=production", "node_env=development"]
        .map((line) => `${line}${EOL}`)
        .join("")
    );
    const saved = Object.fromEntries(
      ["ozow_client_id", "Ozow_Env", "node_env"].map((name) => [name, process.env[name]])
    );
    let env;
    try {
      for (const name of Object.keys(saved)) delete process.env[name];
      env = foundationWebsiteEnv(LOCAL_STATUS, { root: dir });
    } finally {
      for (const [name, value] of Object.entries(saved))
        if (value !== undefined) process.env[name] = value;
    }
    assert.equal(env.ozow_client_id, "");
    assert.equal(env.Ozow_Env, "");
    assert.equal(env.OZOW_ENV, "staging");
    assert.equal("node_env" in env, false);
    const nextEnv = createRequire(import.meta.url).resolve("@next/env");
    const probe = spawnSync(
      process.execPath,
      [
        "-e",
        `require(${JSON.stringify(nextEnv)}).loadEnvConfig(${JSON.stringify(dir)}, false, { info() {}, error() {} });` +
          "process.stdout.write(JSON.stringify({ozow: process.env.OZOW_CLIENT_ID ?? null, env: process.env.OZOW_ENV, all: Object.values(process.env).join(' ')}));",
      ],
      { env: { ...env, NODE_ENV: "production" }, encoding: "utf8" }
    );
    assert.equal(probe.status, 0, probe.stderr);
    const loaded = JSON.parse(probe.stdout);
    assert.equal(/hostile/.test(loaded.all), false);
    assert.equal(loaded.env, "staging");
    assert.notEqual(loaded.ozow, "hostile-lower");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("serving refuses a .next folder not built for the copy", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vm-build-"));
  try {
    const env = foundationWebsiteEnv(LOCAL_STATUS, { root: dir });
    mkdirSync(path.join(dir, ".next", "static", "chunks"), { recursive: true });
    const chunk = path.join(dir, ".next", "static", "chunks", "app.js");
    writeFileSync(chunk, `const k="${LOCAL_STATUS.publishableKey}";`);
    // No stamp: a normal build (which deletes .next) never carries one.
    assert.throws(() => assertBuildIsCopy(env, dir), /not a test copy build/);
    writeBuildStamp(env, dir);
    assert.doesNotThrow(() => assertBuildIsCopy(env, dir));
    assert.equal(
      path.join(dir, BUILD_STAMP).endsWith(path.join(".next", "foundation-e2e-stamp.json")),
      true
    );
    // Other settings at build time.
    assert.throws(
      () => assertBuildIsCopy({ ...env, NEXT_PUBLIC_APP_URL: "https://verifymzansi.com" }, dir),
      /other settings/
    );
    // A hosted project or a foreign key inlined in the client bundle.
    for (const inlined of [
      "https://gntzjtuncsyefujajmjy.supabase.co",
      "sb_publishable_0therProjectKey",
    ]) {
      writeFileSync(chunk, `const u="${inlined}";`);
      assert.throws(() => assertBuildIsCopy(env, dir), /client bundle names hosted settings/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the copy's website settings switch on test checkout at exactly the copy's addresses", () => {
  // The website's guard (src/lib/payments/checkout-origins.ts) and the copy
  // must name the same addresses, and the copy's settings must satisfy it.
  assert.deepEqual(TEST_COPY_CHECKOUT, {
    appOrigin: E2E_APP_URL,
    databaseUrl: API,
    mockPaymentOrigin: `https://127.0.0.1:${E2E_FIXTURE.mockPaymentPort}`,
    providerOrigin: `http://127.0.0.1:${E2E_FIXTURE.providerPort}`,
  });
  const env = foundationWebsiteEnv(LOCAL_STATUS, {
    root: mkdtempSync(path.join(tmpdir(), "vm-noenv-")),
  });
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env, { NODE_ENV: "production" });
    assert.equal(testCopyCheckout(), TEST_COPY_CHECKOUT);
    process.env.ENVIRONMENT = "production";
    assert.equal(testCopyCheckout(), null);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  // Nothing else in the copy uses the mock payment, provider or limiter ports.
  const ports = [
    E2E_FIXTURE.apiPort,
    E2E_FIXTURE.dbPort,
    E2E_FIXTURE.mailPort,
    E2E_FIXTURE.appPort,
    E2E_FIXTURE.limiterPort,
    E2E_FIXTURE.mockPaymentPort,
    E2E_FIXTURE.mailRelayPort,
    E2E_FIXTURE.providerPort,
  ];
  assert.equal(new Set(ports).size, ports.length);
  assert.equal(LOCAL_LIMITER_URL, `http://127.0.0.1:${E2E_FIXTURE.limiterPort}/check`);
});

test("the local limiter stub allows well-formed requests on loopback only", async () => {
  const server = await startLocalLimiter({ port: 0, apiKey: LOCAL_LIMITER_KEY });
  try {
    const address = server.address();
    assert.equal(address.address, "127.0.0.1");
    const url = `http://127.0.0.1:${address.port}`;
    const call = (pathname, init = {}) =>
      fetch(`${url}${pathname}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOCAL_LIMITER_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: "account:ip", action: "billing:checkout" }),
        ...init,
      });
    const allowed = await call("/check");
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { allowed: true });
    assert.equal(
      (await call("/check", { headers: { Authorization: "Bearer wrong" } })).status,
      401
    );
    assert.equal((await call("/other")).status, 404);
    assert.equal((await call("/check", { method: "GET", body: undefined })).status, 405);
    assert.equal((await call("/check", { body: "{" })).status, 400);
    assert.equal((await call("/check", { body: JSON.stringify({ key: 1 }) })).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.throws(() => startLocalLimiter({ port: 1, apiKey: "short" }), /Invalid limiter key/);
});

test("the copy's website emails go to the local relay, never the provider", () => {
  const saved = { ...process.env };
  try {
    // A caller's own provider address and keys are replaced, not forwarded.
    process.env.RESEND_BASE_URL = "https://api.resend.com";
    process.env.Resend_Api_Key = "re_caller_key";
    process.env.OPS_JOBS_SECRET = "caller-ops-jobs-secret-0123456789abcdef";
    const env = foundationWebsiteEnv(LOCAL_STATUS, {
      root: mkdtempSync(path.join(tmpdir(), "vm-noenv-")),
    });
    assert.equal(env.RESEND_BASE_URL, `http://127.0.0.1:${E2E_FIXTURE.mailRelayPort}`);
    assert.equal(env.RESEND_API_KEY, LOCAL_MAIL_RELAY_KEY);
    assert.equal(env.Resend_Api_Key, undefined);
    assert.equal(env.OPS_JOBS_SECRET, LOCAL_OPS_JOBS_SECRET);
    // The website's job route refuses secrets shorter than 32 characters.
    assert.ok(LOCAL_OPS_JOBS_SECRET.length >= 32);
    // The website's env schema: the provider key must look like one.
    assert.match(LOCAL_MAIL_RELAY_KEY, /^re_/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("the copy's notification and status-check secrets are its own synthetic ones", () => {
  const saved = { ...process.env };
  try {
    // A caller's own values are replaced, not forwarded (in any letter case).
    process.env.OZOW_WEBHOOK_SECRET = "caller-webhook-value";
    process.env.Internal_Jobs_Secret = "caller-internal-jobs-value";
    const env = foundationWebsiteEnv(LOCAL_STATUS, {
      root: mkdtempSync(path.join(tmpdir(), "vm-noenv-")),
    });
    assert.equal(env.OZOW_WEBHOOK_SECRET, LOCAL_OZOW_WEBHOOK_SECRET);
    assert.equal(env.INTERNAL_JOBS_SECRET, LOCAL_INTERNAL_JOBS_SECRET);
    assert.equal(env.Internal_Jobs_Secret, undefined);
    assert.equal(env.OZOW_SITE_CODE, LOCAL_OZOW_SITE_CODE);
    // The signing library's form (whsec_ and 32 bytes in base64), derived at
    // runtime from a public label; the job secret is 64 hex characters.
    assert.match(LOCAL_OZOW_WEBHOOK_SECRET, /^whsec_[A-Za-z0-9+/]{43}=$/);
    assert.equal(Buffer.from(LOCAL_OZOW_WEBHOOK_SECRET.slice(6), "base64").length, 32);
    assert.match(LOCAL_INTERNAL_JOBS_SECRET, /^[a-f0-9]{64}$/);
    assert.notEqual(LOCAL_INTERNAL_JOBS_SECRET, LOCAL_OPS_JOBS_SECRET);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("the production launch check refuses the test suites' secrets", () => {
  // Production-shaped settings with fresh random values: nothing to refuse.
  const production = createCloudflareStartupFixture();
  assert.deepEqual(testFixtureSecretFindings(production), []);
  const require = createRequire(import.meta.url);
  const stub = require("./start-playwright-server.cjs").createDeterministicEnv();
  const cases = [
    ["OZOW_WEBHOOK_SECRET", LOCAL_OZOW_WEBHOOK_SECRET],
    ["OZOW_WEBHOOK_SECRET", stub.OZOW_WEBHOOK_SECRET],
    ["INTERNAL_JOBS_SECRET", LOCAL_INTERNAL_JOBS_SECRET],
    ["OPS_JOBS_SECRET", LOCAL_OPS_JOBS_SECRET],
    ["FOUNDATION_PHONE_OTP_KEY", LOCAL_PHONE_OTP_KEY],
    ["ID_ENCRYPTION_KEY", LOCAL_ID_ENCRYPTION_KEY],
    // Under another name, or with stray spaces, it is still refused.
    ["KYC_WEBHOOK_SECRET", ` ${LOCAL_INTERNAL_JOBS_SECRET} `],
  ];
  for (const [name, value] of cases)
    assert.deepEqual(testFixtureSecretFindings({ ...production, [name]: value }), [name], name);
  // The validator runs the check in production mode and fails on a finding.
  const source = readFileSync("scripts/validate-launch-env.ts", "utf8");
  assert.ok(source.includes('mode === "production" ? testFixtureSecretFindings(process.env) : []'));
  assert.ok(source.includes("if (!summary.isValid || schemaError || testSecrets.length > 0)"));
});

test("the relay translates provider requests and keeps mail on the reserved .test domain", () => {
  const key = "foundation-outbox/0b4a9d2e-0000-4000-8000-000000000001";
  const ok = toMailCatcherMessage(
    {
      from: "VerifyMzansi <noreply@verifymzansi.com>",
      to: "seller@verifymzansi.test",
      reply_to: "support@verifymzansi.com",
      subject: "New enquiry",
      html: "<p>Hi</p>",
      text: "Hi",
    },
    key
  );
  assert.deepEqual(ok, {
    ok: true,
    message: {
      From: { Email: "noreply@verifymzansi.com", Name: "VerifyMzansi" },
      To: [{ Email: "seller@verifymzansi.test" }],
      ReplyTo: [{ Email: "support@verifymzansi.com" }],
      Subject: "New enquiry",
      Text: "Hi",
      HTML: "<p>Hi</p>",
      Headers: { [IDEMPOTENCY_HEADER]: key },
    },
  });
  const base = { from: "noreply@verifymzansi.com", to: "a@verifymzansi.test", subject: "S" };
  const attempt = (body, idempotencyKey) =>
    toMailCatcherMessage({ ...base, ...body }, idempotencyKey);
  assert.deepEqual(attempt({ to: "someone@gmail.com" }), {
    ok: false,
    reason: "recipient outside the copy",
  });
  assert.equal(attempt({ to: ["a@verifymzansi.test", "b@example.com"] }).ok, false);
  assert.equal(attempt({ to: "a@verifymzansi.test.example.com" }).ok, false);
  assert.equal(attempt({ to: [] }).ok, false);
  assert.equal(attempt({ from: "not an address" }).ok, false);
  assert.equal(attempt({ bcc: "x@verifymzansi.test" }).ok, false);
  assert.equal(attempt({ subject: "" }).ok, false);
  assert.equal(attempt({ html: 5 }).ok, false);
  assert.equal(attempt({}, "bad key, X-Injected: 1").ok, false);
  assert.equal(toMailCatcherMessage(null).ok, false);
});

test("the local relay answers like the provider and hands mail only to the local catcher", async () => {
  assert.throws(
    () =>
      startLocalMailRelay({
        port: 0,
        apiKey: LOCAL_MAIL_RELAY_KEY,
        mailOrigin: "https://mail.example.com",
      }),
    refused
  );
  assert.throws(
    () => startLocalMailRelay({ port: 0, apiKey: "short", mailOrigin: "http://127.0.0.1:1" }),
    /Invalid relay key/
  );
  const sent = [];
  let catcherStatus = 200;
  const server = await startLocalMailRelay({
    port: 0,
    apiKey: LOCAL_MAIL_RELAY_KEY,
    mailOrigin: `http://127.0.0.1:${E2E_FIXTURE.mailPort}`,
    fetchImpl: async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify(catcherStatus === 200 ? { ID: "abc12345XYZ" } : {}), {
        status: catcherStatus,
      });
    },
  });
  try {
    const address = server.address();
    assert.equal(address.address, "127.0.0.1");
    const call = (pathname, init = {}) =>
      fetch(`http://127.0.0.1:${address.port}${pathname}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOCAL_MAIL_RELAY_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "foundation-outbox/1",
        },
        body: JSON.stringify({
          from: "VerifyMzansi <noreply@verifymzansi.com>",
          to: "seller@verifymzansi.test",
          subject: "New enquiry",
          text: "Hi",
        }),
        ...init,
      });
    const accepted = await call("/emails");
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { id: "abc12345XYZ" });
    assert.deepEqual(sent, [
      {
        url: `http://127.0.0.1:${E2E_FIXTURE.mailPort}/api/v1/send`,
        body: {
          From: { Email: "noreply@verifymzansi.com", Name: "VerifyMzansi" },
          To: [{ Email: "seller@verifymzansi.test" }],
          Subject: "New enquiry",
          Text: "Hi",
          Headers: { [IDEMPOTENCY_HEADER]: "foundation-outbox/1" },
        },
      },
    ]);
    const wrongKey = await call("/emails", {
      headers: { Authorization: "Bearer re_wrong", "Content-Type": "application/json" },
    });
    assert.equal(wrongKey.status, 401);
    assert.equal((await call("/emails/batch")).status, 404);
    assert.equal((await call("/emails", { method: "GET", body: undefined })).status, 405);
    assert.equal((await call("/emails", { body: "{" })).status, 422);
    const outside = await call("/emails", {
      body: JSON.stringify({ from: "a@verifymzansi.com", to: "x@gmail.com", subject: "S" }),
    });
    assert.equal(outside.status, 422);
    catcherStatus = 500;
    const failed = await call("/emails");
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).name, "application_error");
    // Refused requests never reached the catcher; the failed one did.
    assert.equal(sent.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("hosted markers are found, the local key is not", () => {
  assert.deepEqual(hostedMarkersIn("x sb_publishable_local y", "sb_publishable_local"), []);
  assert.deepEqual(hostedMarkersIn("https://abcdefghijklmnopqrst.supabase.co/rest", "k"), [
    "abcdefghijklmnopqrst.supabase.co",
  ]);
});

test("the copy's phone-code and ID-number keys have the shape the website requires", async () => {
  const saved = { ...process.env };
  try {
    process.env.FOUNDATION_PHONE_OTP_KEY = "caller-phone-otp-key";
    process.env.ID_ENCRYPTION_KEY = "b".repeat(64);
    const env = foundationWebsiteEnv(LOCAL_STATUS, {
      root: mkdtempSync(path.join(tmpdir(), "vm-noenv-")),
    });
    assert.equal(env.FOUNDATION_PHONE_OTP_KEY, LOCAL_PHONE_OTP_KEY);
    assert.equal(env.ID_ENCRYPTION_KEY, LOCAL_ID_ENCRYPTION_KEY);
    // The website refuses keys that are not 64 hex characters with at least 8
    // distinct digits (verification-runtime.ts, phone-verification.ts).
    for (const key of [LOCAL_PHONE_OTP_KEY, LOCAL_ID_ENCRYPTION_KEY]) {
      assert.match(key, /^[a-f0-9]{64}$/);
      assert.ok(new Set(key).size >= 8);
    }
    assert.notEqual(LOCAL_PHONE_OTP_KEY, LOCAL_ID_ENCRYPTION_KEY);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("the outbound fence passes loopback, answers the breach check and refuses everything else", () => {
  const cases = {
    "http://127.0.0.1:55443/rest/v1/rpc/x": "local",
    "http://localhost:3110/api/health": "local",
    "http://[::1]:55451/emails": "local",
    "https://api.pwnedpasswords.com/range/ABCDE": "breach-check",
    "https://api.pwnedpasswords.com/range/abcde": "breach-check",
    "https://api.pwnedpasswords.com/range/ABCDEF": "blocked",
    "https://api.pwnedpasswords.com/range/ABCDE?x=1": "blocked",
    "https://api.pwnedpasswords.com:8443/range/ABCDE": "blocked",
    "http://api.pwnedpasswords.com/range/ABCDE": "blocked",
    "https://api.africastalking.com/version1/messaging": "blocked",
    "https://api.sandbox.africastalking.com/version1/messaging": "blocked",
    "https://api.resend.com/emails": "blocked",
    "https://stagingone.ozow.com/": "blocked",
    "https://gntzjtuncsyefujajmjy.supabase.co/rest/v1/": "blocked",
    "https://127.0.0.1.example.com/": "blocked",
    "http://user:pass@127.0.0.1:3110/": "blocked",
    "file:///etc/passwd": "blocked",
    "/relative/path": "blocked",
    "not a url": "blocked",
  };
  for (const [href, expected] of Object.entries(cases))
    assert.equal(classifyOutbound(href), expected, href);
});

test("the outbound fence forwards only loopback requests and records the others by origin", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "vm-fence-"));
  const saved = globalThis.fetch;
  const forwarded = [];
  try {
    const guarded = installOutboundGuard({
      root,
      fetchImpl: async (input) => {
        forwarded.push(String(input));
        return new Response("ok");
      },
    });
    assert.equal(globalThis.fetch, guarded);
    assert.equal(await (await fetch(new URL("/api/health", E2E_APP_URL))).text(), "ok");
    assert.equal(await (await fetch(new URL("http://localhost:55443/x"))).text(), "ok");
    // The website's real breach-check parser reads the stand-in reply as "not found".
    assert.equal(await getPwnedPasswordCount("Local-fixture-password-0"), 0);
    // Except the one known-breached test password, which the copy refuses.
    assert.equal(await getPwnedPasswordCount(KNOWN_BREACHED_PASSWORD), 1000);
    await assert.rejects(
      fetch("https://api.africastalking.com/version1/messaging?secret=1", { method: "POST" }),
      TypeError
    );
    await assert.rejects(fetch(new Request("https://api.resend.com/emails")), TypeError);
    assert.deepEqual(forwarded, [`${E2E_APP_URL}/api/health`, "http://localhost:55443/x"]);
    const log = readFileSync(path.join(root, OUTBOUND_LOG_FILE), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      log.map(({ origin, outcome }) => ({ origin, outcome })),
      [
        { origin: "https://api.pwnedpasswords.com", outcome: "answered-locally" },
        { origin: "https://api.pwnedpasswords.com", outcome: "answered-locally" },
        { origin: "https://api.africastalking.com", outcome: "blocked" },
        { origin: "https://api.resend.com", outcome: "blocked" },
      ]
    );
    // Origins only: no path, query or body is ever written.
    assert.equal(/secret|messaging|range/.test(JSON.stringify(log)), false);
    assert.equal(breachCheckReply().trim(), `${"0".repeat(35)}:0`);
  } finally {
    globalThis.fetch = saved;
    rmSync(root, { recursive: true, force: true });
  }
});

test("only the copy's website server process gets the outbound fence", () => {
  const source = readFileSync(path.join("scripts", "foundation-e2e.mjs"), "utf8");
  const preload = readFileSync(
    path.join("scripts", "lib", "foundation-e2e-outbound-preload.mjs"),
    "utf8"
  );
  assert.match(preload, /installOutboundGuard\(\);/);
  // The fence is added to the `next start` spawn only (not to builds).
  assert.equal(source.match(/--import=\$\{fence\}/g)?.length, 1);
  assert.match(source, /foundation-e2e-outbound-preload\.mjs/);
  const website = readFileSync(path.join("scripts", "lib", "foundation-e2e-website.mjs"), "utf8");
  assert.equal(/outbound/.test(website), false);
});

test("every test-copy port the kernel could hand to an outgoing connection is reserved", async () => {
  const { readFile } = await import("node:fs/promises");
  const workflow = await readFile(".github/workflows/e2e-foundation.yml", "utf8");
  const reserved = /sysctl -w net\.ipv4\.ip_local_reserved_ports=(\d+)-(\d+)/.exec(workflow);
  assert(reserved, "e2e-foundation.yml reserves the test copy's ports");
  const [low, high] = [Number(reserved[1]), Number(reserved[2])];
  // The reservation must come before anything starts.
  assert(workflow.indexOf(reserved[0]) < workflow.indexOf("foundation-e2e.mjs up"));
  const config = await readFile(E2E_FIXTURE.configTemplate, "utf8");
  const ports = [
    ...Object.entries(E2E_FIXTURE)
      .filter(([key]) => key.endsWith("Port"))
      .map(([, value]) => value),
    ...[...config.matchAll(/^\s*\w*port\s*=\s*(\d+)\s*$/gm)].map((match) => Number(match[1])),
  ];
  assert(ports.includes(E2E_FIXTURE.providerPort));
  // Linux hands out 32768-60999 by default; ports below that are never chosen.
  for (const port of ports.filter((value) => value >= 32_768 && value <= 60_999))
    assert(port >= low && port <= high, `port ${port} is outside the reserved ${low}-${high}`);
});
