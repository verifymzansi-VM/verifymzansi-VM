#!/usr/bin/env node
// Measures the main Worker exactly as Cloudflare will: a Wrangler dry-run of
// the production deployment, which bundles the built OpenNext output and
// prints the compressed upload size. Run after `pnpm build:cloudflare`.
// It never contacts Cloudflare and needs no credentials.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  budgetFromEnvironment,
  evaluateWorkerSize,
  parseWranglerUpload,
} from "./lib/worker-size.mjs";

const outdir = mkdtempSync(path.join(tmpdir(), "vm-worker-size-"));
try {
  // Run Wrangler's own entry point with this Node binary: no shell involved.
  const wranglerPackage = createRequire(import.meta.url).resolve("wrangler/package.json");
  const wrangler = path.join(path.dirname(wranglerPackage), "bin", "wrangler.js");
  const result = spawnSync(
    process.execPath,
    [wrangler, "deploy", "--dry-run", "--env", "production", "--outdir", outdir],
    {
      encoding: "utf8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_SEND_ERROR_REPORTS: "false" },
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const upload = parseWranglerUpload(output);
  if (result.status !== 0 || !upload) {
    console.error(output.slice(-4000));
    console.error("::error::Could not measure the Worker: the Wrangler dry-run failed.");
    process.exit(1);
  }
  const verdict = evaluateWorkerSize(upload.gzipBytes, { budgetBytes: budgetFromEnvironment() });
  console.log(verdict.summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Worker size\n\n${verdict.summary}\n`);
  }
  if (verdict.lowHeadroom) {
    console.log(
      "::warning title=Worker headroom under 0.5 MB::Slimming the Worker is now the next priority."
    );
  }
  if (!verdict.ok) {
    console.error(
      "::error title=Worker over size budget::The compressed Worker is over budget. Remove or move heavy server code before releasing."
    );
    process.exit(1);
  }
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
