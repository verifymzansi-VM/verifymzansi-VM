// Detection logic for the check-change guard (.github/workflows/check-changes.yml,
// scripts/check-changed-checks.mjs). It reads a pull request's changed files,
// as the GitHub API lists them ({ filename, status, previous_filename, patch }),
// and reports in plain words whether the pull request weakens or changes the
// repository's tests and checks:
//
//   - deleted test files, test files renamed or moved so they no longer run,
//     and test cases removed from test files (removed and added test cases are
//     counted separately, so swapping real tests for empty ones is reported);
//   - new skip, only, todo, fails, fixme or expected-failure marks;
//   - removed native database checks (record(...) calls);
//   - changes to the files that configure the checks (coverage thresholds,
//     audit baselines, rulesets, workflows, check scripts and the libraries
//     they import, lint, type and scanner configuration, browser test
//     configuration, visual baselines, the database contract steps, the native
//     database checks, dependency settings) and to the test and check commands;
//   - new dependencies, dependencies taken from somewhere other than the
//     registry, new or changed overrides, new install-script permissions and a
//     changed package manager, from the two package.json files parsed as JSON.
//
// Everything here is pure: file names, patch text and file contents are data.
// Nothing is executed, and the pull request's title, description and commit
// messages are never read, so its author cannot steer the verdict.
//
// Limits: the detection reads lines, not meaning. Deleting the assertions
// inside a test that stays, or making a test pass without testing anything,
// is not detected. Whatever cannot be read (binary files, diffs GitHub leaves
// out, lines longer than MAX_LINE_LENGTH) counts as a change to the checks.

export const MARKER = "<!-- check-change-guard -->";
export const LABEL_CHANGED = "checks-changed";
export const LABEL_CLEAN = "checks-clean";
export const COULD_NOT_CHECK = "Could not check this PR; treat it as changing checks.";

// Lines longer than this are not scanned (minified or generated code, or an
// attempt to make the scan slow) and count as unreadable.
export const MAX_LINE_LENGTH = 2000;
// Each list in the comment shows at most this many entries, then "and N more".
export const LIST_CAP = 20;
// GitHub refuses comments over 65,536 characters; stay well under.
export const MAX_COMMENT_LENGTH = 60000;

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;

// Files that look like tests by name: unit and component tests, node:test
// tooling tests, browser specs and the native database test scripts.
const TEST_FILE_PATTERNS = [
  /(?:^|\/)__tests__\//,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /^scripts\/test-[^/]+\.[cm]?[jt]s$/,
];

// Files that only support tests; a skip mark added here still turns tests off.
const TEST_SUPPORT_PATTERNS = [/^e2e\//, /^src\/test\//];

function looksLikeTest(file) {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(file));
}

// ---------------------------------------------------------------------------
// Which files run as tests, from main's vitest, Playwright and package.json.

/**
 * Converts a test-runner glob (the subset vitest and Playwright configs use:
 * `*`, `**`, `?`, `[...]`, `{a,b}`, `@(a|b)`, `?(a)`, `*(a)`, `+(a)`) into an
 * anchored regular expression. Throws on anything else.
 */
export function globToRegExp(glob) {
  let index = 0;
  const escape = (char) => char.replace(/[.+^${}()|[\]\\*?]/g, "\\$&");
  function parse(stops) {
    let out = "";
    while (index < glob.length) {
      const char = glob[index];
      if (stops.includes(char)) return out;
      if (char === "*" && glob[index + 1] === "*") {
        index += 2;
        if (glob[index] === "/") {
          index += 1;
          out += "(?:[^/]*/)*";
        } else {
          out += ".*";
        }
        continue;
      }
      if ("@?*+!".includes(char) && glob[index + 1] === "(") {
        if (char === "!") throw new Error(`Unsupported glob: ${glob}`);
        index += 2;
        const group = `(?:${alternatives("|", ")").join("|")})`;
        out += char === "@" ? group : `${group}${char}`;
        continue;
      }
      if (char === "*") {
        out += "[^/]*";
      } else if (char === "?") {
        out += "[^/]";
      } else if (char === "[") {
        const end = glob.indexOf("]", index + 1);
        if (end === -1) throw new Error(`Unsupported glob: ${glob}`);
        const body = glob
          .slice(index + 1, end)
          .replace(/\\/g, "\\\\")
          .replace(/^!/, "^");
        out += `[${body}]`;
        index = end;
      } else if (char === "{") {
        index += 1;
        out += `(?:${alternatives(",", "}").join("|")})`;
        continue;
      } else {
        out += escape(char);
      }
      index += 1;
    }
    if (stops.length > 0) throw new Error(`Unsupported glob: ${glob}`);
    return out;
  }
  function alternatives(separator, closer) {
    const found = [];
    for (;;) {
      found.push(parse([separator, closer]));
      const char = glob[index];
      index += 1;
      if (char === closer) return found;
    }
  }
  return new RegExp(`^${parse([])}$`);
}

const VITEST_DEFAULT_INCLUDE = "**/*.{test,spec}.?(c|m)[jt]s?(x)";
const PLAYWRIGHT_DEFAULT_MATCH = "**/*.@(spec|test).?(c|m)[jt]s?(x)";
const STRING_LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`\n$]*)`/g;

function stringLiterals(text) {
  return [...String(text).matchAll(STRING_LITERAL)].map(
    (match) => match[1] ?? match[2] ?? match[3]
  );
}

function compileAll(globs) {
  const compiled = [];
  for (const glob of globs) {
    try {
      compiled.push(globToRegExp(glob));
    } catch {
      // An unreadable pattern adds no suite; the name patterns still apply.
    }
  }
  return compiled;
}

// The value of `key:` in a config: one string, or an array of strings.
// Returns undefined when the key is absent and null when it is not a literal
// (a regular expression or a computed value).
function configStrings(text, key) {
  const match = new RegExp(`\\b${key}\\s*:\\s*`).exec(text);
  if (!match) return undefined;
  const rest = text.slice(match.index + match[0].length);
  const single = /^(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n$]*)`)/.exec(rest);
  if (single) return [single[1] ?? single[2] ?? single[3]];
  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end === -1) return null;
    const inside = rest.slice(1, end);
    const values = stringLiterals(inside);
    return inside.replace(STRING_LITERAL, "").replace(/[\s,]/g, "") === "" ? values : null;
  }
  return null;
}

function normaliseDir(dir) {
  return String(dir).replace(/^\.\//, "").replace(/^\.$/, "").replace(/\/+$/, "");
}

// Playwright treats a pattern without a slash as matching that file name
// anywhere under testDir.
function playwrightGlob(pattern) {
  return pattern.includes("/") || pattern.startsWith("**") ? pattern : `**/${pattern}`;
}

function playwrightProject(name, configs, seen = new Set()) {
  const text = configs[name];
  if (typeof text !== "string" || seen.has(name)) return null;
  seen.add(name);
  // A config that spreads another (`...foundation`) inherits what it leaves out.
  let inherited = null;
  const spread = /\.\.\.\s*([A-Za-z_$][\w$]*)\s*,/.exec(text);
  if (spread) {
    const from = new RegExp(
      `import\\s+${spread[1].replace(/\$/g, "\\$")}\\s+from\\s+["']\\./([^"']+)["']`
    ).exec(text);
    if (from) {
      const target = Object.keys(configs).find(
        (candidate) => candidate === from[1] || candidate.replace(/\.[cm]?[jt]s$/, "") === from[1]
      );
      if (target) inherited = playwrightProject(target, configs, seen);
    }
  }
  const testDir = configStrings(text, "testDir");
  const testMatch = configStrings(text, "testMatch");
  const testIgnore = configStrings(text, "testIgnore");
  return {
    testDir:
      testDir === undefined
        ? (inherited?.testDir ?? "")
        : testDir === null
          ? null
          : normaliseDir(testDir[0]),
    testMatch:
      testMatch === undefined ? (inherited?.testMatch ?? [PLAYWRIGHT_DEFAULT_MATCH]) : testMatch,
    testIgnore: testIgnore === undefined ? (inherited?.testIgnore ?? []) : testIgnore,
  };
}

// Code files named in package.json scripts that are tests (node:test files and
// the native database test scripts).
const SCRIPT_TEST_FILE =
  /(?:^|[\s"'=])(?:\.\/)?((?:[\w@.-]+\/)*(?:[\w@.-]+\.(?:test|spec)|test-[\w@.-]+)\.[cm]?[jt]sx?)(?=$|[\s"';&|)])/g;

function testFilesInScripts(packageText) {
  const files = new Set();
  let parsed = null;
  try {
    parsed = JSON.parse(packageText);
  } catch {
    return files;
  }
  const scripts = parsed && typeof parsed === "object" ? parsed.scripts : null;
  if (!scripts || typeof scripts !== "object") return files;
  for (const command of Object.values(scripts)) {
    if (typeof command !== "string") continue;
    for (const match of command.matchAll(SCRIPT_TEST_FILE)) files.add(match[1]);
  }
  return files;
}

/**
 * Works out which files run as tests from the text of main's vitest config,
 * its Playwright configs ({ "playwright.foundation.config.ts": text, ... })
 * and package.json files (whose scripts name the node:test files). Patterns
 * that cannot be read fall back to the runners' defaults.
 */
export function buildTestSuites({ vitestConfig, playwrightConfigs = {}, packageJsons = [] } = {}) {
  const suites = [];
  if (typeof vitestConfig === "string") {
    const globs = stringLiterals(vitestConfig).filter(
      (value) => value.includes("*") && /(?:test|spec)/.test(value)
    );
    const include = compileAll(globs.length > 0 ? globs : [VITEST_DEFAULT_INCLUDE]);
    suites.push({ runner: "vitest", matches: (file) => include.some((re) => re.test(file)) });
  }
  for (const name of Object.keys(playwrightConfigs).sort()) {
    const project = playwrightProject(name, playwrightConfigs);
    if (!project || project.testDir === null) continue;
    const match = compileAll((project.testMatch ?? [PLAYWRIGHT_DEFAULT_MATCH]).map(playwrightGlob));
    const ignore = compileAll((project.testIgnore ?? []).map(playwrightGlob));
    const prefix = project.testDir ? `${project.testDir}/` : "";
    suites.push({
      runner: `playwright (${name})`,
      matches: (file) => {
        if (!file.startsWith(prefix)) return false;
        const inside = file.slice(prefix.length);
        return match.some((re) => re.test(inside)) && !ignore.some((re) => re.test(inside));
      },
    });
  }
  const named = new Set();
  for (const text of packageJsons) {
    if (typeof text === "string") for (const file of testFilesInScripts(text)) named.add(file);
  }
  suites.push({
    runner: "package.json scripts",
    matches: (file) => named.has(file) || /^scripts\/test-[^/]+\.[cm]?[jt]s$/.test(file),
  });
  return suites;
}

function runsAsTest(file, suites) {
  return suites.some((suite) => suite.matches(file));
}

// ---------------------------------------------------------------------------
// Files that configure the checks.

// Every scripts/lib file that a scripts/check-* script (or the security audit)
// imports, directly or through another lib. scripts/check-changes.test.mjs
// fails when a check script imports a lib that is missing here.
export const CHECK_SCRIPT_LIBS = [
  "scripts/lib/audit-runtime.ts",
  "scripts/lib/backend-foundation.mjs",
  "scripts/lib/braces-backport.ts",
  "scripts/lib/branch-ruleset.mjs",
  "scripts/lib/built-routes.mjs",
  "scripts/lib/check-changes.mjs",
  "scripts/lib/check-registry.ts",
  "scripts/lib/cloudflare-api.mjs",
  "scripts/lib/cloudflare-deployment-bindings.mjs",
  "scripts/lib/cloudflare-startup-fixture.mjs",
  "scripts/lib/cloudflare-wrangler.mjs",
  "scripts/lib/deployment-ci.ts",
  "scripts/lib/deployment-health.ts",
  "scripts/lib/duplication-policy.ts",
  "scripts/lib/foundation-api-contracts.mjs",
  "scripts/lib/foundation-api-drift.mjs",
  "scripts/lib/foundation-api-openapi.mjs",
  "scripts/lib/foundation-baseline-guard.mjs",
  "scripts/lib/foundation-deployment.ts",
  "scripts/lib/foundation-error-reasons.mjs",
  "scripts/lib/foundation-native-isolation.mjs",
  "scripts/lib/foundation-native-paths.mjs",
  "scripts/lib/foundation-posting-terms-catalogue.mjs",
  "scripts/lib/foundation-replay.mjs",
  "scripts/lib/foundation-runtime-api.mjs",
  "scripts/lib/foundation-snapshot.mjs",
  "scripts/lib/foundation-update-order.mjs",
  "scripts/lib/frontend-freeze.mjs",
  "scripts/lib/legacy-surface.mjs",
  "scripts/lib/license-policy.ts",
  "scripts/lib/live-retry.ts",
  "scripts/lib/public-edge.ts",
  "scripts/lib/quality-policy.ts",
  "scripts/lib/rate-limiter-probe.ts",
  "scripts/lib/security-header-policy.mjs",
  "scripts/lib/site-monitor.ts",
  "scripts/lib/supabase-management.ts",
  "scripts/lib/supabase-performance-classification.ts",
  "scripts/lib/worker-size.mjs",
  "scripts/lib/workspace-env.ts",
];
const CHECK_SCRIPT_LIB_SET = new Set(CHECK_SCRIPT_LIBS);

// Each group names, in plain words, a set of files that configure the checks.
// A file is reported under the first group it matches.
const CHECK_CONFIG_GROUPS = [
  {
    id: "coverage-excluded",
    words: "the list of suites left out of coverage",
    match: (file) => file === "src/test/coverage-excluded-suites.ts",
  },
  {
    id: "test-runner",
    words: "the unit test configuration",
    match: (file) =>
      /^vitest(?:\.[^/]+)?\.config\.[cm]?[jt]s$/.test(file) ||
      file === "scripts/run-vitest.ts" ||
      file === "src/test/setup.ts",
  },
  {
    id: "audit-baselines",
    words: "the audit baselines",
    match: (file) => file.startsWith("scripts/audit-baselines/"),
  },
  {
    id: "security-audit",
    words: "the dependency security audit",
    match: (file) =>
      file === "scripts/security-audit.ts" || file === "scripts/dependency-audit-policy.ts",
  },
  {
    id: "legacy-surface",
    words: "the legacy surface baseline",
    match: (file) => file === "scripts/legacy-surface-baseline.json",
  },
  {
    id: "rulesets",
    words: "the branch rulesets",
    match: (file) => file.startsWith(".github/rulesets/"),
  },
  {
    id: "workflows",
    words: "the CI workflows",
    match: (file) =>
      file.startsWith(".github/workflows/") ||
      file.startsWith(".github/actions/") ||
      file === ".github/actionlint.yaml",
  },
  {
    id: "repository-settings",
    words: "the code owners or Dependabot settings",
    match: (file) => file === ".github/CODEOWNERS" || file === ".github/dependabot.yml",
  },
  {
    id: "check-scripts",
    words: "the check scripts",
    match: (file) =>
      /^scripts\/check-[^/]+$/.test(file) ||
      CHECK_SCRIPT_LIB_SET.has(file) ||
      file === "scripts/run-safety-gate.ts",
  },
  {
    id: "access-matrix",
    words: "the reviewed database access list",
    match: (file) =>
      file === "scripts/lib/foundation-access-matrix-native.mjs" ||
      file === "scripts/lib/foundation-access-matrix-exercised.json",
  },
  {
    id: "native-checks",
    words: "the native database checks",
    match: (file) => /^scripts\/lib\/[^/]+-native\.mjs$/.test(file),
  },
  {
    id: "knip",
    words: "the unused-code (knip) configuration",
    match: (file) => file === "knip.jsonc",
  },
  {
    id: "semgrep",
    words: "the Semgrep ignore list",
    match: (file) => file === ".semgrepignore",
  },
  {
    id: "gitleaks",
    words: "the Gitleaks allowlist",
    match: (file) => file === ".gitleaks.toml" || file === ".gitleaksignore",
  },
  {
    id: "osv",
    words: "the vulnerability scanner (OSV) configuration",
    match: (file) => file === "osv-scanner.toml",
  },
  {
    id: "eslint",
    words: "the ESLint configuration",
    match: (file) =>
      /^eslint\.config\.[cm]?[jt]s$/.test(file) ||
      /(?:^|\/)\.eslintrc(?:\.[a-z]+)?$/.test(file) ||
      file === ".eslintignore" ||
      file.startsWith("scripts/eslint-rules/"),
  },
  {
    id: "typescript",
    words: "the TypeScript configuration",
    match: (file) => /^tsconfig[^/]*\.json$/.test(file),
  },
  {
    id: "code-rules",
    words: "the dependency-rule, duplication or Lighthouse configuration",
    match: (file) =>
      file === ".dependency-cruiser.cjs" ||
      file === ".jscpd.json" ||
      file === "lighthouse.config.json",
  },
  {
    id: "dependency-settings",
    words: "the package manager settings, lockfile or dependency patches",
    match: (file) =>
      file === ".npmrc" ||
      file === "pnpm-lock.yaml" ||
      file === "pnpm-workspace.yaml" ||
      file.startsWith("patches/"),
  },
  {
    id: "playwright",
    words: "the Playwright configuration",
    match: (file) => /^playwright(?:\.[^/]+)?\.config\.[cm]?[jt]s$/.test(file),
  },
  {
    id: "skip-policy",
    words: "the browser test skip policy",
    match: (file) =>
      file === "e2e/support/skip-policy.ts" || file === "e2e/support/skip-guard-reporter.ts",
  },
  {
    id: "visual-baselines",
    words: "the visual baseline images",
    match: (file) => /-snapshots\/[^/]+\.(?:png|jpe?g|webp)$/.test(file),
  },
  {
    id: "contract-steps",
    words: "the database contract steps",
    match: (file) => file === "database/foundation/contract-steps.json",
  },
];

/** The plain-words name of the check configuration a file belongs to, or null. */
export function checkConfigGroup(file) {
  return CHECK_CONFIG_GROUPS.find((group) => group.match(file))?.words ?? null;
}

// ---------------------------------------------------------------------------
// Patches.

/** Splits a unified-diff patch into lines tagged with their kind and line numbers. */
export function parsePatch(patch) {
  const lines = [];
  if (typeof patch !== "string") return lines;
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      lines.push({ kind: "hunk", text: raw, oldLine, newLine });
      continue;
    }
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const kind = raw[0];
    const text = raw.slice(1);
    if (kind === "+") lines.push({ kind: "add", text, newLine: newLine++ });
    else if (kind === "-") lines.push({ kind: "remove", text, oldLine: oldLine++ });
    else if (kind === " " || raw === "") {
      lines.push({ kind: "context", text, oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return lines;
}

// Whether each line of one side of a hunk is wholly a comment. Only lines that
// can be nothing but a comment count: `// ...`, `/* ... */` with no code after
// it, and `* ...` continuation lines inside a block comment this hunk opened.
// A `* ...` line with no visible opener (it may be a multiplication), a line
// holding a backtick (it may close a template literal) and a line after one
// ending in a backslash (a continued string) are treated as code. A comment
// read as code only costs a false report; code read as a comment would hide a
// mark.
function commentTracker() {
  let inBlock = false;
  let continued = false;
  function restIsComment(rest) {
    let text = rest.trim();
    while (text) {
      if (text.startsWith("//")) return true;
      if (!text.startsWith("/*")) return false;
      const end = text.indexOf("*/", 2);
      if (end === -1) {
        inBlock = true;
        return true;
      }
      text = text.slice(end + 2).trim();
    }
    return true;
  }
  return (raw) => {
    const text = raw.trim();
    const afterContinuation = continued;
    continued = text.endsWith("\\");
    if (afterContinuation || text.includes("`")) {
      inBlock = false;
      return false;
    }
    if (inBlock) {
      if (!text.startsWith("*")) {
        inBlock = false;
        return false;
      }
      const end = text.indexOf("*/");
      if (end === -1) return true;
      inBlock = false;
      return restIsComment(text.slice(end + 2));
    }
    return text !== "" && restIsComment(text);
  };
}

/** Marks each added or removed line with `comment: true` when it is wholly a comment. */
export function markComments(lines) {
  let oldSide = commentTracker();
  let newSide = commentTracker();
  for (const line of lines) {
    if (line.kind === "hunk") {
      oldSide = commentTracker();
      newSide = commentTracker();
    } else if (line.kind === "context") {
      oldSide(line.text);
      newSide(line.text);
    } else if (line.kind === "remove") {
      line.comment = oldSide(line.text);
    } else if (line.kind === "add") {
      line.comment = newSide(line.text);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Skip, only, todo and expected-failure marks. Every pattern here runs in time
// linear in the line, and lines over MAX_LINE_LENGTH are never scanned.

const MARK_ROOTS = new Set(["it", "test", "describe", "suite", "bench", "specify", "context"]);
const MARK_NAMES = new Set([
  "skip",
  "only",
  "todo",
  "fails",
  "fixme",
  "fail",
  "failing",
  "skipIf",
  "runIf",
]);
const MARK_WORD_LIST = [...MARK_NAMES].join("|");
// A dotted member chain such as `test.describe.skip`. Each step must start
// with a dot, so the repetition cannot backtrack into itself.
const MEMBER_CHAIN = /[A-Za-z_$][\w$]*(?:[ \t]*\.[ \t]*[A-Za-z_$][\w$]*)*/g;
const PREFIX_MARK = /(?:^|[^\w.$])(?:xit|xtest|xdescribe|xcontext|fit|fdescribe)\s*\(/;
const NODE_TEST_CONTEXT_MARK = /(?:^|[^\w.$])t\s*\.\s*(?:skip|todo)\s*\(/;
// In test files: a mark called on anything (`ctx.skip()`, `testInfo.fixme()`,
// `test.info().skip()`, `d.skip(` for an alias), a bare `skip()` from
// `({ skip }) => skip()`, an alias of a test function and node:test options.
const ANY_MEMBER_MARK = new RegExp(`\\.\\s*(?:${MARK_WORD_LIST})\\s*\\(`);
const BARE_MARK_CALL = /(?:^|[^\w.$])(?:skip|fixme)\s*\(/;
const ALIAS_ASSIGNMENT =
  /(?:^|[^\w.$])(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:it|test|describe|suite|context|specify|bench)\s*(?:[;,)]|$)/;
const DESTRUCTURE_FROM = /\}\s*=\s*(?:it|test|describe|suite|context|specify|bench)\b/g;
const MARK_WORD = new RegExp(`\\b(?:${MARK_WORD_LIST})\\b`);
const NODE_TEST_OPTION = /[{,]\s*(?:skip|todo|only)\s*:(?!\s*(?:false|undefined)\b)/;

function hasMarkChain(text) {
  for (const match of text.matchAll(MEMBER_CHAIN)) {
    const parts = match[0].split(".");
    let rooted = false;
    for (const raw of parts) {
      const part = raw.trim();
      if (rooted && MARK_NAMES.has(part)) return true;
      if (MARK_ROOTS.has(part)) rooted = true;
    }
  }
  return false;
}

function destructuresMark(text) {
  for (const match of text.matchAll(DESTRUCTURE_FROM)) {
    const open = text.lastIndexOf("{", match.index);
    if (open !== -1 && MARK_WORD.test(text.slice(open, match.index))) return true;
  }
  return false;
}

/** Whether a (non-comment) line adds a skip, only, todo or expected-failure mark. */
export function isSkipMarkLine(text, { testFile = false } = {}) {
  if (text.length > MAX_LINE_LENGTH) return true;
  if (hasMarkChain(text) || PREFIX_MARK.test(text) || NODE_TEST_CONTEXT_MARK.test(text)) {
    return true;
  }
  if (!testFile) return false;
  return (
    ANY_MEMBER_MARK.test(text) ||
    BARE_MARK_CALL.test(text) ||
    ALIAS_ASSIGNMENT.test(text) ||
    destructuresMark(text) ||
    NODE_TEST_OPTION.test(text)
  );
}

function markKey(text) {
  return text.trim();
}

// Added mark lines that are not just a removed line put back (re-indented or
// moved within the same file).
function newSkipMarks(lines, testFile) {
  // Lines over MAX_LINE_LENGTH are reported as unreadable instead.
  const isMark = (line) =>
    !line.comment && line.text.length <= MAX_LINE_LENGTH && isSkipMarkLine(line.text, { testFile });
  const removed = new Map();
  for (const line of lines) {
    if (line.kind !== "remove" || !isMark(line)) continue;
    const key = markKey(line.text);
    removed.set(key, (removed.get(key) ?? 0) + 1);
  }
  let count = 0;
  for (const line of lines) {
    if (line.kind !== "add" || !isMark(line)) continue;
    const key = markKey(line.text);
    const left = removed.get(key) ?? 0;
    if (left > 0) removed.set(key, left - 1);
    else count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Test cases.

// A test case: it(...), test(...) or specify(...), optionally with modifiers
// such as .each or .concurrent, whose first argument is its title: a string,
// a variable (plain it(name, ...) and test(name, ...) only), or on the next
// line. test.describe(...), test.step(...) and hooks are not test cases, and
// Playwright's conditional test.skip(condition, reason) has no title.
const TEST_CASE_HEAD =
  /^\s*(?:await\s+)?(?:it|test|specify)((?:\.(?:each|concurrent|sequential|only|skip|todo|fails|fixme|fail|failing|slow|serial|parallel)(?:\([^)\n]*\))?)*)\s*(\(|(?=`))/;
const PLAIN_MODIFIERS = /^(?:\.(?:only|concurrent|sequential))?$/;
const VARIABLE_TITLE = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\[[^\]\n]*\])?)\s*,/;

function readQuoted(text, start) {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length && text[index] !== quote) index += text[index] === "\\" ? 2 : 1;
  return text.slice(start + 1, index);
}

/** The test case a line starts, as a key to match it by (its title), or null. */
export function testCaseKey(text) {
  if (text.length > MAX_LINE_LENGTH) return null;
  const head = TEST_CASE_HEAD.exec(text);
  if (!head) return null;
  const rest = text.slice(head.index + head[0].length);
  const first = rest.trimStart();
  const offset = rest.length - first.length;
  if (first === "") return `line:${text.trim()}`;
  if (first[0] === '"' || first[0] === "'" || first[0] === "`") {
    return `title:${readQuoted(rest, offset)}`;
  }
  if (head[2] === "(" && PLAIN_MODIFIERS.test(head[1])) {
    const variable = VARIABLE_TITLE.exec(first);
    if (variable) return `variable:${variable[1]}`;
  }
  return null;
}

const EACH_CALL = /^\s*(?:it|test)(?:\.[a-z]+)*\.each\s*[(`]/;

function caseKey(line) {
  if (line.comment) return null;
  return testCaseKey(line.text) ?? (EACH_CALL.test(line.text) ? `line:${line.text.trim()}` : null);
}

// An added test case whose body is empty on its own line, such as
// `it("x", () => {});`. It never stands in for a removed test case.
const EMPTY_BODY = /(?:=>|\))\s*\{\s*\}\s*\)\s*;?\s*$/;

// Removed and added test cases, counted separately. A test moved or edited
// within the file (same title removed and added) is neither. A test retitled
// in place (its first line replaced while its body stays) is neither either:
// in a run of changed lines, the last removed line and the first added line
// are both test cases and the next line is unchanged. An added empty test
// never cancels a removed one, so swapping real tests for empty ones is
// reported.
function testCaseChanges(lines) {
  const removed = [];
  const added = [];
  const retitled = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.kind !== "add" && line.kind !== "remove") continue;
    const key = caseKey(line);
    if (key) (line.kind === "remove" ? removed : added).push({ line, key });
  }
  // Runs of changed lines.
  let start = 0;
  while (start < lines.length) {
    if (lines[start].kind !== "add" && lines[start].kind !== "remove") {
      start += 1;
      continue;
    }
    let end = start;
    while (end < lines.length && (lines[end].kind === "add" || lines[end].kind === "remove")) {
      end += 1;
    }
    const run = lines.slice(start, end);
    const lastRemoved = run.filter((line) => line.kind === "remove").at(-1);
    const firstAdded = run.find((line) => line.kind === "add");
    if (
      lastRemoved &&
      firstAdded &&
      lines[end]?.kind === "context" &&
      caseKey(lastRemoved) &&
      caseKey(firstAdded) &&
      !EMPTY_BODY.test(firstAdded.text) &&
      run.indexOf(firstAdded) === run.indexOf(lastRemoved) + 1
    ) {
      retitled.add(lastRemoved);
      retitled.add(firstAdded);
    }
    start = end;
  }
  const remaining = new Map();
  for (const { line, key } of removed) {
    if (!retitled.has(line)) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  let addedCount = 0;
  for (const { line, key } of added) {
    if (retitled.has(line)) continue;
    const left = EMPTY_BODY.test(line.text) ? 0 : (remaining.get(key) ?? 0);
    if (left > 0) remaining.set(key, left - 1);
    else addedCount += 1;
  }
  let removedCount = 0;
  for (const count of remaining.values()) removedCount += count;
  return { removed: removedCount, added: addedCount };
}

// ---------------------------------------------------------------------------
// Native database checks: record("...") calls in the native test scripts.

const RECORD_CALL = /(?:^|[^\w.$])record\s*\(/;

function removedRecordChecks(lines) {
  const isRecord = (line) => !line.comment && RECORD_CALL.test(line.text);
  const added = new Map();
  for (const line of lines) {
    if (line.kind !== "add" || !isRecord(line)) continue;
    const key = line.text.trim();
    added.set(key, (added.get(key) ?? 0) + 1);
  }
  let count = 0;
  for (const line of lines) {
    if (line.kind !== "remove" || !isRecord(line)) continue;
    const key = line.text.trim();
    const left = added.get(key) ?? 0;
    if (left > 0) added.set(key, left - 1);
    else count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// package.json, compared as parsed JSON.

const THRESHOLD_WORDS =
  /\b(?:thresholds?|statements|branches|functions|lines|perFile|autoUpdate)\b/;

function touchesThresholds(lines) {
  return lines.some(
    (line) => (line.kind === "add" || line.kind === "remove") && THRESHOLD_WORDS.test(line.text)
  );
}

// package.json "scripts" entries that run tests or checks (and their pre and
// post hooks).
const CHECK_COMMAND_NAME =
  /^(?:pre|post)?(?:test|lint|typecheck|check|safety|security|knip|jscpd|depcruise|format:check|licenses|secret-scan|stability|quality|payments:audit|preflight)(?::.*)?$/;

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function parsePackage(text) {
  if (text === null) return {};
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function objectAt(value, ...keys) {
  let current = value;
  for (const key of keys) {
    current = current && typeof current === "object" ? current[key] : undefined;
  }
  return current && typeof current === "object" && !Array.isArray(current) ? current : {};
}

/** Where a dependency specifier takes the package from, when not the registry. */
export function dependencySource(spec) {
  const value = String(spec).trim();
  if (/^npm:/i.test(value)) return "an npm: alias";
  if (/^github:/i.test(value)) return "GitHub";
  if (/^(?:git(?:\+[a-z]+)?:|git@|ssh:)/i.test(value) || /\.git(?:#.*)?$/i.test(value))
    return "git";
  if (/^file:/i.test(value)) return "a local file";
  if (/^link:/i.test(value)) return "a local link";
  if (/^(?:\.{1,2}\/|\/|~\/)/.test(value)) return "a local path";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return "a URL";
  if (/^(?:[\w.-]+\/[\w.-]+)(?:#.*)?$/.test(value) && !value.startsWith("@")) return "GitHub";
  return null;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Compares the merge base's and the head's package.json, parsed as JSON.
 * `null` text means the file does not exist on that side. Returns null when
 * either side cannot be parsed.
 */
export function comparePackages(baseText, headText) {
  const base = parsePackage(baseText);
  const head = parsePackage(headText);
  if (!base || !head) return null;
  const baseSpecs = new Map();
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, spec] of Object.entries(objectAt(base, section))) {
      if (!baseSpecs.has(name)) baseSpecs.set(name, new Set());
      baseSpecs.get(name).add(JSON.stringify(spec));
    }
  }
  const newDependencies = [];
  const changedSources = [];
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, spec] of Object.entries(objectAt(head, section))) {
      if (!baseSpecs.has(name) && !newDependencies.includes(name)) newDependencies.push(name);
      const source = dependencySource(spec);
      const unchanged = baseSpecs.get(name)?.has(JSON.stringify(spec));
      if (source && !unchanged && !changedSources.some((entry) => entry.name === name)) {
        changedSources.push({ name, source });
      }
    }
  }

  const overrides = [];
  for (const path of [["pnpm", "overrides"], ["overrides"], ["resolutions"]]) {
    const before = objectAt(base, ...path);
    const after = objectAt(head, ...path);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!same(before[key], after[key]) && !overrides.includes(key)) overrides.push(key);
    }
  }

  const builtBefore = new Set(
    Array.isArray(base?.pnpm?.onlyBuiltDependencies) ? base.pnpm.onlyBuiltDependencies : []
  );
  const builtAfter = Array.isArray(head?.pnpm?.onlyBuiltDependencies)
    ? head.pnpm.onlyBuiltDependencies
    : [];
  const newBuilt = builtAfter.filter((name) => !builtBefore.has(name)).map(String);

  const scriptsBefore = objectAt(base, "scripts");
  const scriptsAfter = objectAt(head, "scripts");
  const changedCommands = [];
  for (const name of new Set([...Object.keys(scriptsBefore), ...Object.keys(scriptsAfter)])) {
    if (CHECK_COMMAND_NAME.test(name) && !same(scriptsBefore[name], scriptsAfter[name])) {
      changedCommands.push(name);
    }
  }

  return {
    newDependencies,
    changedSources,
    overrides,
    newBuiltDependencies: [...new Set(newBuilt)],
    packageManagerChanged: !same(base.packageManager, head.packageManager),
    changedCommands,
  };
}

// ---------------------------------------------------------------------------
// The analysis.

/**
 * Analyses a pull request's changed files.
 *
 * @param {Array<{filename: string, status?: string, previous_filename?: string, patch?: string, changes?: number}>} files
 * @param {{
 *   complete?: boolean,
 *   packages?: { base: string | null, head: string | null },
 *   suites?: ReturnType<typeof buildTestSuites>,
 * }} [options]
 *   complete: false when the file list was cut short (GitHub lists at most
 *   3000 files), so the verdict cannot be clean.
 *   packages: the text of package.json at the merge base and at the head
 *   (null where it does not exist). Without it, a package.json change is
 *   reported as unreadable.
 *   suites: which files run as tests, from buildTestSuites. Without it, only
 *   file names are used.
 */
export function analyseChanges(files, options = {}) {
  const result = {
    deletedTestFiles: [],
    removedTestCases: 0,
    addedTestCases: 0,
    removedTestCasesByFile: [],
    skipMarks: 0,
    skipMarksByFile: [],
    removedChecks: 0,
    removedChecksByFile: [],
    configGroups: [],
    configFiles: [],
    thresholdsChanged: false,
    changedCommands: [],
    newDependencies: [],
    changedSources: [],
    overrides: [],
    newBuiltDependencies: [],
    packageManagerChanged: false,
    unreadable: [],
    longLines: [],
    incomplete: options.complete === false,
  };
  const suites = options.suites ?? null;
  const isTestFile = (file) => looksLikeTest(file) || (suites ? runsAsTest(file, suites) : false);
  const runs = (file) => (suites ? runsAsTest(file, suites) : looksLikeTest(file));
  const isTestRelated = (file) =>
    isTestFile(file) || TEST_SUPPORT_PATTERNS.some((pattern) => pattern.test(file));
  const groups = new Set();
  const flagUnreadable = (file) => {
    if (!result.unreadable.includes(file)) result.unreadable.push(file);
  };

  for (const file of files) {
    const name = String(file.filename ?? "");
    const status = String(file.status ?? "modified");
    const previous = file.previous_filename ? String(file.previous_filename) : null;
    const lines = markComments(parsePatch(file.patch));
    const hasPatch = typeof file.patch === "string";
    // GitHub leaves the patch out of binary files and very large diffs. A pure
    // rename (no changed lines) has none either and needs no reading.
    const unreadable =
      !hasPatch && (status === "renamed" ? Number(file.changes) > 0 : status !== "removed");
    const codeFile = CODE_FILE.test(name);
    if (
      codeFile &&
      lines.some(
        (line) =>
          (line.kind === "add" || line.kind === "remove") && line.text.length > MAX_LINE_LENGTH
      )
    ) {
      result.longLines.push(name);
    }

    // A test file deleted, or renamed or moved so it no longer runs as a test.
    const deletedTest =
      (status === "removed" && isTestFile(name)) ||
      (status === "renamed" &&
        previous !== null &&
        ((looksLikeTest(previous) && !looksLikeTest(name)) || (runs(previous) && !runs(name))));
    if (deletedTest) {
      result.deletedTestFiles.push(status === "removed" ? name : previous);
    } else if (isTestFile(name) && status !== "added") {
      const { removed, added } = testCaseChanges(lines);
      result.addedTestCases += added;
      if (removed > 0) {
        result.removedTestCases += removed;
        result.removedTestCasesByFile.push({ file: name, count: removed, added });
      }
      if (unreadable) flagUnreadable(name);
    }

    if (codeFile && status !== "removed") {
      const marks = newSkipMarks(lines, isTestRelated(name));
      if (marks > 0) {
        result.skipMarks += marks;
        result.skipMarksByFile.push({ file: name, count: marks });
      }
      if (unreadable && isTestRelated(name)) flagUnreadable(name);
    }

    if (codeFile && name.startsWith("scripts/")) {
      const removedChecks = removedRecordChecks(lines);
      if (removedChecks > 0) {
        result.removedChecks += removedChecks;
        result.removedChecksByFile.push({ file: name, count: removedChecks });
      }
    }

    for (const candidate of previous ? [name, previous] : [name]) {
      const group = CHECK_CONFIG_GROUPS.find((entry) => entry.match(candidate));
      if (!group) continue;
      groups.add(group.id);
      if (!result.configFiles.includes(candidate)) result.configFiles.push(candidate);
      if (group.id === "test-runner" && /^vitest/.test(candidate)) {
        if (!hasPatch || touchesThresholds(lines)) result.thresholdsChanged = true;
      }
    }

    if (name === "package.json" || previous === "package.json") {
      const packages = options.packages;
      const compared = packages ? comparePackages(packages.base, packages.head) : null;
      if (!compared) {
        flagUnreadable("package.json");
      } else {
        result.changedCommands = compared.changedCommands;
        result.newDependencies = compared.newDependencies;
        result.changedSources = compared.changedSources;
        result.overrides = compared.overrides;
        result.newBuiltDependencies = compared.newBuiltDependencies;
        result.packageManagerChanged = compared.packageManagerChanged;
      }
    }
  }

  result.configGroups = CHECK_CONFIG_GROUPS.filter((group) => groups.has(group.id)).map(
    (group) => group.words
  );
  return result;
}

export function hasFindings(result) {
  return (
    result.deletedTestFiles.length > 0 ||
    result.removedTestCases > 0 ||
    result.skipMarks > 0 ||
    result.removedChecks > 0 ||
    result.configGroups.length > 0 ||
    result.thresholdsChanged ||
    result.changedCommands.length > 0 ||
    result.newDependencies.length > 0 ||
    result.changedSources.length > 0 ||
    result.overrides.length > 0 ||
    result.newBuiltDependencies.length > 0 ||
    result.packageManagerChanged ||
    result.unreadable.length > 0 ||
    result.longLines.length > 0 ||
    result.incomplete
  );
}

export function verdictLabel(result) {
  return hasFindings(result) ? LABEL_CHANGED : LABEL_CLEAN;
}

// ---------------------------------------------------------------------------
// The comment.

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function joinWords(parts, separator = ", ") {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(separator)}${separator.trim() === ";" ? "; and" : " and"} ${parts[parts.length - 1]}`;
}

// Parts that are lists themselves are separated by semicolons.
function joinClauses(parts) {
  return joinWords(parts, parts.some((part) => / and |,/.test(part)) ? "; " : ", ");
}

const MARK_WORDS = "skip, only, todo, fails or fixme";

// File and package names come from the pull request: keep them inert in
// Markdown (no mentions, links or formatting) by showing them as code, and
// drop control, bidirectional and zero-width characters that could disguise
// what they say.
export function codeName(value) {
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/`/g, "'")
    .slice(0, 200);
  return `\`${cleaned}\``;
}

/** The one-sentence summary, e.g. "This PR deletes 2 tests and changes the coverage thresholds." */
export function summarySentence(result) {
  const parts = [];
  if (result.deletedTestFiles.length > 0) {
    parts.push(`deletes ${plural(result.deletedTestFiles.length, "test file")}`);
  }
  if (result.removedTestCases > 0) {
    parts.push(`removes ${plural(result.removedTestCases, "test case")}`);
  }
  if (result.skipMarks > 0) {
    parts.push(`adds ${plural(result.skipMarks, "test skip or focus mark")}`);
  }
  if (result.removedChecks > 0) {
    parts.push(`removes ${plural(result.removedChecks, "native database check")}`);
  }
  if (result.thresholdsChanged) parts.push("changes the coverage thresholds");
  const otherGroups = result.configGroups.filter(
    (words) => !(result.thresholdsChanged && words.startsWith("the unit test configuration"))
  );
  if (otherGroups.length > 0) parts.push(`changes ${joinWords(otherGroups)}`);
  if (result.changedCommands.length > 0) {
    parts.push(
      `changes ${plural(result.changedCommands.length, "test or check command")} in package.json`
    );
  }
  if (result.newDependencies.length > 0) {
    parts.push(
      `adds ${plural(result.newDependencies.length, "new dependency", "new dependencies")}`
    );
  }
  if (result.changedSources.length > 0) {
    parts.push(
      `takes ${plural(result.changedSources.length, "dependency", "dependencies")} from outside the registry`
    );
  }
  if (result.overrides.length > 0) {
    parts.push(`changes ${plural(result.overrides.length, "dependency override")}`);
  }
  if (result.newBuiltDependencies.length > 0) {
    parts.push(
      `lets ${plural(result.newBuiltDependencies.length, "more package")} run install scripts`
    );
  }
  if (result.packageManagerChanged) parts.push("changes the package manager version");
  if (result.unreadable.length > 0) {
    parts.push(
      `changes ${plural(result.unreadable.length, "file")} whose diff is too large to read`
    );
  }
  if (result.longLines.length > 0) {
    parts.push(`changes ${plural(result.longLines.length, "file")} with lines too long to read`);
  }
  if (result.incomplete) parts.push("changes more files than GitHub lists");
  if (parts.length === 0) {
    return "This PR changes no tests or checks: it deletes no tests, adds no test skip or focus marks, leaves the check configuration alone and adds no dependencies.";
  }
  return `This PR ${joinClauses(parts)}.`;
}

// At most LIST_CAP entries of one list, then "and N more".
function capped(entries, noun) {
  if (entries.length <= LIST_CAP) return entries;
  const rest = entries.length - LIST_CAP;
  return [...entries.slice(0, LIST_CAP), `- …and ${rest} more ${noun}`];
}

const FOOTER =
  "This is information for the reviewer, not a failed check. " +
  "It is worked out from the diff alone and rewritten on every push.";

/** The full bot comment, starting with the marker the workflow looks for. */
export function renderComment(result, { headSha } = {}) {
  const lines = [MARKER, "### Test and check changes", "", summarySentence(result), ""];
  const details = [
    ...capped(
      result.deletedTestFiles.map((file) => `- Deleted test file: ${codeName(file)}`),
      "deleted test files"
    ),
    ...capped(
      result.removedTestCasesByFile.map(
        ({ file, count, added }) =>
          `- ${plural(count, "test case")} removed from ${codeName(file)}` +
          (added > 0 ? `, ${plural(added, "test case")} added` : "")
      ),
      "files with removed test cases"
    ),
    ...capped(
      result.skipMarksByFile.map(
        ({ file, count }) =>
          `- ${plural(count, "new test skip or focus mark")} (${MARK_WORDS}) in ${codeName(file)}`
      ),
      "files with new marks"
    ),
    ...capped(
      result.removedChecksByFile.map(
        ({ file, count }) =>
          `- ${plural(count, "native database check")} (\`record(...)\`) removed from ${codeName(file)}`
      ),
      "files with removed database checks"
    ),
    ...(result.thresholdsChanged ? ["- Coverage thresholds in `vitest.config.ts` changed"] : []),
    ...capped(
      result.configFiles.map((file) => `- Check configuration changed: ${codeName(file)}`),
      "check configuration files"
    ),
    ...capped(
      result.changedCommands.map(
        (name) => `- Test or check command changed in \`package.json\`: ${codeName(name)}`
      ),
      "commands"
    ),
    ...capped(
      result.newDependencies.map((name) => `- New dependency: ${codeName(name)}`),
      "new dependencies"
    ),
    ...capped(
      result.changedSources.map(
        ({ name, source }) => `- Dependency taken from ${source}: ${codeName(name)}`
      ),
      "dependencies from outside the registry"
    ),
    ...capped(
      result.overrides.map(
        (name) => `- Dependency override added, changed or removed: ${codeName(name)}`
      ),
      "overrides"
    ),
    ...capped(
      result.newBuiltDependencies.map(
        (name) => `- Now allowed to run install scripts: ${codeName(name)}`
      ),
      "packages allowed to run install scripts"
    ),
    ...(result.packageManagerChanged ? ["- `packageManager` changed in `package.json`"] : []),
    ...capped(
      result.unreadable.map((file) => `- Diff too large to read, check by hand: ${codeName(file)}`),
      "unreadable files"
    ),
    ...capped(
      result.longLines.map(
        (file) =>
          `- Lines over ${MAX_LINE_LENGTH} characters, not read, check by hand: ${codeName(file)}`
      ),
      "files with long lines"
    ),
    ...(result.incomplete
      ? ["- GitHub listed only part of the changed files; check the rest by hand"]
      : []),
  ];
  const label = verdictLabel(result);
  const tail = [`Label: \`${label}\`. ${FOOTER}`];
  if (headSha && /^[0-9a-f]{7,40}$/.test(headSha)) {
    tail.push("", `<sub>Checked at ${headSha.slice(0, 12)}.</sub>`);
  }
  // Each list is capped; this keeps the whole comment under GitHub's limit
  // whatever the lists hold.
  const budget = MAX_COMMENT_LENGTH - [...lines, ...tail].join("\n").length - 200;
  let used = 0;
  let shown = 0;
  for (const detail of details) {
    if (used + detail.length + 1 > budget) break;
    used += detail.length + 1;
    shown += 1;
  }
  if (shown > 0) lines.push(...details.slice(0, shown));
  if (shown < details.length) {
    lines.push(`- …and ${details.length - shown} more details; check the pull request by hand`);
  }
  if (details.length > 0) lines.push("");
  lines.push(...tail);
  return `${lines.join("\n")}\n`;
}

/** The comment written when the guard could not finish. */
export function renderFailureComment() {
  return [
    MARKER,
    "### Test and check changes",
    "",
    COULD_NOT_CHECK,
    "",
    `Label: \`${LABEL_CHANGED}\`. The guard stopped before it finished; the reason is in the ` +
      "Check changes workflow log. It runs again on the next push.",
    "",
  ].join("\n");
}

/**
 * Splits `git diff` output into API-shaped file entries, for fixtures and for
 * running the guard locally (`git diff origin/main... | node scripts/check-changed-checks.mjs --diff -`).
 */
export function filesFromGitDiff(text) {
  const files = [];
  let current = null;
  let patchLines = null;
  const finish = () => {
    if (!current) return;
    if (patchLines && patchLines.length > 0) current.patch = patchLines.join("\n");
    files.push(current);
  };
  for (const raw of text.split("\n")) {
    const start = /^diff --git a\/(.+) b\/(.+)$/.exec(raw);
    if (start) {
      finish();
      current = { filename: start[2], status: "modified" };
      patchLines = null;
      continue;
    }
    if (!current) continue;
    if (patchLines) {
      patchLines.push(raw);
      continue;
    }
    if (raw.startsWith("new file mode")) current.status = "added";
    else if (raw.startsWith("deleted file mode")) current.status = "removed";
    else if (raw.startsWith("rename from ")) {
      current.status = "renamed";
      current.previous_filename = raw.slice("rename from ".length);
    } else if (raw.startsWith("rename to ")) current.filename = raw.slice("rename to ".length);
    else if (raw.startsWith("@@")) patchLines = [raw];
  }
  finish();
  for (const file of files) {
    if (file.patch) file.patch = file.patch.replace(/\n$/, "");
  }
  return files;
}
