#!/usr/bin/env node
// Names the failed checks of the newest redacted native results file
// (docs/backend-foundation/evidence/native-*/results.json) for the CI job
// summary. The native suite withholds responses and credentials from its log,
// so without this a failure shows only where the run stopped. It prints only
// the fields the results file already keeps redacted: check id, status,
// stage reason, error class and SQL state; never values.
//
// Usage: node scripts/foundation-native-failure-summary.mjs [evidence-dir]

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SAFE = /^[\w .,:;()'/<>=+-]{0,200}$/;
const clean = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\|/g, "/");
  return SAFE.test(text) ? text : "(withheld)";
};

/**
 * @param {any} results parsed results.json
 * @returns {string} Markdown
 */
export function summarise(results) {
  const checks = Array.isArray(results?.checks) ? results.checks : [];
  const failed = checks.filter((check) => check?.status !== "PASS");
  const passed = checks.length - failed.length;
  const lines = ["## Foundation native: failed checks", ""];
  lines.push(
    `Status ${clean(results?.status) || "unknown"}: ${passed} passed, ${failed.length} not passed.`
  );
  if (failed.length === 0) return `${lines.join("\n")}\n`;
  const lastPassed = [...checks].reverse().find((check) => check?.status === "PASS");
  if (lastPassed) lines.push("", `Last passed check: \`${clean(lastPassed.id)}\`.`);
  lines.push(
    "",
    "| Check | Status | Where | Error class | SQL state |",
    "| --- | --- | --- | --- | --- |"
  );
  for (const check of failed) {
    lines.push(
      `| ${clean(check.id)} | ${clean(check.status)} | ${clean(check.reason)} | ${clean(check.failureCode)} | ${clean(check.sqlState)} |`
    );
  }
  return `${lines.join("\n")}\n`;
}

/** @param {string} root */
export function newestResults(root) {
  let entries = [];
  try {
    entries = readdirSync(root)
      .filter((name) => name.startsWith("native-"))
      .map((name) => path.join(root, name, "results.json"))
      .filter((file) => {
        try {
          return statSync(file).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return undefined;
  }
  return entries.sort().at(-1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.argv[2] ?? "docs/backend-foundation/evidence";
  const file = newestResults(root);
  if (!file) {
    process.stdout.write(
      "## Foundation native: failed checks\n\nNo results file: the suite stopped before recording any check (setup failed). See the job log.\n"
    );
    process.exit(0);
  }
  let results;
  try {
    results = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    process.stdout.write(
      "## Foundation native: failed checks\n\nThe results file could not be read.\n"
    );
    process.exit(0);
  }
  process.stdout.write(summarise(results));
}
