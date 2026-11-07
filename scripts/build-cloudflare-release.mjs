#!/usr/bin/env node
// Builds the production Worker without any private credential in the build's
// environment. Production secrets live on the Worker in Cloudflare and are
// never needed to compile it; CI already builds the same artifact with
// synthetic private values (scripts/prepare-cloudflare-runtime-check.mjs).
//
// The build sees the real public settings (NEXT_PUBLIC_* from wrangler.toml,
// already exported by the deploy) and synthetic, random private values that
// exist only in this process's memory. It refuses to run if a real private
// credential is present, so a workflow change cannot quietly hand secrets to
// the build and its dependencies again.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { createCloudflareStartupFixture } from "./lib/cloudflare-startup-fixture.mjs";
import { RELEASE_ONLY_CREDENTIALS, privateBuildNames } from "./lib/release-build-env.mjs";

if (process.argv.length > 2) throw new Error("Release build accepts no arguments");
if (process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("The release build runs only in GitHub Actions");
}
const fixture = createCloudflareStartupFixture({
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
const privateNames = privateBuildNames(fixture);
const leaked = [...privateNames, ...RELEASE_ONLY_CREDENTIALS].filter(
  (name) => (process.env[name] ?? "") !== ""
);
if (leaked.length > 0) {
  console.error(`::error::Private credentials must not reach the build step: ${leaked.join(", ")}`);
  process.exit(1);
}
const environment = { ...process.env };
// Non-secret runtime settings come from the production Worker's own bindings.
const productionVars = parse(readFileSync("wrangler.toml", "utf8")).env?.production?.vars ?? {};
for (const [name, value] of Object.entries(productionVars)) {
  if (typeof value === "string" && (environment[name] ?? "") === "") environment[name] = value;
}
for (const name of privateNames) environment[name] = fixture[name];
const result = spawnSync("pnpm", ["run", "build:cloudflare"], {
  stdio: "inherit",
  env: environment,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
