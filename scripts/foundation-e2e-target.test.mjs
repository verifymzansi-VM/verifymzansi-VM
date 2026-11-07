import assert from "node:assert/strict";
import { test } from "node:test";
import {
  E2E_FIXTURE,
  HOSTED_PROJECT_REFS,
  assertLocalFoundationTarget,
  assertLoopbackUrl,
  localDockerContext,
  replayMigrationNames,
} from "./lib/foundation-e2e-target.mjs";
import { replaySteps } from "./lib/foundation-replay.mjs";
import { foundationWebsiteEnv } from "./lib/foundation-e2e-website.mjs";

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

test("Docker must be this machine's engine", () => {
  const inspect = (hosts) => (name) => hosts[name];
  assert.equal(
    localDockerContext({
      platform: "win32",
      env: {},
      inspect: inspect({ "desktop-linux": "npipe:////./pipe/dockerDesktopLinuxEngine" }),
    }),
    "desktop-linux"
  );
  assert.equal(
    localDockerContext({
      platform: "linux",
      env: {},
      inspect: inspect({ default: "unix:///var/run/docker.sock" }),
    }),
    "default"
  );
  for (const [platform, env, hosts] of [
    ["win32", {}, { "desktop-linux": "tcp://10.0.0.5:2375" }],
    [
      "win32",
      { DOCKER_HOST: "tcp://10.0.0.5:2375" },
      { "desktop-linux": "npipe:////./pipe/dockerDesktopLinuxEngine" },
    ],
    ["linux", { DOCKER_HOST: "ssh://builder@remote" }, { default: "unix:///var/run/docker.sock" }],
    ["linux", { DOCKER_CONTEXT: "remote" }, { default: "unix:///var/run/docker.sock" }],
    ["linux", {}, { default: "tcp://docker.example.com:2376" }],
    ["freebsd", {}, {}],
  ])
    assert.throws(
      () => localDockerContext({ platform, env, inspect: inspect(hosts) }),
      /local engine/
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
    const env = foundationWebsiteEnv(status);
    assert.equal(env.NEXT_PUBLIC_DATA_BACKEND, "foundation");
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, API);
    assert.equal(env.FOUNDATION_SUPABASE_URL, API);
    assert.equal(env.FOUNDATION_PROJECT_REF, E2E_FIXTURE.projectRef);
    assert.equal(env.SUPABASE_URL, undefined);
    assert.equal(env.PLAYWRIGHT_E2E_AUTH, undefined);
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
