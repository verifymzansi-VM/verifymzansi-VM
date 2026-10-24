import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const source = readFileSync("next.config.js", "utf8");
function buildConfig(env) {
  const evaluatedModule = { exports: {} };
  runInNewContext(source, {
    module: evaluatedModule,
    process: { env },
    URL,
    require: (name) => {
      if (name === "./package.json") return { version: "synthetic-build" };
      assert.equal(name, "@sentry/nextjs/config");
      return { withSentryConfig: (config) => config };
    },
  });
  return evaluatedModule.exports;
}
const foundation = {
  NEXT_PUBLIC_DATA_BACKEND: "foundation",
  NEXT_PUBLIC_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_build_synthetic",
};
test("the backend selector is always embedded in the build, including the source default", () => {
  assert.equal(buildConfig({}).env.NEXT_PUBLIC_DATA_BACKEND, "source");
  assert.equal(buildConfig(foundation).env.NEXT_PUBLIC_DATA_BACKEND, "foundation");
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
test("invalid backend modes and malformed URLs fail without echoing supplied configuration", () => {
  assert.throws(
    () => buildConfig({ NEXT_PUBLIC_DATA_BACKEND: "typo" }),
    /Invalid NEXT_PUBLIC_DATA_BACKEND/
  );
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
  assert.equal(buildConfig(local).env.NEXT_PUBLIC_DATA_BACKEND, "foundation");
  for (const app of [undefined, "invalid", "https://verifymzansi.com", "http://localhost:3198"])
    assert.throws(
      () => buildConfig({ ...local, NEXT_PUBLIC_APP_URL: app }),
      /approved public connection/
    );
});
