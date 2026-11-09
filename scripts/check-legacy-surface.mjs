#!/usr/bin/env node
// `pnpm check:legacy-surface` (roadmap M0.11): a ratchet on code that still
// reaches for the retired ("source") backend. Production runs foundation, so
// every one of these is either dead code or a call that fails in production.
//
// It counts, in production sources under src/ and workers/ (tests excluded):
//   backendSwitches      getDataBackend() calls (old/new backend switches)
//   legacyClientImports  files importing @/lib/supabase/{admin,server,client}
//   retiredCommandNames  distinct .rpc() names that are not foundation `api`
//                        commands (database/foundation/*api-manifest.json),
//                        including names passed to .rpc(variable) wrappers
//                        that the retired supabase/migrations tree defines
//   retiredCommandCalls  .rpc("literal") call sites with such names
//   retiredTableReads    .from("table") call sites (foundation exposes no
//                        tables; Storage bucket calls are excluded)
//
// It fails when any count or list grows, and also when one shrinks without
// the baseline being lowered, so the committed numbers only ever go down.
//
//   pnpm check:legacy-surface            check against the baseline
//   pnpm check:legacy-surface --update   lower the baseline (refuses rises)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  baselineFrom,
  compareWithBaseline,
  definedFunctionNames,
  isScannedFile,
  measureLegacySurface,
  topFiles,
} from "./lib/legacy-surface.mjs";

const BASELINE_FILE = "scripts/legacy-surface-baseline.json";
const API_MANIFESTS = [
  "database/foundation/api-manifest.json",
  "database/foundation/runtime-api-manifest.json",
];
const RETIRED_MIGRATIONS = "supabase/migrations";

function gitFiles(...args) {
  return execFileSync("git", ["ls-files", ...args], { encoding: "utf8", maxBuffer: 64 << 20 })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readApiNames() {
  const names = new Set();
  for (const file of API_MANIFESTS) {
    for (const fn of JSON.parse(readFileSync(file, "utf8")).functions) names.add(fn.name);
  }
  if (names.size === 0) throw new Error("No foundation api commands found in the manifests");
  return names;
}

function readRetiredFunctionNames() {
  const sql = gitFiles(RETIRED_MIGRATIONS)
    .filter((file) => file.endsWith(".sql") && existsSync(file))
    .map((file) => readFileSync(file, "utf8"));
  const names = definedFunctionNames(sql);
  if (names.size === 0) {
    throw new Error(
      `${RETIRED_MIGRATIONS} defines no functions; update scripts/check-legacy-surface.mjs before deleting the retired tree`
    );
  }
  return names;
}

function measureRepository() {
  // Tracked plus untracked (not ignored) files, so a new file counts before it is committed.
  const files = [
    ...new Set(gitFiles("--cached", "--others", "--exclude-standard", "src", "workers")),
  ]
    .filter((file) => isScannedFile(file) && existsSync(file))
    .sort()
    .map((file) => ({ path: file, text: readFileSync(file, "utf8") }));
  return measureLegacySurface(files, {
    apiNames: readApiNames(),
    retiredFunctionNames: readRetiredFunctionNames(),
  });
}

function main(argv) {
  const update = argv.includes("--update");
  const unknown = argv.filter((arg) => arg !== "--update");
  if (unknown.length > 0) {
    process.stderr.write(
      `Unknown argument: ${unknown.join(" ")}\nUsage: check-legacy-surface.mjs [--update]\n`
    );
    return 2;
  }
  const current = measureRepository();
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  const { rises, falls } = compareWithBaseline(current, baseline);

  for (const [key, value] of Object.entries(current.counts)) {
    process.stdout.write(
      `${key.padEnd(22)} ${String(value).padStart(5)}  (baseline ${baseline.counts?.[key] ?? "none"})\n`
    );
  }

  if (rises.length > 0) {
    process.stderr.write(
      `\nNew old-backend surface. Production runs foundation: use the foundation adapters (src/lib/foundation) instead.\n`
    );
    for (const line of rises) process.stderr.write(`  - ${line}\n`);
    for (const key of ["backendSwitches", "retiredCommandCalls", "retiredTableReads"]) {
      if (rises.some((line) => line.startsWith(`${key} `))) {
        process.stderr.write(
          `  Files with most ${key}: ${topFiles(current.perFile, key).join(", ")}\n`
        );
      }
    }
    return 1;
  }

  if (falls.length > 0) {
    if (update) {
      writeFileSync(BASELINE_FILE, `${JSON.stringify(baselineFrom(current), null, 2)}\n`);
      process.stdout.write(`\nBaseline lowered (${falls.length} change(s)) in ${BASELINE_FILE}.\n`);
      return 0;
    }
    process.stderr.write(
      `\nOld-backend surface shrank. Lower the baseline so it cannot grow back: pnpm check:legacy-surface --update\n`
    );
    for (const line of falls) process.stderr.write(`  - ${line}\n`);
    return 1;
  }

  process.stdout.write("\nLegacy surface matches the baseline.\n");
  return 0;
}

process.exitCode = main(process.argv.slice(2));
