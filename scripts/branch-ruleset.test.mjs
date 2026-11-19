import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  availablePullRequestChecks,
  compareRulesets,
  loadRuleset,
  parseConditionalName,
  pullRequestCheckNames,
  requiredContexts,
  triggersOnPullRequestToMain,
  validateRuleset,
} from "./lib/branch-ruleset.mjs";

const workflow = `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  plain:
    runs-on: ubuntu-latest
  named:
    name: Duplication budget
    runs-on: ubuntu-latest
  matrixed:
    strategy:
      fail-fast: false
      matrix:
        project: [chromium, mobile-chrome] # comment
    runs-on: ubuntu-latest
  named-matrix:
    name: browser (\${{ matrix.project }})
    strategy:
      matrix:
        project: [chromium, mobile-chrome]
    runs-on: ubuntu-latest
  push-only:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
`;

test("workflow parser lists the check names a pull request produces", () => {
  assert.equal(triggersOnPullRequestToMain(workflow), true);
  assert.deepEqual(pullRequestCheckNames(workflow), [
    "plain",
    "Duplication budget",
    "matrixed (chromium)",
    "matrixed (mobile-chrome)",
    "browser (chromium)",
    "browser (mobile-chrome)",
  ]);
});

test("a workflow without a pull_request trigger offers no required checks", () => {
  const scheduled = workflow.replace("  pull_request:\n    branches: [main]\n", "");
  assert.equal(triggersOnPullRequestToMain(scheduled), false);
  const otherBranch = workflow.replace(
    "  pull_request:\n    branches: [main]",
    "  pull_request:\n    branches: [release]"
  );
  assert.equal(triggersOnPullRequestToMain(otherBranch), false);
});

test("the committed ruleset only requires checks that run on pull requests to main", () => {
  const ruleset = loadRuleset();
  const available = availablePullRequestChecks();
  assert.deepEqual(validateRuleset(ruleset, available), []);
  // The roadmap's minimum set stays required.
  for (const name of [
    "foundation-replay",
    "foundation-sql-lint",
    "lint-type-security",
    "knip",
    "Duplication budget",
    "unit-api-contract",
    "audit-tooling-platforms (ubuntu-latest)",
    "audit-tooling-platforms (windows-latest)",
    "build-route-verify",
    "Visual regression (chosen frontend)",
    "Workflow lint (actionlint)",
    "foundation-native",
    // The browser tests on the foundation test copy (owner decision 2026-11-11).
    "e2e-foundation",
  ]) {
    assert.ok(requiredContexts(ruleset).includes(name), `${name} must be required`);
  }
  // The retired stub browser suite and its shared build are gone.
  for (const name of requiredContexts(ruleset))
    assert.doesNotMatch(name, /^e2e-full-matrix|^Browser test build$/, name);
  // Matrix jobs are named as GitHub reports them; the release-gate callers in
  // CI never run on pull requests, so they can never be required.
  for (const name of [
    "e2e-foundation (chromium)",
    "e2e-foundation (mobile-chrome)",
    "e2e-foundation (mobile-safari)",
  ])
    assert.ok(available.has(name), name);
  for (const name of available) assert.doesNotMatch(name, /\$\{\{|Release gate/, name);
});

test("validation rejects renamed checks, bypass actors and missing rules", () => {
  const ruleset = loadRuleset();
  const available = availablePullRequestChecks();
  const renamed = structuredClone(ruleset);
  renamed.rules
    .find((rule) => rule.type === "required_status_checks")
    .parameters.required_status_checks.push({
      context: "no-such-job",
      integration_id: 15368,
    });
  assert.match(validateRuleset(renamed, available).join("\n"), /no-such-job/);

  const bypass = structuredClone(ruleset);
  bypass.bypass_actors = [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }];
  assert.match(validateRuleset(bypass, available).join("\n"), /bypass/);

  const noPullRequest = structuredClone(ruleset);
  noPullRequest.rules = noPullRequest.rules.filter((rule) => rule.type !== "pull_request");
  assert.match(validateRuleset(noPullRequest, available).join("\n"), /missing rule: pull_request/);
});

test("comparison reports a live ruleset that lacks the reviewed rules", () => {
  const ruleset = loadRuleset();
  const today = {
    enforcement: "active",
    bypass_actors: [],
    rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
  };
  const differences = compareRulesets(ruleset, today);
  assert.ok(differences.includes("missing live rule: pull_request"));
  assert.ok(differences.includes("missing live rule: required_status_checks"));
  assert.deepEqual(compareRulesets(ruleset, structuredClone(ruleset)), []);
});

// The slow lanes skip draft pull requests. GitHub counts a skipped or green
// job as a passed required check, and a draft-time result would still count
// after "Ready for review" until the new run reports (for e2e-foundation, until
// both browser projects finish). So a draft run never reports under the
// required name: it uses another name, and the required check waits.
const DRAFT_CONDITION =
  "github.event_name == 'pull_request' && github.event.pull_request.draft && !contains(github.event.pull_request.labels.*.name, 'run-full-ci')";
const DRAFT_SKIPPING_LANES = [
  { file: ".github/workflows/ci.yml", check: "foundation-sql-lint" },
  { file: ".github/workflows/foundation-native.yml", check: "foundation-native" },
  { file: ".github/workflows/e2e-foundation.yml", check: "e2e-foundation" },
];
const readWorkflow = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

test("conditional job names list both checks they can produce", () => {
  const conditional = `${workflow}  lane:
    name: \${{ (${DRAFT_CONDITION}) && 'lane (draft, not run)' || 'lane' }}
    runs-on: ubuntu-latest
`;
  assert.deepEqual(pullRequestCheckNames(conditional).slice(-2), ["lane (draft, not run)", "lane"]);
  assert.deepEqual(parseConditionalName(`\${{ (a == 'b') && 'x' || 'y' }}`), {
    condition: "a == 'b'",
    whenTrue: "x",
    whenFalse: "y",
  });
  assert.equal(parseConditionalName("plain"), null);
});

test("draft pull requests never report a required check of the slow lanes", () => {
  const required = new Set(requiredContexts(loadRuleset()));
  for (const { file, check } of DRAFT_SKIPPING_LANES) {
    const text = readWorkflow(file);
    assert.ok(required.has(check), `${check} stays required`);
    const names = [...text.matchAll(/^ {4}name: (\$\{\{.*\}\})$/gm)]
      .map((match) => parseConditionalName(match[1]))
      .filter((parsed) => parsed?.whenFalse === check);
    assert.equal(names.length, 1, `${file}: one job reports ${check}`);
    const [name] = names;
    assert.equal(name.condition, DRAFT_CONDITION, `${file}: ${check} is renamed on drafts`);
    assert.match(name.whenTrue, /draft, not run/);
    assert.ok(!required.has(name.whenTrue), `${name.whenTrue} must never be required`);
    // Every place that decides "draft" uses the same condition as the name,
    // so work is skipped only in runs that report under the draft name.
    const decisions = [
      ...text.matchAll(/DRAFT_NOT_RUN: \$\{\{ (.+) \}\}$/gm),
      ...text.matchAll(/^ {4}if: \$\{\{ !\((.+)\) \}\}$/gm),
    ].map((match) => match[1]);
    assert.ok(decisions.length > 0, `${file}: the draft decision is wired`);
    for (const decision of decisions) assert.equal(decision, DRAFT_CONDITION, file);
  }
  // No other job may report a required name only on drafts.
  for (const file of new Set(DRAFT_SKIPPING_LANES.map((lane) => lane.file))) {
    for (const match of readWorkflow(file).matchAll(/^ {4}name: (\$\{\{.*\}\})$/gm)) {
      const parsed = parseConditionalName(match[1]);
      if (parsed) assert.ok(!required.has(parsed.whenTrue), `${file}: ${parsed.whenTrue}`);
    }
  }
});

test("the path-filter steps compare the merge commit with its base, renames split", () => {
  for (const file of [".github/workflows/ci.yml", ".github/workflows/foundation-native.yml"]) {
    const text = readWorkflow(file);
    const merge = text.indexOf('if [ "$(git rev-list --parents -n 1 HEAD | wc -w)" -ne 3 ]; then');
    const diff = text.indexOf(
      'if ! changed="$(git diff --no-renames --name-only HEAD^1 HEAD)"; then'
    );
    assert.ok(merge > 0, `${file}: checks HEAD is the two-parent merge commit`);
    assert.ok(diff > merge, `${file}: lists the changes only after that check`);
    // Not the merge commit: run in full.
    assert.match(text.slice(merge, diff), /echo "run=true" >> "\$GITHUB_OUTPUT"/);
    assert.doesNotMatch(text, /git diff --name-only HEAD\^1 HEAD/, file);
  }
});

test("marking a draft ready for review starts the full slow lanes", () => {
  for (const file of new Set(DRAFT_SKIPPING_LANES.map((lane) => lane.file))) {
    const text = readWorkflow(file);
    const types =
      /^ {2}pull_request:\n {4}branches: \[main\]\n(?: {4}#.*\n)* {4}types: \[([^\]]+)\]/m.exec(
        text
      );
    assert.ok(types, `${file}: pull_request lists its activity types`);
    const listed = types[1].split(",").map((type) => type.trim());
    for (const type of ["opened", "synchronize", "reopened", "ready_for_review"])
      assert.ok(listed.includes(type), `${file}: ${type}`);
    assert.ok(triggersOnPullRequestToMain(text), file);
  }
});

// The SQL lint ends early on pull requests that change none of its inputs. A
// file its scripts import or read outside that list would let a breaking
// change pass the pull request (main still lints in full before deploying).
test("the SQL lint's inputs cover every file its scripts import or read", () => {
  const ci = readWorkflow(".github/workflows/ci.yml");
  const job = ci.slice(ci.indexOf("\n  foundation-sql-lint:\n"));
  const pattern = /inputs='([^']+)'/.exec(job.slice(0, job.indexOf("\n  lint-type-security:")));
  assert.ok(pattern, "the lint job lists its inputs");
  const inputs = new RegExp(pattern[1]);

  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  const entries = new Set(["scripts/lib/foundation-sql-lint.mjs"]);
  for (const name of ["db:foundation:lint", "db:foundation:lifecycle-test"])
    for (const match of scripts[name].matchAll(/scripts\/[\w.-]+\.mjs/g)) entries.add(match[0]);
  assert.ok(entries.size > 5);

  const resolve = (from, spec) => {
    let base;
    if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
    else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
    else return null;
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mjs`,
      `${base}.js`,
      `${base}/index.ts`,
    ])
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    assert.fail(`${from}: cannot resolve ${spec}`);
  };
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(mjs|js|ts|tsx)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:\bfrom|\bimport\()\s*["']([^"']+)["']/g)) {
      const target = resolve(file, match[1]);
      if (target) queue.push(target);
    }
    // Repository files named literally (fixtures, documents a suite reads).
    for (const match of text.matchAll(
      /["'`]((?:docs|database|src|scripts|supabase|e2e|public)\/[\w./-]+\.\w+)["'`]/g
    ))
      if (existsSync(match[1])) seen.add(match[1]);
  }
  const outside = [...seen].filter((file) => !inputs.test(file)).sort();
  assert.deepEqual(outside, [], "add these to the foundation-sql-lint inputs in ci.yml");
  for (const file of [
    "database/foundation/lint-baseline.json",
    ".github/workflows/ci.yml",
    "pnpm-lock.yaml",
  ])
    assert.ok(inputs.test(file), file);
  for (const file of [
    "src/components/ui/button.tsx",
    "src/app/page.tsx",
    "e2e/foundation/home.spec.ts",
    "docs/x.md",
  ])
    assert.ok(!inputs.test(file), file);
});
