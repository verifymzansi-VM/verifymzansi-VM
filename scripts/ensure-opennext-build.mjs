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
import { existsSync, readFileSync } from "node:fs";
import nextEnv from "@next/env";
import { cloudflareBuildFingerprint } from "./lib/cloudflare-build-fingerprint.mjs";
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

nextEnv.loadEnvConfig(repoRoot);
let current = false;
try {
  const recorded = JSON.parse(
    readFileSync(path.join(repoRoot, ".open-next", "build-fingerprint.json"), "utf8")
  );
  current =
    recorded.schemaVersion === 1 &&
    recorded.fingerprint === cloudflareBuildFingerprint(repoRoot, process.env);
} catch {
  /* Missing or stale output always requires a fresh build. */
}
if (current && existsSync(workerBundle) && existsSync(assetsDir)) {
  console.log(
    "Worker output matches the current source and public configuration; checking credentials."
  );
  runTask("sanitize:cloudflare-env");
  runTask("secret-scan:strict");
  process.exit(0);
}

console.log("Worker output is missing or stale; running build:cloudflare.");
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
