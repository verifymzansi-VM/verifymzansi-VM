import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

// The launch-configuration test build (every hidden feature on) can only be
// made for the local browser-test copy; every production build keeps today's
// values (scripts/lib/launch-config-build.cjs).
const requireReal = createRequire(import.meta.url);
const {
  LAUNCH_CONFIG_BUILD_DEFINE,
  LAUNCH_CONFIG_SWITCH,
  assertLaunchConfigNotRequested,
  launchConfigBuild,
} = requireReal("./lib/launch-config-build.cjs");

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
      if (name === "./scripts/lib/launch-config-build.cjs")
        return requireReal("./lib/launch-config-build.cjs");
      assert.equal(name, "@sentry/nextjs/config");
      return { withSentryConfig: (config) => config };
    },
  });
  return evaluatedModule.exports;
}

/** What deploy.yml's production build sees (wrangler.toml [vars]). */
const production = {
  NODE_ENV: "production",
  ENVIRONMENT: "production",
  NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_build_synthetic",
};
const staging = {
  ...production,
  ENVIRONMENT: "staging",
  NEXT_PUBLIC_SUPABASE_URL: "https://vgplszqfcmdskwseoyam.supabase.co",
};
/** What scripts/foundation-e2e.mjs build sees. */
const localCopy = {
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_build_synthetic",
  ENVIRONMENT: "test",
  VERIFYMZANSI_RUNTIME_MODE: "e2e",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55443",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3110",
};

test("production and staging builds compile the launch configuration off", () => {
  for (const env of [production, staging, { ...production, NEXT_PRIVATE_STANDALONE: "true" }])
    for (const value of [undefined, ""]) {
      const config = buildConfig({ ...env, [LAUNCH_CONFIG_SWITCH]: value });
      // Always defined, so the compiled value is fixed: a Worker variable of
      // the same name set later cannot change it.
      assert.equal(config.env[LAUNCH_CONFIG_BUILD_DEFINE], "0");
    }
  // The ordinary local copy is off too.
  assert.equal(buildConfig(localCopy).env[LAUNCH_CONFIG_BUILD_DEFINE], "0");
});

test("a production or staging build that asks for the launch configuration fails", () => {
  for (const env of [production, staging, { ...production, NEXT_PRIVATE_STANDALONE: "true" }])
    for (const value of ["1", "true", "0", " 1"])
      assert.throws(
        () => buildConfig({ ...env, [LAUNCH_CONFIG_SWITCH]: value }),
        /only for builds of the local browser-test copy/,
        `${env.ENVIRONMENT} ${JSON.stringify(value)}`
      );
});

test("only the local browser-test copy gets the launch configuration", () => {
  assert.equal(
    buildConfig({ ...localCopy, [LAUNCH_CONFIG_SWITCH]: "1" }).env[LAUNCH_CONFIG_BUILD_DEFINE],
    "1"
  );
  for (const change of [
    // OpenNext (build:cloudflare) never, even against the local copy.
    { NEXT_PRIVATE_STANDALONE: "true" },
    { ENVIRONMENT: "production" },
    { ENVIRONMENT: undefined },
    { VERIFYMZANSI_RUNTIME_MODE: undefined },
    { NEXT_PUBLIC_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co" },
    { NEXT_PUBLIC_APP_URL: "https://verifymzansi.com" },
    { NEXT_PUBLIC_APP_URL: undefined },
    { [LAUNCH_CONFIG_SWITCH]: "true" },
  ])
    assert.throws(
      () => launchConfigBuild({ ...localCopy, [LAUNCH_CONFIG_SWITCH]: "1", ...change }),
      /only for builds of the local browser-test copy/,
      JSON.stringify(change)
    );
});

test("the Cloudflare preflight refuses the switch whatever its value", () => {
  assert.doesNotThrow(() => assertLaunchConfigNotRequested({}));
  assert.doesNotThrow(() => assertLaunchConfigNotRequested({ [LAUNCH_CONFIG_SWITCH]: "" }));
  for (const value of ["1", "0", "false"])
    assert.throws(() => assertLaunchConfigNotRequested({ [LAUNCH_CONFIG_SWITCH]: value }));
  const preflight = readFileSync("scripts/preflight-cloudflare.js", "utf8");
  assert.match(
    preflight,
    /require\("\.\/lib\/launch-config-build\.cjs"\)\.assertLaunchConfigNotRequested\(process\.env\);/
  );
});

test("the switches read only the build-time value, and next.config.js defines it once", () => {
  assert.equal(source.match(/\[LAUNCH_CONFIG_BUILD_DEFINE\]:/g)?.length, 1);
  assert.match(source, /env: buildDefines,/);
  const flag = readFileSync("src/lib/launch-config.ts", "utf8");
  assert.match(
    flag,
    /export const LAUNCH_CONFIG_BUILD: boolean = process\.env\.VERIFYMZANSI_LAUNCH_CONFIG_BUILD === "1";/
  );
  // Nothing else in the switch files reads the environment.
  for (const file of [
    "src/lib/hidden-features.ts",
    "src/lib/prelaunch-banner.ts",
    "src/lib/constants/pricing.ts",
  ])
    assert.doesNotMatch(readFileSync(file, "utf8"), /process\.env/, file);
});
