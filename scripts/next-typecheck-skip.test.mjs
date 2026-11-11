import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { parse } from "yaml";

const require = createRequire(import.meta.url);
const {
  SKIP_NEXT_TYPECHECK,
  assertNextTypecheckNotSkipped,
  shouldSkipNextTypecheck,
} = require("./lib/next-typecheck-skip.cjs");

test("Next skips its TypeScript pass only for an explicit CI opt-in", () => {
  assert.equal(shouldSkipNextTypecheck({ [SKIP_NEXT_TYPECHECK]: "1", CI: "true" }), true);
  for (const env of [
    {},
    { CI: "true" },
    { [SKIP_NEXT_TYPECHECK]: "1" },
    { [SKIP_NEXT_TYPECHECK]: "true", CI: "true" },
    { [SKIP_NEXT_TYPECHECK]: "0", CI: "true" },
    { [SKIP_NEXT_TYPECHECK]: "1", CI: "1" },
  ])
    assert.equal(shouldSkipNextTypecheck(env), false, JSON.stringify(env));
  const config = readFileSync("next.config.js", "utf8");
  assert.match(
    config,
    /typescript: \{ ignoreBuildErrors: shouldSkipNextTypecheck\(process\.env\) \}/
  );
  assert.doesNotMatch(config, /ignoreBuildErrors: true/);
});

test("a Cloudflare build refuses to start when the skip is requested", () => {
  assert.doesNotThrow(() => assertNextTypecheckNotSkipped({}));
  assert.doesNotThrow(() => assertNextTypecheckNotSkipped({ [SKIP_NEXT_TYPECHECK]: "" }));
  for (const value of ["1", "0", "true"])
    assert.throws(
      () => assertNextTypecheckNotSkipped({ [SKIP_NEXT_TYPECHECK]: value }),
      /must run Next's TypeScript check/
    );
  // build:cloudflare runs the preflight before OpenNext's `next build`.
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  const steps = scripts["build:cloudflare"].split(" && ");
  const preflight = steps.indexOf("node scripts/preflight-cloudflare.js");
  const build = steps.indexOf("pnpm exec opennextjs-cloudflare build");
  assert(preflight >= 0 && build > preflight, scripts["build:cloudflare"]);
  // The real preflight stops with the flag set (validate-only: no rewrite).
  const run = spawnSync(process.execPath, ["scripts/preflight-cloudflare.js", "--validate-only"], {
    env: { ...process.env, [SKIP_NEXT_TYPECHECK]: "1", CI: "true" },
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /must run Next's TypeScript check/);
});

test("only the browser-test and bundle builds in CI opt in; release builds never do", () => {
  for (const file of readdirSync(".github/workflows").filter((name) => name.endsWith(".yml"))) {
    const text = readFileSync(`.github/workflows/${file}`, "utf8");
    if (file !== "ci.yml") {
      assert.doesNotMatch(text, new RegExp(SKIP_NEXT_TYPECHECK), file);
      continue;
    }
    const jobs = parse(text).jobs;
    const optedIn = Object.entries(jobs)
      .filter(([, job]) => JSON.stringify(job).includes(SKIP_NEXT_TYPECHECK))
      .map(([id]) => id);
    assert.deepEqual(optedIn.sort(), ["build-e2e", "bundle-analysis"]);
    for (const id of optedIn) {
      assert.equal(jobs[id].env?.[SKIP_NEXT_TYPECHECK], "1", id);
      assert.doesNotMatch(JSON.stringify(jobs[id].steps), /build:cloudflare/, id);
    }
    assert.equal(
      jobs["lint-type-security"].steps.some((step) =>
        /--checks=[^\s]*\btypes\b/.test(step.run ?? "")
      ),
      true
    );
  }
});
