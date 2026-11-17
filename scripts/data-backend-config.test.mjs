import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const requireReal = createRequire(import.meta.url);

const source = readFileSync("next.config.js", "utf8");
function buildConfig(env) {
  const evaluatedModule = { exports: {} };
  runInNewContext(source, {
    module: evaluatedModule,
    process: { env },
    URL,
    require: (name) => {
      if (name === "./package.json") return { version: "synthetic-build" };
      if (name === "./scripts/lib/next-typecheck-skip.cjs")
        return requireReal("./lib/next-typecheck-skip.cjs");
      assert.equal(name, "@sentry/nextjs/config");
      return { withSentryConfig: (config) => config };
    },
  });
  return evaluatedModule.exports;
}
const foundation = {
  NEXT_PUBLIC_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_build_synthetic",
};
test("builds use the approved foundation connection and refuse missing credentials", () => {
  assert.equal(buildConfig(foundation).env.NEXT_PUBLIC_DATA_BACKEND, undefined);
  assert.equal(
    buildConfig(foundation).env.NEXT_PUBLIC_SUPABASE_URL,
    "https://gntzjtuncsyefujajmjy.supabase.co"
  );
  assert.throws(() => buildConfig({}), /approved public connection/);
});
test("a leftover backend setting other than foundation fails the build", () => {
  assert.doesNotThrow(() => buildConfig({ ...foundation, NEXT_PUBLIC_DATA_BACKEND: "foundation" }));
  for (const value of ["source", "typo", ""]) {
    for (const ENVIRONMENT of [undefined, "production", "test"])
      assert.throws(
        () => buildConfig({ ...foundation, ENVIRONMENT, NEXT_PUBLIC_DATA_BACKEND: value }),
        /retired backend has been removed/
      );
  }
  const stubFixture = {
    NEXT_PUBLIC_DATA_BACKEND: "source",
    ENVIRONMENT: "test",
    VERIFYMZANSI_RUNTIME_MODE: "e2e",
    NEXT_PUBLIC_SUPABASE_URL: "https://playwright.supabase.stub",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
    NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE: "1",
    NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE: "stub",
  };
  assert.throws(() => buildConfig(stubFixture), /retired backend has been removed/);
});
for (const [label, change] of [
  ["source project", { NEXT_PUBLIC_SUPABASE_URL: "https://tnygdgormnofpgjknlhr.supabase.co" }],
  ["another target", { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }],
  ["private key", { NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_forbidden_synthetic" }],
  [
    "credentials in URL",
    { NEXT_PUBLIC_SUPABASE_URL: "https://person:private@gntzjtuncsyefujajmjy.supabase.co" },
  ],
  ["unapproved local endpoint", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55443" }],
])
  test(`foundation build refuses ${label}`, () => {
    assert.throws(() => buildConfig({ ...foundation, ...change }), /approved public connection/);
  });
test("malformed URLs fail without echoing supplied configuration", () => {
  try {
    buildConfig({ ...foundation, NEXT_PUBLIC_SUPABASE_URL: "PRIVATE_CONFIG_VALUE" });
    assert.fail("Expected malformed URL rejection");
  } catch (error) {
    assert.equal(error.message.includes("PRIVATE_CONFIG_VALUE"), false);
  }
});

test("local foundation builds require the isolated runtime and a loopback app", () => {
  const local = {
    ...foundation,
    ENVIRONMENT: "test",
    VERIFYMZANSI_RUNTIME_MODE: "e2e",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55443",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3198",
  };
  assert.equal(buildConfig(local).env.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:55443");
  for (const app of [undefined, "invalid", "https://verifymzansi.com", "http://localhost:3198"])
    assert.throws(
      () => buildConfig({ ...local, NEXT_PUBLIC_APP_URL: app }),
      /approved public connection/
    );
});

test("Next keeps its TypeScript check unless a CI test or bundle build opts out", () => {
  assert.equal(buildConfig(foundation).typescript.ignoreBuildErrors, false);
  assert.equal(
    buildConfig({ ...foundation, VERIFYMZANSI_SKIP_NEXT_TYPECHECK: "1" }).typescript
      .ignoreBuildErrors,
    false
  );
  assert.equal(
    buildConfig({ ...foundation, VERIFYMZANSI_SKIP_NEXT_TYPECHECK: "1", CI: "true" }).typescript
      .ignoreBuildErrors,
    true
  );
});
