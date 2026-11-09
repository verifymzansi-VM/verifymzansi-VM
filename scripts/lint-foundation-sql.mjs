#!/usr/bin/env node
// SQL lint gate: replays database/foundation into a throwaway, network-less
// local Postgres 17 container (the Supabase image with plpgsql_check), proves
// the replay equals fingerprint.json and the committed current/ snapshot, then
// runs plpgsql_check over every plpgsql function and compares the findings
// with database/foundation/lint-baseline.json (errors: none beyond the
// reviewed known errors; warnings: never more than the baseline).
//
//   pnpm db:foundation:lint                                check (CI)
//   pnpm db:foundation:lint -- --write-baseline            shrink the baseline
//   pnpm db:foundation:lint -- --write-baseline --accept-new
//                                                          also record new
//                                                          warnings (needs review)
//
// Needs a local Docker daemon. It takes no connection settings at all.
import { readFileSync, writeFileSync } from "node:fs";
import { FINGERPRINT_FILE, compareFingerprints, replaySteps } from "./lib/foundation-replay.mjs";
import {
  LINT_BASELINE_FILE,
  LINT_QUERY,
  LINT_STUBS_FILE,
  applySteps,
  collapseFindings,
  compareLint,
  nextLintBaseline,
  readLintBaseline,
  startLintDatabase,
} from "./lib/foundation-sql-lint.mjs";
import {
  SNAPSHOT_DIR,
  readSnapshotCatalogue,
  renderSnapshot,
  snapshotDifferences,
} from "./lib/foundation-snapshot.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const known = new Set(["--write-baseline", "--accept-new"]);
if (args.some((arg) => !known.has(arg))) throw new Error(`Unsupported argument: ${args.join(" ")}`);
const writeBaseline = args.includes("--write-baseline");
const acceptNew = args.includes("--accept-new");
if (acceptNew && !writeBaseline) throw new Error("--accept-new only applies with --write-baseline");

const CANARY = `create function internal.vm_lint_canary() returns integer language plpgsql
  set search_path = pg_catalog as $$ begin return (select vm_missing_column from private.posts limit 1); end $$;`;

const started = Date.now();
const failures = [];
const database = await startLintDatabase({ log: (line) => console.log(line) });
let raw;
try {
  const { updates, steps } = replaySteps();
  applySteps(database, steps);
  console.log(`Replayed candidate.sql and ${updates.length} updates into Postgres 17.`);

  // 1. The linted database is the gated schema.
  const fingerprint = database.psql(readFileSync("database/foundation/fingerprint.sql", "utf8"), [
    "-A",
    "-t",
    "-F",
    "\t",
  ]);
  if (fingerprint.status !== 0) throw new Error(`fingerprint.sql failed: ${fingerprint.stderr}`);
  const categories = Object.fromEntries(
    fingerprint.stdout
      .trim()
      .split("\n")
      .map((line) => line.split("\t"))
      .map(([category, items, value]) => [category, { items: Number(items), fingerprint: value }])
  );
  const recorded = JSON.parse(readFileSync(FINGERPRINT_FILE, "utf8"));
  for (const difference of compareFingerprints(recorded, { updates, categories })) {
    failures.push(`fingerprint: ${difference}`);
  }

  // 2. The committed snapshot reads the same from the production Postgres major.
  const files = renderSnapshot(await readSnapshotCatalogue(database.json));
  for (const difference of snapshotDifferences(files)) {
    failures.push(`${SNAPSHOT_DIR} (Postgres 17 render): ${difference}`);
  }

  // 3. plpgsql_check over every plpgsql function.
  applySteps(database, [
    { label: "lint-platform-stubs.sql", sql: readFileSync(LINT_STUBS_FILE, "utf8") },
    { label: "plpgsql_check", sql: "create extension plpgsql_check with schema extensions;" },
  ]);
  raw = await database.json(LINT_QUERY);

  // 4. Canary: the linter must report a deliberately broken function.
  applySteps(database, [{ label: "lint canary", sql: CANARY }]);
  const canary = await database.json(
    `select coalesce(json_agg(c.message), '[]'::json) from extensions.plpgsql_check_function_tb('internal.vm_lint_canary()'::regprocedure) c where c.level = 'error'`
  );
  if (!canary.some((message) => message.includes("vm_missing_column"))) {
    failures.push("canary: plpgsql_check did not report a deliberately broken function");
  }
} finally {
  database.stop();
}

const findings = collapseFindings(raw);
const errors = findings.filter((finding) => finding.level === "error");
const warnings = findings.filter((finding) => finding.level !== "error");
const total = (list) => list.reduce((sum, finding) => sum + finding.count, 0);
console.log(
  `plpgsql_check: ${raw.functions} functions (${raw.targets.length} checks), ${total(errors)} errors, ${total(warnings)} warnings.`
);

const baseline = readLintBaseline();
if (writeBaseline) {
  const next = nextLintBaseline(findings, baseline, { acceptNew });
  writeFileSync(LINT_BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Recorded ${total(next.warnings)} warnings in ${LINT_BASELINE_FILE}.`);
} else {
  const allowedErrors = baseline.knownErrors.length;
  console.log(
    `Baseline: ${allowedErrors} reviewed known errors, ${total(baseline.warnings)} warnings.`
  );
  for (const problem of compareLint(findings, baseline)) failures.push(`lint: ${problem}`);
}

console.log(`Finished in ${Math.round((Date.now() - started) / 1000)} s.`);
if (failures.length > 0) {
  console.error("::error::Foundation SQL lint failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "Fix the function, regenerate with `pnpm db:foundation:snapshot`, or shrink the baseline with `pnpm db:foundation:lint -- --write-baseline`."
  );
  process.exit(1);
}
console.log("Foundation SQL lint passed.");
