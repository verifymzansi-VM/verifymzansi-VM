// Detection logic for the check-change guard (.github/workflows/check-changes.yml,
// scripts/check-changed-checks.mjs). It reads a pull request's changed files,
// as the GitHub API lists them ({ filename, status, previous_filename, patch }),
// and reports in plain words whether the pull request weakens or changes the
// repository's tests and checks:
//
//   - deleted test files, and test cases removed from test files;
//   - new skip, only, todo, fails, fixme or expected-failure marks;
//   - changes to the files that configure the checks (coverage thresholds,
//     audit baselines, rulesets, workflows, check scripts, lint and scanner
//     configuration, browser test configuration, visual baselines, the
//     database contract steps) and to the test and check commands;
//   - new top-level dependencies in package.json.
//
// Everything here is pure: file names and patch text are data. Nothing is
// executed, and the pull request's title, description and commit messages are
// never read, so its author cannot steer the verdict.

export const MARKER = "<!-- check-change-guard -->";
export const LABEL_CHANGED = "checks-changed";
export const LABEL_CLEAN = "checks-clean";

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;

// Files whose tests run: unit and component tests, node:test tooling tests,
// browser specs and the native database test scripts.
const TEST_FILE_PATTERNS = [
  /(?:^|\/)__tests__\//,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /^scripts\/test-[^/]+\.[cm]?[jt]s$/,
];

// Files that only support tests; a skip mark added here still turns tests off.
const TEST_SUPPORT_PATTERNS = [/^e2e\//, /^src\/test\//];

function isTestFile(file) {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(file));
}

function isTestRelated(file) {
  return isTestFile(file) || TEST_SUPPORT_PATTERNS.some((pattern) => pattern.test(file));
}

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
      /^vitest(?:\.[^/]+)?\.config\.[cm]?[jt]s$/.test(file) || file === "scripts/run-vitest.ts",
  },
  {
    id: "audit-baselines",
    words: "the audit baselines",
    match: (file) => file.startsWith("scripts/audit-baselines/"),
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
    id: "check-scripts",
    words: "the check scripts",
    match: (file) =>
      /^scripts\/check-[^/]+$/.test(file) ||
      file === "scripts/lib/check-changes.mjs" ||
      file === "scripts/run-safety-gate.ts",
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
    id: "eslint",
    words: "the ESLint configuration",
    match: (file) =>
      /^eslint\.config\.[cm]?[jt]s$/.test(file) ||
      /(?:^|\/)\.eslintrc(?:\.[a-z]+)?$/.test(file) ||
      file === ".eslintignore" ||
      file.startsWith("scripts/eslint-rules/"),
  },
  {
    id: "playwright",
    words: "the Playwright configuration",
    match: (file) => /^playwright(?:\.[^/]+)?\.config\.[cm]?[jt]s$/.test(file),
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

// package.json "scripts" entries that run tests or checks.
const CHECK_COMMAND_KEY =
  /^\s*"((?:test|lint|typecheck|check|safety|security|knip|jscpd|depcruise|format:check|licenses|secret-scan|stability|quality|payments:audit|preflight)(?::[^"]*)?)"\s*:/;

const DEPENDENCY_SECTIONS = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);

// A test case: it(...) or test(...), optionally with modifiers such as .each
// or .concurrent, whose first argument is its title (a string, or on the next
// line). test.describe(...), test.step(...) and hooks are not test cases, and
// Playwright's conditional test.skip(condition, reason) has no title.
const TEST_CASE =
  /^\s*(?:await\s+)?(?:it|test|specify)(?:\.(?:each|concurrent|sequential|only|skip|todo|fails|fixme|fail|failing|slow|serial|parallel)(?:\([^)]*\))?)*\s*(?:\(\s*(?:["'`]|$)|`)/;
const EACH_CALL = /^\s*(?:it|test)(?:\.[a-z]+)*\.each\s*[(`]/;

// Marks that turn a test off, make it the only one that runs, or expect it to
// fail. The call forms are specific enough to match in any code file.
const SKIP_MARKS = [
  /\b(?:it|test|describe|suite|bench|specify|context)(?:\.[A-Za-z]+)*\.(?:skip|only|todo|fails|fixme|fail|failing|skipIf|runIf)\b/,
  /(?:^|[^\w.$])(?:xit|xtest|xdescribe|xcontext|fit|fdescribe)\s*\(/,
  /\bt\.(?:skip|todo)\s*\(/,
];
// node:test options ({ skip: true }, { todo: "..." }, { only: true }); only in
// test files, because "skip" is an ordinary option name elsewhere.
const NODE_TEST_OPTION = /[{,]\s*(?:skip|todo|only)\s*:(?!\s*(?:false|undefined)\b)/;

function isComment(line) {
  return /^\s*(?:\/\/|\/\*|\*)/.test(line);
}

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

function isTestCaseLine(text) {
  return !isComment(text) && (TEST_CASE.test(text) || EACH_CALL.test(text));
}

function isSkipMarkLine(text, file) {
  if (isComment(text)) return false;
  if (SKIP_MARKS.some((pattern) => pattern.test(text))) return true;
  return isTestFile(file) && NODE_TEST_OPTION.test(text);
}

function countTestCases(lines, kind) {
  return lines.filter((line) => line.kind === kind && isTestCaseLine(line.text)).length;
}

// Added mark lines that are not just a removed line put back (re-indented or
// moved within the same file).
function newSkipMarks(lines, file) {
  const removed = new Map();
  for (const line of lines) {
    if (line.kind !== "remove" || !isSkipMarkLine(line.text, file)) continue;
    const key = line.text.trim();
    removed.set(key, (removed.get(key) ?? 0) + 1);
  }
  let count = 0;
  for (const line of lines) {
    if (line.kind !== "add" || !isSkipMarkLine(line.text, file)) continue;
    const key = line.text.trim();
    const left = removed.get(key) ?? 0;
    if (left > 0) removed.set(key, left - 1);
    else count += 1;
  }
  return count;
}

const THRESHOLD_WORDS =
  /\b(?:thresholds?|statements|branches|functions|lines|perFile|autoUpdate)\b/;

function touchesThresholds(lines) {
  return lines.some(
    (line) => (line.kind === "add" || line.kind === "remove") && THRESHOLD_WORDS.test(line.text)
  );
}

const VERSION_SPEC =
  /^(?:[\^~<>=]*\s*v?\d|\*$|latest$|next$|workspace:|npm:|catalog:|link:|file:|git(?:\+[a-z]+)?:|github:|https?:|[\w.-]+\/[\w.-]+(?:#.*)?$)/;
const TOP_LEVEL_KEY = /^ {2}"([^"]+)"\s*:/;
const ENTRY = /^ {4}"([^"]+)"\s*:\s*"([^"]*)"/;

function sectionAt(baseLines, oldLine) {
  for (let index = Math.min(oldLine, baseLines.length) - 1; index >= 0; index -= 1) {
    const key = TOP_LEVEL_KEY.exec(baseLines[index]);
    if (key) return key[1];
    if (/^\{\s*$/.test(baseLines[index])) return null;
  }
  return null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * New top-level dependencies in a package.json patch. basePackageJson is the
 * text of main's package.json (to find the section a hunk starts in, and to
 * tell a new package from a moved or re-versioned one); without it, only the
 * patch itself is used.
 */
export function newDependencies(lines, basePackageJson) {
  const baseLines = typeof basePackageJson === "string" ? basePackageJson.split("\n") : [];
  const base = typeof basePackageJson === "string" ? parseJson(basePackageJson) : null;
  const known = new Set();
  const topLevel = new Set();
  if (base && typeof base === "object") {
    for (const [section, value] of Object.entries(base)) {
      if (!value || typeof value !== "object") continue;
      for (const name of Object.keys(value)) {
        if (DEPENDENCY_SECTIONS.has(section)) known.add(name);
        else topLevel.add(name);
      }
    }
  }
  const removed = new Set();
  for (const line of lines) {
    const entry = line.kind === "remove" && ENTRY.exec(line.text);
    if (entry) removed.add(entry[1]);
  }

  const found = [];
  let section = null;
  for (const line of lines) {
    if (line.kind === "hunk") {
      section = sectionAt(baseLines, line.oldLine);
      continue;
    }
    const key = TOP_LEVEL_KEY.exec(line.text);
    if (key) {
      if (line.kind !== "remove") section = key[1];
      continue;
    }
    if (/^ {2}\}/.test(line.text) && line.kind !== "remove") {
      section = null;
      continue;
    }
    if (line.kind !== "add") continue;
    const entry = ENTRY.exec(line.text);
    if (!entry) continue;
    const [, name, spec] = entry;
    const inDependencies =
      section === null
        ? VERSION_SPEC.test(spec.trim()) && !topLevel.has(name)
        : DEPENDENCY_SECTIONS.has(section);
    if (!inDependencies || known.has(name) || removed.has(name)) continue;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

function changedCommands(lines) {
  const names = new Set();
  for (const line of lines) {
    if (line.kind !== "add" && line.kind !== "remove") continue;
    const match = CHECK_COMMAND_KEY.exec(line.text);
    if (match) names.add(match[1]);
  }
  return [...names];
}

/**
 * Analyses a pull request's changed files.
 *
 * @param {Array<{filename: string, status?: string, previous_filename?: string, patch?: string}>} files
 * @param {{ basePackageJson?: string, complete?: boolean }} [options]
 *   complete: false when the file list was cut short (GitHub lists at most
 *   3000 files), so the verdict cannot be clean.
 */
export function analyseChanges(files, options = {}) {
  const result = {
    deletedTestFiles: [],
    removedTestCases: 0,
    removedTestCasesByFile: [],
    skipMarks: 0,
    skipMarksByFile: [],
    configGroups: [],
    configFiles: [],
    thresholdsChanged: false,
    changedCommands: [],
    newDependencies: [],
    unreadable: [],
    incomplete: options.complete === false,
  };
  const groups = new Map();

  for (const file of files) {
    const name = String(file.filename ?? "");
    const status = String(file.status ?? "modified");
    const previous = file.previous_filename ? String(file.previous_filename) : null;
    const lines = parsePatch(file.patch);
    const hasPatch = typeof file.patch === "string";
    // GitHub leaves the patch out of binary files and very large diffs. A pure
    // rename (no changed lines) has none either and needs no reading.
    const unreadable =
      !hasPatch && (status === "renamed" ? Number(file.changes) > 0 : status !== "removed");

    // A test file deleted, or renamed so it no longer runs as a test.
    const deletedTest =
      (status === "removed" && isTestFile(name)) ||
      (status === "renamed" && previous && isTestFile(previous) && !isTestFile(name));
    if (deletedTest) {
      result.deletedTestFiles.push(status === "removed" ? name : previous);
    } else if (isTestFile(name) && status !== "added") {
      const net = countTestCases(lines, "remove") - countTestCases(lines, "add");
      if (net > 0) {
        result.removedTestCases += net;
        result.removedTestCasesByFile.push({ file: name, count: net });
      }
      if (unreadable) result.unreadable.push(name);
    }

    if (CODE_FILE.test(name) && status !== "removed") {
      const marks = newSkipMarks(lines, name);
      if (marks > 0) {
        result.skipMarks += marks;
        result.skipMarksByFile.push({ file: name, count: marks });
      }
      if (unreadable && isTestRelated(name) && !result.unreadable.includes(name)) {
        result.unreadable.push(name);
      }
    }

    for (const candidate of previous ? [name, previous] : [name]) {
      const group = CHECK_CONFIG_GROUPS.find((entry) => entry.match(candidate));
      if (!group) continue;
      if (!groups.has(group.id)) groups.set(group.id, group);
      if (!result.configFiles.includes(candidate)) result.configFiles.push(candidate);
      if (group.id === "test-runner" && /^vitest/.test(candidate)) {
        if (!hasPatch || touchesThresholds(lines)) result.thresholdsChanged = true;
      }
    }

    if (name === "package.json") {
      if (!hasPatch) {
        result.unreadable.push(name);
      } else {
        result.changedCommands = changedCommands(lines);
        result.newDependencies = newDependencies(lines, options.basePackageJson);
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
    result.configGroups.length > 0 ||
    result.thresholdsChanged ||
    result.changedCommands.length > 0 ||
    result.newDependencies.length > 0 ||
    result.unreadable.length > 0 ||
    result.incomplete
  );
}

export function verdictLabel(result) {
  return hasFindings(result) ? LABEL_CHANGED : LABEL_CLEAN;
}

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
// Markdown (no mentions, links or formatting) by showing them as code.
export function codeName(value) {
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, "")
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
  if (result.unreadable.length > 0) {
    parts.push(
      `changes ${plural(result.unreadable.length, "file")} whose diff is too large to read`
    );
  }
  if (result.incomplete) parts.push("changes more files than GitHub lists");
  if (parts.length === 0) {
    return "This PR changes no tests or checks: it deletes no tests, adds no test skip or focus marks, leaves the check configuration alone and adds no dependencies.";
  }
  return `This PR ${joinClauses(parts)}.`;
}

/** The full bot comment, starting with the marker the workflow looks for. */
export function renderComment(result, { headSha } = {}) {
  const lines = [MARKER, "### Test and check changes", "", summarySentence(result), ""];
  const details = [];
  for (const file of result.deletedTestFiles)
    details.push(`- Deleted test file: ${codeName(file)}`);
  for (const { file, count } of result.removedTestCasesByFile) {
    details.push(`- ${plural(count, "test case")} removed from ${codeName(file)}`);
  }
  for (const { file, count } of result.skipMarksByFile) {
    details.push(
      `- ${plural(count, "new test skip or focus mark")} (${MARK_WORDS}) in ${codeName(file)}`
    );
  }
  if (result.thresholdsChanged) details.push("- Coverage thresholds in `vitest.config.ts` changed");
  for (const file of result.configFiles)
    details.push(`- Check configuration changed: ${codeName(file)}`);
  for (const name of result.changedCommands) {
    details.push(`- Test or check command changed in \`package.json\`: ${codeName(name)}`);
  }
  for (const name of result.newDependencies) details.push(`- New dependency: ${codeName(name)}`);
  for (const file of result.unreadable)
    details.push(`- Diff too large to read, check by hand: ${codeName(file)}`);
  if (result.incomplete)
    details.push("- GitHub listed only part of the changed files; check the rest by hand");
  if (details.length > 0) lines.push(...details, "");
  lines.push(
    `Label: \`${verdictLabel(result)}\`. This is information for the reviewer, not a failed check. ` +
      "It is worked out from the diff alone and rewritten on every push."
  );
  if (headSha && /^[0-9a-f]{7,40}$/.test(headSha))
    lines.push("", `<sub>Checked at ${headSha.slice(0, 12)}.</sub>`);
  return `${lines.join("\n")}\n`;
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
