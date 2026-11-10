import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availablePullRequestChecks,
  compareRulesets,
  loadRuleset,
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
    "payment-kyc-regressions",
    "audit-tooling-platforms (ubuntu-latest)",
    "audit-tooling-platforms (windows-latest)",
    "build-route-verify",
    "db-rls",
    "e2e-smoke (chromium)",
    "e2e-smoke (mobile-chrome)",
    "launch-flows-bundle",
    "Visual regression (chosen frontend)",
    "foundation-native",
  ]) {
    assert.ok(requiredContexts(ruleset).includes(name), `${name} must be required`);
  }
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
