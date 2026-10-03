#!/usr/bin/env node
/**
 * ensure-opennext-build.mjs
 *
 * Wrangler `[build]` hook — guarantees the OpenNext output (.open-next/)
 * exists before wrangler bundles and uploads the worker.
 *
 * Why: the Cloudflare Workers Builds Git integration runs a plain
 * `pnpm run build` (Next.js only), which never produces `.open-next/`.
 * `wrangler versions upload` then fails because `assets.directory`
 * (.open-next/assets) does not exist — hard error since wrangler 4.114.
 *
 * Existing artifacts still require environment sanitization and a strict
 * secret scan. Cached output must never bypass the credential policy.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerBundle = path.join(repoRoot, ".open-next", "worker.js");
const assetsDir = path.join(repoRoot, ".open-next", "assets");

// `wrangler types` only regenerates types — no bundle needed.
if ((process.env.WRANGLER_COMMAND || "") === "types") {
  console.log("⏭  Skipping OpenNext build for `wrangler types`.");
  process.exit(0);
}

if (existsSync(workerBundle) && existsSync(assetsDir)) {
  console.log("✓ .open-next output already present — checking cached artifact credentials.");
  runTask("sanitize:cloudflare-env");
  runTask("secret-scan:strict");
  process.exit(0);
}

console.log("⚙  .open-next output missing — running `pnpm run build:cloudflare`…");
function runTask(task) {
  const result = spawnSync("pnpm", ["run", task], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(`Failed to launch ${task} — ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
runTask("build:cloudflare");
