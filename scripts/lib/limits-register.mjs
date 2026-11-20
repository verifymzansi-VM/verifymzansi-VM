// The limits register (docs/testing/limits-register.json): every limit the
// system enforces, where it is enforced and the test that proves it.
//
// checkLimitsRegister() fails when
//   - an entry is malformed, or two entries share an id;
//   - an entry's enforcement anchor is missing: the file is gone, or the exact
//     text (which includes the limit's value) is no longer in it, so a changed
//     value cannot pass without updating the register;
//   - a "behaviour" test file is missing or does not name the entry's id;
//   - a "register" test file is missing or does not read the register (those
//     tests load the register and check every entry of their kind themselves);
//   - a "declaration" entry (a value the code declares and a shared mechanism,
//     or a server-side limit it mirrors, enforces) names a mechanism that is
//     not itself a register entry with a behaviour or register test;
//   - the scanner finds a limit-looking line that no entry and no reviewed
//     "notLimits" item covers, or a notLimits item no longer matches anything.
//
// What the scanner looks at (and so what it cannot catch) is described in
// SCANNER_SCOPE below and in docs/testing/limits-register.md.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const REGISTER_FILE = "docs/testing/limits-register.json";
const SQL_FUNCTIONS = "database/foundation/current/functions";
const SQL_TABLES = "database/foundation/current/tables";
const RATE_LIMITER = "workers/rate-limiter.ts";
const APP_ROOTS = ["src", "workers"];

export const SCANNER_SCOPE = [
  `${SQL_FUNCTIONS}: lines comparing with, or bounding between, an integer of 2 or more, privacy_text(value, min, max) text rules, "limit N" read caps, ":= N" constants and integers inside least(...) / greatest(...)`,
  `${SQL_TABLES}: CHECK constraints comparing with, or bounding between, an integer of 2 or more`,
  `${RATE_LIMITER}: every action in ACTION_LIMITS and the built-in phone-code tiers`,
  `${APP_ROOTS.join(", ")}: request body caps (maxBytes: N) and *BYTES / *SIZE number constants outside tests`,
];

const ID_PATTERN = /^LIM-[A-Z0-9]+(?:-[A-Za-z0-9_]+)+$/;
const CATEGORIES = new Set([
  "rate",
  "quota",
  "cap",
  "money",
  "size",
  "length",
  "batch",
  "retention",
  "expiry",
  "attempts",
  "mechanism",
  "range",
]);
const TEST_KINDS = new Set(["behaviour", "register", "declaration"]);
// Proves only that a guard line is present in the replayed function body.
const UNTESTED_MECHANISM = "LIM-MECH-SQL-GUARD";

const toPosix = (path) => path.split("\\").join("/");

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// ---------------------------------------------------------------- scanner

const COMPARISON = /(?<![-=<>!])(?:>=|<=|>|<)(?![>=])\s*(-?\d+)\b/g;
const BETWEEN = /\bbetween\s+(-?\d+)\s+and\s+(-?\d+)/gi;
// Integer-type range guards (int4 and int8 maxima, used for revision and
// generation counters), not product limits.
const IGNORED_NUMBERS = new Set(["2147483646", "2147483647", "9223372036854775807"]);

/**
 * Integers of 2 or more that a SQL line compares with, bounds between, passes
 * to privacy_text as a length, uses as a "limit N" read cap, assigns with
 * ":=" or passes to least(...) / greatest(...). Text inside string literals
 * is ignored for the last three forms.
 */
export function sqlLimitNumbers(line) {
  const numbers = [];
  for (const match of line.matchAll(COMPARISON)) numbers.push(match[1]);
  for (const match of line.matchAll(BETWEEN)) numbers.push(match[1], match[2]);
  for (const match of line.matchAll(/privacy_text\([^;]*?,\s*(\d+)\s*,\s*(\d+)\s*\)/g))
    numbers.push(match[1], match[2]);
  const code = line.replace(/'(?:[^']|'')*'/g, "''");
  for (const match of code.matchAll(/\blimit\s+(\d+)\b/gi)) numbers.push(match[1]);
  for (const match of code.matchAll(/:=\s*(-?\d+)\b(?![.:])/g)) numbers.push(match[1]);
  const bounded = /\b(?:least|greatest)\s*\(/i.exec(code);
  if (bounded)
    for (const match of code.slice(bounded.index).matchAll(/(?<![\w.$])(\d+)\b(?![.:])/g))
      numbers.push(match[1]);
  return numbers
    .filter((n) => !IGNORED_NUMBERS.has(n.replace(/^-/, "")))
    .map(Number)
    .filter((n) => Math.abs(n) >= 2);
}

const isSqlComment = (line) => /^\s*--/.test(line);
const stripSqlComment = (line) => line.replace(/--.*$/, "");

/**
 * Scans `files`; `pick(raw, text)` returns the limit numbers on a line (an
 * empty list when the line is not limit-looking). An anchor covers a finding
 * only when it contains every one of those numbers.
 */
function scanFiles(root, files, source, pick) {
  const findings = [];
  for (const path of files) {
    const file = toPosix(relative(root, path));
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    lines.forEach((raw, index) => {
      const text = raw.trim();
      const numbers = text ? pick(raw, text) : [];
      if (numbers.length) findings.push({ source, file, line: index + 1, text, numbers });
    });
  }
  return findings;
}

function scanSqlFunctions(root) {
  return scanFiles(
    root,
    walk(join(root, SQL_FUNCTIONS)).filter((path) => path.endsWith(".sql")),
    "sql-function",
    (raw) => (isSqlComment(raw) ? [] : sqlLimitNumbers(stripSqlComment(raw)))
  );
}

function scanSqlTables(root) {
  return scanFiles(
    root,
    walk(join(root, SQL_TABLES)).filter((path) => path.endsWith(".sql")),
    "sql-table",
    (raw, text) => (/^constraint\s+\S+\s+CHECK\s*\(/i.test(text) ? sqlLimitNumbers(raw) : [])
  );
}

function scanRateLimiter(root) {
  const path = join(root, RATE_LIMITER);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const findings = [];
  let inTable = false;
  lines.forEach((raw, index) => {
    const text = raw.trim();
    if (/^const ACTION_LIMITS\b/.test(text)) inTable = true;
    else if (inTable && text === "};") inTable = false;
    const action = inTable && /^"?[a-z0-9:_-]+"?:\s*\[/i.test(text);
    const phoneTier = /^\{\s*key:\s*`otp:[a-z]+:\$\{/.test(text);
    // The anchor locates the action; its tiers (the values) are compared with
    // the register by src/__tests__/limits/rate-limiter-limits.test.ts.
    if (action || phoneTier)
      findings.push({
        source: "rate-limiter",
        file: RATE_LIMITER,
        line: index + 1,
        text,
        numbers: [],
      });
  });
  return findings;
}

const APP_CAP = [
  /\bmaxBytes:\s*[^,}\n]*\d/,
  /\b(?:export\s+)?const\s+[A-Z0-9_]*(?:BYTES|SIZE)[A-Z0-9_]*\s*=\s*\d/,
];
const isTestFile = (file) =>
  /(^|\/)__tests__\//.test(file) || /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(file);

function scanAppCaps(root) {
  const files = APP_ROOTS.flatMap((dir) => walk(join(root, dir)))
    .filter((path) => /\.(ts|tsx|mjs|js)$/.test(path))
    .filter((path) => !isTestFile(toPosix(relative(root, path))));
  return scanFiles(root, files, "app", (_raw, text) =>
    APP_CAP.some((re) => re.test(text))
      ? [...text.replace(/\/\/.*$/, "").matchAll(/(?<![\w.])(\d[\d_]*)\b/g)]
          .map((match) => match[1])
          .filter((n) => Number(n.replaceAll("_", "")) >= 2)
      : []
  );
}

export function scanLimitFindings(root = process.cwd()) {
  return [
    ...scanSqlFunctions(root),
    ...scanSqlTables(root),
    ...scanRateLimiter(root),
    ...scanAppCaps(root),
  ];
}

// ---------------------------------------------------------------- register

export function readLimitsRegister(root = process.cwd()) {
  return JSON.parse(readFileSync(join(root, REGISTER_FILE), "utf8"));
}

const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

function entryShapeProblems(entry) {
  const problems = [];
  if (!nonEmptyString(entry.id) || !ID_PATTERN.test(entry.id)) problems.push("id");
  if (!nonEmptyString(entry.title)) problems.push("title");
  if (!CATEGORIES.has(entry.category)) problems.push("category");
  if (!nonEmptyString(entry.value) && typeof entry.value !== "number") problems.push("value");
  if (!Array.isArray(entry.enforcedAt) || entry.enforcedAt.length === 0)
    problems.push("enforcedAt");
  else
    for (const anchor of entry.enforcedAt)
      if (!nonEmptyString(anchor?.file) || !nonEmptyString(anchor?.contains))
        problems.push("enforcedAt[].file/contains");
  if (!Array.isArray(entry.tests) || entry.tests.length === 0) problems.push("tests");
  else
    for (const test of entry.tests) {
      if (!TEST_KINDS.has(test?.kind)) problems.push("tests[].kind");
      else if (test.kind === "declaration") {
        if (!nonEmptyString(test.mechanism)) problems.push("tests[].mechanism");
      } else if (!nonEmptyString(test.file)) problems.push("tests[].file");
    }
  return problems;
}

/**
 * Checks `register` against the repository at `root` and the scanner's
 * `findings`. Returns { failures, stats }.
 */
export function checkLimitsRegister({
  root = process.cwd(),
  register = readLimitsRegister(root),
  findings = scanLimitFindings(root),
} = {}) {
  const failures = [];
  const cache = new Map();
  const read = (file) => {
    if (!cache.has(file)) {
      const path = join(root, file);
      cache.set(file, existsSync(path) ? readFileSync(path, "utf8") : null);
    }
    return cache.get(file);
  };

  const limits = Array.isArray(register?.limits) ? register.limits : [];
  const notLimits = Array.isArray(register?.notLimits) ? register.notLimits : [];
  if (!Array.isArray(register?.limits)) failures.push("register: `limits` must be an array");

  const byId = new Map();
  for (const entry of limits) {
    const problems = entryShapeProblems(entry ?? {});
    if (problems.length) {
      failures.push(`${entry?.id ?? "(no id)"}: malformed (${problems.join(", ")})`);
      continue;
    }
    if (byId.has(entry.id)) failures.push(`${entry.id}: duplicate id`);
    byId.set(entry.id, entry);
  }

  // Enforcement anchors: the exact text (with the value) must still be there.
  for (const entry of byId.values()) {
    for (const anchor of entry.enforcedAt) {
      const text = read(anchor.file);
      if (text === null) failures.push(`${entry.id}: enforcement file ${anchor.file} is missing`);
      else if (!text.includes(anchor.contains))
        failures.push(
          `${entry.id}: ${anchor.file} no longer contains ${JSON.stringify(anchor.contains)} (value changed or moved? update the register and its test)`
        );
    }
  }

  // Tests.
  const hasBehaviourTest = (entry) => entry.tests.some((test) => test.kind !== "declaration");
  for (const entry of byId.values()) {
    for (const test of entry.tests) {
      if (test.kind === "declaration") {
        const mechanism = byId.get(test.mechanism);
        if (!mechanism)
          failures.push(`${entry.id}: mechanism ${test.mechanism} is not in the register`);
        else if (!hasBehaviourTest(mechanism))
          failures.push(
            `${entry.id}: mechanism ${test.mechanism} must itself have a behaviour or register test`
          );
        continue;
      }
      const text = read(test.file);
      if (text === null) {
        failures.push(`${entry.id}: test file ${test.file} is missing`);
        continue;
      }
      if (test.kind === "behaviour" && !text.includes(entry.id))
        failures.push(`${entry.id}: test file ${test.file} does not reference ${entry.id}`);
      if (test.kind === "register" && !text.includes("limits-register.json"))
        failures.push(`${entry.id}: register test ${test.file} does not read the register`);
    }
  }

  // Scanner coverage.
  const anchorsByFile = new Map();
  const addAnchor = (file, contains, owner) => {
    if (!anchorsByFile.has(file)) anchorsByFile.set(file, []);
    anchorsByFile.get(file).push({ contains, owner, used: false });
  };
  for (const entry of byId.values())
    for (const anchor of entry.enforcedAt) addAnchor(anchor.file, anchor.contains, entry.id);
  notLimits.forEach((item, index) => {
    if (
      !nonEmptyString(item?.file) ||
      !nonEmptyString(item?.contains) ||
      !nonEmptyString(item?.reason)
    )
      failures.push(`notLimits[${index}]: needs file, contains and reason`);
    else addAnchor(item.file, item.contains, `notLimits[${index}]`);
  });
  const uncovered = [];
  for (const finding of findings) {
    // An anchor covers a line only when it is part of the line and names every
    // limit number on it, so a short anchor cannot cover a new number.
    const anchors = (anchorsByFile.get(finding.file) ?? []).filter(
      (anchor) =>
        finding.text.includes(anchor.contains) &&
        (finding.numbers ?? []).every((n) =>
          new RegExp(`(?<![\\w.])${String(n)}(?![\\w])`).test(anchor.contains)
        )
    );
    if (anchors.length === 0) uncovered.push(finding);
    for (const anchor of anchors) anchor.used = true;
  }
  for (const finding of uncovered)
    failures.push(
      `unregistered limit-looking line ${finding.file}:${finding.line}: ${finding.text} (add a register entry or a reviewed notLimits item)`
    );
  for (const [file, anchors] of anchorsByFile)
    for (const anchor of anchors)
      if (anchor.owner.startsWith("notLimits") && !anchor.used)
        failures.push(
          `${anchor.owner}: ${file} no longer has a line containing ${JSON.stringify(anchor.contains)}; remove it`
        );

  // Strongest proof per entry. "untested" entries rely only on
  // LIM-MECH-SQL-GUARD: the guard line is present in the running function, but
  // nothing exercises it at its bound. They are the behaviour-test backlog.
  const kinds = { behaviour: 0, register: 0, declaration: 0, untested: 0 };
  for (const entry of byId.values()) {
    const best = entry.tests.find((t) => t.kind === "behaviour")
      ? "behaviour"
      : entry.tests.find((t) => t.kind === "register")
        ? "register"
        : entry.tests.every((t) => t.mechanism === UNTESTED_MECHANISM)
          ? "untested"
          : "declaration";
    kinds[best] += 1;
  }
  return {
    failures,
    stats: { limits: byId.size, notLimits: notLimits.length, findings: findings.length, ...kinds },
  };
}

/** Where a register entry's first anchor is now: "file:line" (for reports). */
export function anchorLocation(root, anchor) {
  const path = join(root, anchor.file);
  if (!existsSync(path)) return `${anchor.file}:?`;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(anchor.contains));
  return `${anchor.file}:${index < 0 ? "?" : index + 1}`;
}
