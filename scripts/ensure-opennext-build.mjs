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
 * The build is skipped when the artifacts are already present, so the
 * GitHub Actions deploy path (`pnpm run build:cloudflare` followed by
 * `opennextjs-cloudflare deploy`) is completely unaffected.
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
  console.log("✓ .open-next output already present — skipping OpenNext rebuild.");
  process.exit(0);
}

console.log("⚙  .open-next output missing — running `pnpm run build:cloudflare`…");
const result = spawnSync("pnpm", ["run", "build:cloudflare"], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(`Failed to launch build:cloudflare — ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
