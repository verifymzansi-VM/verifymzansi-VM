// Keeps the reviewed `main` ruleset (.github/rulesets/protect-main.json) in step
// with the workflows. A required check whose job was renamed, removed or made
// push-only would block every pull request, so the names are validated here.
import { readFileSync } from "node:fs";
import path from "node:path";

export const GITHUB_ACTIONS_APP_ID = 15368;
export const RULESET_FILE = ".github/rulesets/protect-main.json";
/** Workflows whose jobs may be required on pull requests to `main`. */
export const PULL_REQUEST_WORKFLOWS = [
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/foundation-native.yml",
  ".github/workflows/e2e-foundation.yml",
];

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripComment(value) {
  // Workflow values used here never contain a literal " #".
  const index = value.indexOf(" #");
  return index === -1 ? value : value.slice(0, index);
}

function parseInlineList(value) {
  const text = stripComment(value).trim();
  if (!text.startsWith("[") || !text.endsWith("]")) return null;
  return text
    .slice(1, -1)
    .split(",")
    .map((item) => unquote(item))
    .filter(Boolean);
}

/** True when the workflow triggers on pull requests to `main`. */
export function triggersOnPullRequestToMain(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (start === -1) return false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (indentOf(line) === 0) break;
    if (/^ {2}pull_request:\s*$/.test(line)) {
      const next = lines.slice(index + 1).find((candidate) => candidate.trim() !== "");
      if (!next || indentOf(next) <= 2) return true;
      const branches = /^\s+branches:\s*(.+)$/.exec(next);
      if (!branches) return true;
      const list = parseInlineList(branches[1]);
      return list === null || list.includes("main");
    }
  }
  return false;
}

/**
 * Lists the check-run names a workflow produces on a pull request. Jobs whose
 * job-level `if:` mentions `github.event_name == 'push'` (or another non-PR
 * event) are push-only and excluded. Matrix jobs expand to "name (value)" for
 * a single inline-list dimension, which is all this repository uses.
 */
export function pullRequestCheckNames(text) {
  const lines = text.split(/\r?\n/);
  const jobsStart = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsStart === -1) return [];
  const jobs = [];
  let current = null;
  let inMatrix = false;
  let matrixIndent = 0;
  for (let index = jobsStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indent = indentOf(line);
    if (indent === 0) break;
    const jobMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobMatch) {
      current = { id: jobMatch[1], name: null, condition: null, matrix: [] };
      jobs.push(current);
      inMatrix = false;
      continue;
    }
    if (!current) continue;
    const nameMatch = /^ {4}name:\s*(.+)$/.exec(line);
    if (nameMatch) {
      current.name = unquote(stripComment(nameMatch[1]));
      continue;
    }
    const ifMatch = /^ {4}if:\s*(.+)$/.exec(line);
    if (ifMatch) {
      current.condition = ifMatch[1].trim();
      continue;
    }
    if (/^\s+matrix:\s*$/.test(line)) {
      inMatrix = true;
      matrixIndent = indent;
      continue;
    }
    if (inMatrix) {
      if (indent <= matrixIndent) {
        inMatrix = false;
      } else {
        const dimension = /^\s+([A-Za-z0-9_-]+):\s*(\[.*\].*)$/.exec(line);
        if (dimension && indent === matrixIndent + 2) {
          const values = parseInlineList(dimension[2]);
          if (values) current.matrix.push(values);
        }
      }
    }
  }

  const names = [];
  for (const job of jobs) {
    if (
      job.condition &&
      (/github\.event_name\s*==\s*'(push|schedule|workflow_dispatch)'/.test(job.condition) ||
        /github\.event_name\s*!=\s*'pull_request'/.test(job.condition))
    ) {
      continue;
    }
    const base = job.name ?? job.id;
    if (job.matrix.length === 0) {
      names.push(base);
    } else if (job.matrix.length === 1) {
      // GitHub names a matrix job by its `name:` with `${{ matrix.<dim> }}`
      // filled in, or by the job name followed by the value in brackets.
      for (const value of job.matrix[0])
        names.push(
          /\$\{\{\s*matrix\.[\w-]+\s*\}\}/.test(base)
            ? base.replace(/\$\{\{\s*matrix\.[\w-]+\s*\}\}/g, value)
            : `${base} (${value})`
        );
    } else {
      throw new Error(
        `Job ${job.id} has a multi-dimension matrix; extend branch-ruleset.mjs first.`
      );
    }
  }
  return names;
}

export function loadRuleset(root = process.cwd()) {
  return JSON.parse(readFileSync(path.join(root, RULESET_FILE), "utf8"));
}

export function requiredContexts(ruleset) {
  const rule = ruleset.rules.find((candidate) => candidate.type === "required_status_checks");
  return rule ? rule.parameters.required_status_checks.map((check) => check.context) : [];
}

/** Every check name produced on a pull request to `main`, across workflows. */
export function availablePullRequestChecks(root = process.cwd()) {
  const names = new Set();
  for (const file of PULL_REQUEST_WORKFLOWS) {
    const text = readFileSync(path.join(root, file), "utf8");
    if (!triggersOnPullRequestToMain(text)) continue;
    for (const name of pullRequestCheckNames(text)) names.add(name);
  }
  return names;
}

/** Problems with the committed ruleset file; empty when it is safe to apply. */
export function validateRuleset(ruleset, available) {
  const problems = [];
  const types = ruleset.rules.map((rule) => rule.type);
  for (const required of [
    "deletion",
    "non_fast_forward",
    "pull_request",
    "required_status_checks",
  ]) {
    if (!types.includes(required)) problems.push(`missing rule: ${required}`);
  }
  if (ruleset.enforcement !== "active") problems.push("enforcement must be active");
  if (
    JSON.stringify(ruleset.conditions?.ref_name?.include) !== JSON.stringify(["~DEFAULT_BRANCH"])
  ) {
    problems.push("ruleset must target the default branch");
  }
  if ((ruleset.bypass_actors ?? []).length > 0) problems.push("no bypass actors are allowed");
  const statusRule = ruleset.rules.find((rule) => rule.type === "required_status_checks");
  const seen = new Set();
  for (const check of statusRule?.parameters.required_status_checks ?? []) {
    if (seen.has(check.context)) problems.push(`duplicate required check: ${check.context}`);
    seen.add(check.context);
    if (check.integration_id !== GITHUB_ACTIONS_APP_ID) {
      problems.push(`required check must come from GitHub Actions: ${check.context}`);
    }
    if (!available.has(check.context)) {
      problems.push(`required check does not run on pull requests to main: ${check.context}`);
    }
  }
  return problems;
}

function normaliseRule(rule) {
  if (rule.type === "required_status_checks") {
    const parameters = rule.parameters;
    return {
      type: rule.type,
      strict: parameters.strict_required_status_checks_policy,
      checks: parameters.required_status_checks
        .map((check) => `${check.context}#${check.integration_id ?? "any"}`)
        .sort(),
    };
  }
  if (rule.type === "pull_request") {
    const parameters = rule.parameters;
    return {
      type: rule.type,
      approvals: parameters.required_approving_review_count,
      codeOwners: parameters.require_code_owner_review,
      methods: [...(parameters.allowed_merge_methods ?? [])].sort(),
    };
  }
  return { type: rule.type };
}

/** Differences between the reviewed file and the ruleset GitHub reports. */
export function compareRulesets(expected, live) {
  const differences = [];
  if (live.enforcement !== expected.enforcement) {
    differences.push(`enforcement: live ${live.enforcement}, expected ${expected.enforcement}`);
  }
  if ((live.bypass_actors ?? []).length !== (expected.bypass_actors ?? []).length) {
    differences.push(
      `bypass actors: live ${(live.bypass_actors ?? []).length}, expected ${(expected.bypass_actors ?? []).length}`
    );
  }
  const want = new Map(
    expected.rules.map((rule) => [rule.type, JSON.stringify(normaliseRule(rule))])
  );
  const have = new Map(
    (live.rules ?? []).map((rule) => [rule.type, JSON.stringify(normaliseRule(rule))])
  );
  for (const [type, value] of want) {
    if (!have.has(type)) differences.push(`missing live rule: ${type}`);
    else if (have.get(type) !== value) differences.push(`rule differs: ${type}`);
  }
  for (const type of have.keys()) {
    if (!want.has(type)) differences.push(`unreviewed live rule: ${type}`);
  }
  return differences;
}
