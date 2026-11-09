#!/usr/bin/env node
// Read-only: validates .github/rulesets/protect-main.json against the
// workflows and, with --live, compares it with the ruleset GitHub enforces.
// Uses the GitHub CLI's existing login; it never changes repository settings.
import { execFileSync } from "node:child_process";
import {
  availablePullRequestChecks,
  compareRulesets,
  loadRuleset,
  validateRuleset,
} from "./lib/branch-ruleset.mjs";

const REPOSITORY = "verifymzansi-VM/verifymzansi-VM";
const expected = loadRuleset();
const problems = validateRuleset(expected, availablePullRequestChecks());
if (problems.length > 0) {
  console.error("Ruleset file problems:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("Ruleset file: OK (every required check runs on pull requests to main).");

if (process.argv.includes("--live")) {
  const gh = (route) => JSON.parse(execFileSync("gh", ["api", route], { encoding: "utf8" }));
  const summaries = gh(`repos/${REPOSITORY}/rulesets`);
  const summary = summaries.find((candidate) => candidate.name === expected.name);
  if (!summary) {
    console.error(`Live: no ruleset named "${expected.name}".`);
    process.exit(1);
  }
  const live = gh(`repos/${REPOSITORY}/rulesets/${summary.id}`);
  const differences = compareRulesets(expected, live);
  if (differences.length > 0) {
    console.error(`Live ruleset ${summary.id} differs:\n- ` + differences.join("\n- "));
    process.exit(1);
  }
  console.log(`Live ruleset ${summary.id}: matches the reviewed file.`);
}
