#!/usr/bin/env node
// Builds the production Worker without any private credential in the build's
// environment. Production secrets live on the Worker in Cloudflare and are
// never needed to compile it; CI already builds the same artifact with
// synthetic private values (scripts/prepare-cloudflare-runtime-check.mjs).
//
// The build runs with an environment built from an allowlist
// (scripts/lib/release-build-env.mjs): runner basics, the committed public and
// non-secret settings in wrangler.toml, and synthetic, random private values
// that exist only in this process's memory. Nothing else from the step's
// environment is passed on. It refuses to run if a real credential is in the
// step, if a public setting holds a server key, or if the step's public
// settings differ from wrangler.toml.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { createCloudflareStartupFixture } from "./lib/cloudflare-startup-fixture.mjs";
import { productionWorkerVars, releaseBuildEnvironment } from "./lib/release-build-env.mjs";

if (process.argv.length > 2) throw new Error("Release build accepts no arguments");
if (process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("The release build runs only in GitHub Actions");
}
const { problems, environment } = releaseBuildEnvironment(
  process.env,
  productionWorkerVars(parse(readFileSync("wrangler.toml", "utf8"))),
  createCloudflareStartupFixture
);
if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}
const result = spawnSync("pnpm", ["run", "build:cloudflare"], {
  stdio: "inherit",
  env: environment,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
