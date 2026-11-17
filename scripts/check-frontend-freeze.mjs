#!/usr/bin/env node
// `pnpm check:frontend-freeze` (roadmap M0.13): the frontend the owner chose
// (commit 0b562f42, FRONTEND-RESTORE.md) may only differ where the change is
// listed in FRONTEND-CHANGES.md for the owner's decision.
//
// It fails when:
//   - a file in the restored scope differs from 0b562f42 and has no row;
//   - a listed file was edited after its row was written (Version mismatch);
//   - a row names a file that no longer differs (stale row: move it to the
//     history section, otherwise its old approval would silently cover a
//     different future change to the same file);
//   - a row is malformed or listed twice.
//
//   pnpm check:frontend-freeze                     check
//   pnpm check:frontend-freeze --update-versions   refresh the Version cells
//                                                  of rows whose file still
//                                                  differs (then review the
//                                                  row's reason and decision)
//   --no-fetch                                     never fetch 0b562f42
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BASELINE_COMMIT,
  LEDGER_FILE,
  compareLedger,
  currentVersions,
  differingPaths,
  ensureBaseline,
  parseLedger,
  refreshVersions,
} from "./lib/frontend-freeze.mjs";

const SHORT = BASELINE_COMMIT.slice(0, 8);

function main(argv) {
  const known = new Set(["--update-versions", "--no-fetch"]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    process.stderr.write(
      `Unknown argument: ${unknown.join(" ")}\nUsage: check-frontend-freeze.mjs [--update-versions] [--no-fetch]\n`
    );
    return 2;
  }
  const cwd = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const { fetched } = ensureBaseline({ cwd, fetch: !argv.includes("--no-fetch") });
  if (fetched) process.stdout.write(`Fetched the chosen frontend commit ${SHORT}.\n`);

  const differing = currentVersions({ cwd, paths: differingPaths({ cwd }) });
  const ledgerPath = path.join(cwd, LEDGER_FILE);
  let text = readFileSync(ledgerPath, "utf8");

  if (argv.includes("--update-versions")) {
    const result = refreshVersions(text, differing);
    if (result.updated.length > 0) {
      writeFileSync(ledgerPath, result.text);
      text = result.text;
      process.stdout.write(
        `Refreshed the Version of ${result.updated.length} row(s). Check each row's kind, reason and screen text; set the decision back to "awaiting owner" if visitors now see something different:\n`
      );
      for (const file of result.updated) process.stdout.write(`  - ${file}\n`);
    }
  }

  const { rows, errors } = parseLedger(text);
  const { missing, stale, changed, duplicates } = compareLedger(differing, rows);
  const awaiting = rows.filter((row) => /^awaiting owner/i.test(row.decision)).length;
  process.stdout.write(
    `${differing.size} frontend file(s) differ from ${SHORT}; ${rows.length} ledger row(s), ${awaiting} awaiting the owner's decision.\n`
  );

  const problems = [];
  for (const error of errors) problems.push(`${LEDGER_FILE} ${error}`);
  for (const row of duplicates) problems.push(`${row.path} is listed twice (line ${row.line})`);
  for (const file of missing) {
    problems.push(
      `${file} differs from ${SHORT} but has no row. Put it back (git checkout ${SHORT} -- ${file}; remove it if it is new) or add a row with decision "awaiting owner".`
    );
  }
  for (const row of changed) {
    problems.push(
      `${row.path} changed after its row was written (line ${row.line}: ${row.version}, now ${differing.get(row.path)}). Update the row, then run pnpm check:frontend-freeze --update-versions.`
    );
  }
  for (const row of stale) {
    problems.push(
      `${row.path} matches ${SHORT} again (line ${row.line}). Move its row to the "Put back" history section.`
    );
  }

  if (problems.length > 0) {
    process.stderr.write(`\nThe frontend ledger does not match the code (${problems.length}):\n`);
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    return 1;
  }
  process.stdout.write(`Every difference from ${SHORT} is listed in ${LEDGER_FILE}.\n`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`check-frontend-freeze: ${error.message}\n`);
  process.exitCode = 1;
}
