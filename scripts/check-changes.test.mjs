import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { markCouldNotCheck, readBaseSuites, run } from "./check-changed-checks.mjs";
import {
  CHECK_SCRIPT_LIBS,
  COULD_NOT_CHECK,
  LABEL_CHANGED,
  LABEL_CLEAN,
  LIST_CAP,
  MARKER,
  MAX_LINE_LENGTH,
  analyseChanges,
  buildTestSuites,
  checkConfigGroup,
  codeName,
  comparePackages,
  dependencySource,
  filesFromGitDiff,
  globToRegExp,
  hasFindings,
  isSkipMarkLine,
  markComments,
  parsePatch,
  renderComment,
  summarySentence,
  testCaseKey,
  verdictLabel,
} from "./lib/check-changes.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(repoRoot, "scripts", "fixtures", "check-changes");
const fixture = (name) => readFileSync(path.join(fixtures, name), "utf8");
const basePackage = fixture("base-package.json");
const headPackage = fixture("head-package.json");
const cleanHeadPackage = basePackage.replace('"zod": "4.0.0"', '"zod": "4.1.0"');
const analyseFixture = (name, options = {}) =>
  analyseChanges(filesFromGitDiff(fixture(name)), options);

// A one-file change with the given added and removed lines.
const patchOf = (...lines) => `@@ -1,${lines.length} +1,${lines.length} @@\n${lines.join("\n")}`;
const modified = (filename, ...lines) => ({
  filename,
  status: "modified",
  patch: patchOf(...lines),
});
const marksIn = (filename, ...lines) => analyseChanges([modified(filename, ...lines)]).skipMarks;

// Suites shaped like this repository's configuration.
const suites = buildTestSuites({
  vitestConfig: 'const include = lane ? globs : ["src/**/*.{test,spec}.{ts,tsx}"];',
  playwrightConfigs: {
    "playwright.foundation.config.ts":
      'export default defineConfig({\n  testDir: "./e2e/foundation",\n  testIgnore: ["visual-regression.spec.ts"],\n});',
    "playwright.visual.config.ts":
      'export default defineConfig({\n  testDir: "./e2e/foundation",\n  testMatch: "visual-regression.spec.ts",\n});',
    "playwright.launch-config.config.ts":
      'import foundation from "./playwright.foundation.config";\nexport default defineConfig({\n  ...foundation,\n  testIgnore: "visual-regression.spec.ts",\n});',
  },
  packageJsons: [
    JSON.stringify({ scripts: { "test:tooling": "node --test scripts/frontend-freeze.test.mjs" } }),
  ],
});

test("filesFromGitDiff turns git diff output into API-shaped entries", () => {
  const files = filesFromGitDiff(fixture("clean.diff"));
  assert.deepEqual(
    files.map(({ filename, status, previous_filename }) => ({
      filename,
      status,
      previous_filename,
    })),
    [
      { filename: "src/lib/format.ts", status: "modified", previous_filename: undefined },
      { filename: "src/lib/format.test.ts", status: "added", previous_filename: undefined },
      { filename: "src/lib/orders.test.ts", status: "modified", previous_filename: undefined },
      {
        filename: "src/lib/new-name.test.ts",
        status: "renamed",
        previous_filename: "src/lib/old-name.test.ts",
      },
      { filename: "package.json", status: "modified", previous_filename: undefined },
    ]
  );
  assert.equal(files[3].patch, undefined);
  assert.match(files[0].patch, /^@@ -1,3 \+1,4 @@/);
});

test("parsePatch tracks old and new line numbers", () => {
  const lines = parsePatch("@@ -4,3 +10,3 @@ header\n a\n-b\n+c\n\\ No newline at end of file");
  assert.deepEqual(
    lines.map(({ kind, oldLine, newLine }) => [kind, oldLine, newLine]),
    [
      ["hunk", 4, 10],
      ["context", 4, 10],
      ["remove", 5, undefined],
      ["add", undefined, 11],
    ]
  );
});

test("an ordinary change with new tests is clean", () => {
  const result = analyseFixture("clean.diff", {
    packages: { base: basePackage, head: cleanHeadPackage },
    suites,
  });
  assert.equal(hasFindings(result), false, JSON.stringify(result));
  assert.equal(verdictLabel(result), LABEL_CLEAN);
  assert.equal(result.addedTestCases, 1);
  assert.match(summarySentence(result), /^This PR changes no tests or checks/);
});

test("deleted test files, removed test cases and threshold changes are reported", () => {
  const result = analyseFixture("deleted-tests.diff");
  assert.deepEqual(result.deletedTestFiles, ["src/lib/money.test.ts"]);
  // Three removed, one retitled in place: two test cases are gone.
  assert.equal(result.removedTestCases, 2);
  assert.deepEqual(result.removedTestCasesByFile, [
    { file: "src/lib/orders.test.ts", count: 2, added: 0 },
  ]);
  assert.equal(result.thresholdsChanged, true);
  assert.equal(verdictLabel(result), LABEL_CHANGED);
  assert.equal(
    summarySentence(result),
    "This PR deletes 1 test file, removes 2 test cases and changes the coverage thresholds."
  );
});

test("new skip, only, todo, fails and fixme marks are counted, comments and app code are not", () => {
  const result = analyseFixture("skip-marks.diff");
  assert.deepEqual(result.skipMarksByFile, [
    { file: "src/lib/orders.test.ts", count: 8 },
    { file: "e2e/foundation/checkout.spec.ts", count: 3 },
    { file: "scripts/frontend-freeze.test.mjs", count: 1 },
  ]);
  assert.equal(result.skipMarks, 12);
  assert.equal(result.removedTestCases, 0);
  assert.match(summarySentence(result), /adds 12 test skip or focus marks/);
});

test("a re-indented or moved existing mark is not new", () => {
  assert.equal(analyseFixture("moved-marks.diff").skipMarks, 0);
});

test("only lines that are wholly comments are skipped as comments", () => {
  const file = "src/lib/a.test.ts";
  assert.equal(marksIn(file, '+/**/ describe.skip("x", () => {});'), 1);
  assert.equal(marksIn(file, '+/* off */ it.only("x", () => {}); // note'), 1);
  assert.equal(marksIn(file, '+// it.skip("x")', '+/* it.skip("y") */'), 0);
  assert.equal(marksIn(file, "+/**", '+ * test.only("in a doc comment")', "+ */"), 0);
  // No opener in sight: `* describe.skip(` may continue a multiplication.
  assert.equal(marksIn(file, "+const n = 1", '+  * describe.skip("x", () => {})'), 1);
  // A backtick may close a template literal that looked like a comment opener.
  assert.equal(
    marksIn(file, "+const s = `", "+/*", "+* `; void 0", '+* describe.skip("x", () => {})'),
    1
  );
  assert.equal(marksIn(file, '+const s = "\\', '+// "; test.skip("x")'), 1);
  // A doc comment opened before the hunk is read as code: a false report at worst.
  assert.equal(marksIn(file, '+ * use test.only("x") to debug'), 1);
  assert.deepEqual(
    markComments(parsePatch(patchOf("+// a", "+code(); // b", "+/* c */"))).map(
      (line) => line.comment
    ),
    [undefined, true, false, true]
  );
});

test("marks called on any identifier, aliases and context skips are found in test files", () => {
  const file = "src/lib/a.test.ts";
  for (const line of [
    "+  ctx.skip();",
    '+it("x", ({ skip }) => skip());',
    '+  testInfo.fixme(true, "down");',
    "+  testInfo.skip();",
    "+  test.info().skip();",
    "+  testInfo.fail();",
    "+const d = describe;",
    '+d.skip("x", () => {});',
    "+const { skip } = test;",
    "+const { only: focus } = it;",
    '+t.todo("later");',
  ]) {
    assert.equal(marksIn(file, line), 1, line);
  }
  assert.equal(marksIn("e2e/support/fixtures.ts", "+  testInfo.skip();"), 1);
  // Outside test files these are ordinary method names.
  assert.equal(marksIn("src/lib/list.ts", "+const rows = builder.skip(10);", "+ctx.skip();"), 0);
  assert.equal(marksIn("src/lib/a.test.ts", '+const { data } = test("x");'), 0);
});

test("mark detection stays linear and very long lines count as unreadable", () => {
  const adversarial = [
    "test.".repeat(Math.floor(MAX_LINE_LENGTH / 5)),
    `${"a ".repeat(MAX_LINE_LENGTH / 2 - 10)}`,
    `{${" skip".repeat(390)} } = tes`,
    `${"}=test ".repeat(280)}`,
    `${".skip".repeat(390)}`,
  ];
  for (const text of adversarial) {
    const started = performance.now();
    for (let round = 0; round < 20; round += 1) isSkipMarkLine(text, { testFile: true });
    assert.ok(performance.now() - started < 500, `slow on ${text.slice(0, 20)}`);
  }
  const huge = `+${"test.".repeat(32_000)}`;
  const started = performance.now();
  const result = analyseChanges([modified("src/lib/a.test.ts", huge)]);
  assert.ok(performance.now() - started < 1000);
  assert.deepEqual(result.longLines, ["src/lib/a.test.ts"]);
  assert.equal(result.skipMarks, 0);
  assert.equal(verdictLabel(result), LABEL_CHANGED);
  assert.match(summarySentence(result), /lines too long to read/);
  assert.equal(isSkipMarkLine("x".repeat(MAX_LINE_LENGTH + 1)), true);
});

test("removed and added test cases are counted separately", () => {
  const swap = analyseChanges([
    modified(
      "src/lib/orders.test.ts",
      '-it("rejects an order without a buyer", () => {',
      "-  expect(() => createOrder({})).toThrow();",
      "-});",
      '-it("keeps the total", () => {',
      "-  expect(total()).toBe(5);",
      "-});",
      '+it("rejects an order without a buyer", () => {});',
      '+it("keeps the total", () => {});'
    ),
  ]);
  // Same titles, bodies gone: the old cases are removed and empty ones added.
  // (Deleting assertions inside a test that keeps its body is not detected.)
  assert.deepEqual(swap.removedTestCasesByFile, [
    { file: "src/lib/orders.test.ts", count: 2, added: 2 },
  ]);
  assert.ok(
    renderComment(swap).includes(
      "- 2 test cases removed from `src/lib/orders.test.ts`, 2 test cases added"
    )
  );

  const moved = analyseChanges([
    modified("src/lib/a.test.ts", '-it("x", () => {', "-});", '+  it("x", () => {', "+  });"),
  ]);
  assert.equal(moved.removedTestCases, 0);
  assert.equal(moved.addedTestCases, 0);

  const variables = analyseChanges([
    modified(
      "src/lib/a.test.ts",
      "-it(name, () => {",
      "-});",
      "-test(cases.first, async () => {});",
      "-test.only(title, () => {});",
      " const keep = 1;"
    ),
  ]);
  assert.equal(variables.removedTestCases, 3);
  assert.equal(testCaseKey('  test.skip(isMobile, "flaky")'), null);
  assert.equal(testCaseKey("it.each([1, 2])('adds %i', (n) => {"), "title:adds %i");
  assert.equal(testCaseKey("test(name, () => {"), "variable:name");
});

test("a test file renamed or moved out of the runners' include patterns counts as deleted", () => {
  const rename = (from, to) =>
    analyseChanges([{ filename: to, previous_filename: from, status: "renamed", changes: 0 }], {
      suites,
    }).deletedTestFiles;
  assert.deepEqual(rename("src/lib/a.test.ts", "src/lib/a.test.mts"), ["src/lib/a.test.ts"]);
  assert.deepEqual(rename("src/lib/a.test.ts", "scripts/a.test.ts"), ["src/lib/a.test.ts"]);
  assert.deepEqual(rename("e2e/foundation/pay.spec.ts", "e2e/pay.spec.ts"), [
    "e2e/foundation/pay.spec.ts",
  ]);
  assert.deepEqual(
    rename("e2e/foundation/pay.spec.ts", "e2e/foundation/visual-regression.spec.ts"),
    []
  );
  assert.deepEqual(rename("scripts/frontend-freeze.test.mjs", "scripts/other.test.mjs"), [
    "scripts/frontend-freeze.test.mjs",
  ]);
  assert.deepEqual(rename("src/lib/a.test.ts", "src/lib/b.spec.tsx"), []);
  assert.deepEqual(rename("src/old-name.test.ts", "src/new-name.test.ts"), []);
});

test("the include patterns are read from main's vitest and Playwright configs", () => {
  const real = readBaseSuites(repoRoot);
  const runners = (file) => real.filter((suite) => suite.matches(file)).map((s) => s.runner);
  assert.deepEqual(runners("src/lib/a.test.ts"), ["vitest"]);
  assert.deepEqual(runners("src/lib/a.test.mts"), []);
  assert.ok(
    runners("e2e/foundation/a11y.spec.ts").includes("playwright (playwright.foundation.config.ts)")
  );
  assert.deepEqual(runners("e2e/foundation/visual-regression.spec.ts"), [
    "playwright (playwright.visual.config.ts)",
  ]);
  assert.deepEqual(runners("scripts/check-changes.test.mjs"), ["package.json scripts"]);
  assert.deepEqual(runners("scripts/a.test.ts"), []);
  assert.ok(globToRegExp("**/*.@(spec|test).?(c|m)[jt]s?(x)").test("a/b.spec.mts"));
  assert.ok(!globToRegExp("src/**/*.{test,spec}.{ts,tsx}").test("src/a.test.mts"));
  assert.ok(globToRegExp("src/**/*.{test,spec}.{ts,tsx}").test("src/a.spec.tsx"));
});

test("removed native database checks and changes to the native checks are reported", () => {
  const result = analyseChanges([
    modified(
      "scripts/test-foundation-customer-invoices.mjs",
      '-  record("native-invoice-totals");',
      '-  record("native-invoice-currency");',
      '+  record("native-invoice-currency");',
      "-  const kept = transfers.record(admin, {});"
    ),
    modified("scripts/lib/foundation-access-matrix-native.mjs", '-  "orgAdmin:x:y",'),
    modified("scripts/lib/foundation-activity-native.mjs", "-  const x = 1;", "+  const x = 2;"),
  ]);
  assert.equal(result.removedChecks, 1);
  assert.deepEqual(result.configGroups, [
    "the reviewed database access list",
    "the native database checks",
  ]);
  assert.match(summarySentence(result), /removes 1 native database check/);
});

test("every check-configuration group is reported, including binary baselines", () => {
  const result = analyseFixture("config-files.diff");
  assert.deepEqual(result.configGroups, [
    "the audit baselines",
    "the legacy surface baseline",
    "the branch rulesets",
    "the CI workflows",
    "the check scripts",
    "the unused-code (knip) configuration",
    "the Semgrep ignore list",
    "the Gitleaks allowlist",
    "the ESLint configuration",
    "the Playwright configuration",
    "the browser test skip policy",
    "the visual baseline images",
    "the database contract steps",
  ]);
  assert.equal(result.configFiles.length, 13);
  assert.match(
    summarySentence(result),
    /^This PR changes the audit baselines, the legacy surface baseline, .* and the database contract steps\.$/
  );
  assert.equal(result.unreadable.length, 0);
  assert.equal(verdictLabel(result), LABEL_CHANGED);
});

test("dependency, type, lint, scanner and repository settings are check configuration", () => {
  for (const file of [
    ".npmrc",
    "osv-scanner.toml",
    "patches/next@16.0.0.patch",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "tsconfig.typecheck.json",
    ".dependency-cruiser.cjs",
    ".jscpd.json",
    "lighthouse.config.json",
    ".github/CODEOWNERS",
    ".github/dependabot.yml",
    "src/test/setup.ts",
    "scripts/security-audit.ts",
    "scripts/dependency-audit-policy.ts",
    "scripts/lib/check-registry.ts",
    "scripts/lib/foundation-activity-native.mjs",
  ]) {
    assert.ok(checkConfigGroup(file), file);
  }
  assert.equal(checkConfigGroup("src/lib/format.ts"), null);
});

// Every scripts/lib file a check script (or the security audit) imports,
// directly or through another lib, must be listed in CHECK_SCRIPT_LIBS.
test("every lib a check script imports is check configuration", () => {
  const importPattern =
    /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g;
  const resolve = (from, spec) => {
    const base = path.posix.join(path.posix.dirname(from), spec);
    return [base, ...[".mjs", ".js", ".ts", ".cjs", ".mts"].map((ext) => base + ext)].find(
      (candidate) => existsSync(path.join(repoRoot, candidate)) && !candidate.endsWith("/")
    );
  };
  const queue = [
    ...readdirSync(path.join(repoRoot, "scripts"))
      .filter((name) => /^check-.*\.[cm]?[jt]s$/.test(name) && !/\.test\./.test(name))
      .map((name) => `scripts/${name}`),
    "scripts/security-audit.ts",
  ];
  const seen = new Set();
  const missing = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(path.join(repoRoot, file), "utf8");
    for (const match of text.matchAll(importPattern)) {
      const target = resolve(file, match[1]);
      if (!target || !target.startsWith("scripts/")) continue;
      if (target.startsWith("scripts/lib/") && !checkConfigGroup(target)) missing.push(target);
      queue.push(target);
    }
  }
  assert.deepEqual([...new Set(missing)], [], "add these to CHECK_SCRIPT_LIBS");
  for (const lib of CHECK_SCRIPT_LIBS) assert.ok(existsSync(path.join(repoRoot, lib)), lib);
});

test("a vitest.config.ts change away from the thresholds is a test configuration change", () => {
  const files = [
    {
      filename: "vitest.config.ts",
      status: "modified",
      patch: "@@ -30,1 +30,1 @@\n-    testTimeout: 10000,\n+    testTimeout: 20000,",
    },
  ];
  const result = analyseChanges(files);
  assert.equal(result.thresholdsChanged, false);
  assert.equal(summarySentence(result), "This PR changes the unit test configuration.");
});

test("new dependencies and changed check commands come from the parsed package.json files", () => {
  const result = analyseFixture("new-dependencies.diff", {
    packages: { base: basePackage, head: headPackage },
  });
  assert.deepEqual(result.newDependencies, ["left-pad", "@scope/new-tool"]);
  assert.deepEqual(result.changedCommands, ["test"]);
  assert.equal(
    summarySentence(result),
    "This PR changes 1 test or check command in package.json and adds 2 new dependencies."
  );
});

test("a package.json change that cannot be compared is unreadable", () => {
  const files = filesFromGitDiff(fixture("new-dependencies.diff"));
  assert.deepEqual(analyseChanges(files).unreadable, ["package.json"]);
  assert.deepEqual(
    analyseChanges(files, { packages: { base: basePackage, head: "{ not json" } }).unreadable,
    ["package.json"]
  );
});

test("a dependency moved between sections is not new", () => {
  const base = JSON.parse(basePackage);
  const head = structuredClone(base);
  delete head.devDependencies.typescript;
  head.dependencies.typescript = "5.9.0";
  assert.deepEqual(comparePackages(basePackage, JSON.stringify(head)).newDependencies, []);
});

test("dependency sources, overrides, build permissions and the package manager are compared", () => {
  const base = {
    ...JSON.parse(basePackage),
    packageManager: "pnpm@10.0.0",
    pnpm: {
      overrides: { "braces@<3.0.3": "3.0.3", "old@1": "1.0.1" },
      onlyBuiltDependencies: ["esbuild"],
    },
  };
  const head = structuredClone(base);
  head.dependencies.zod = "github:someone/zod#main";
  head.dependencies.react = "npm:preact@10.0.0";
  head.devDependencies.eslint = "file:../eslint";
  head.devDependencies.vitest = "https://example.test/vitest.tgz";
  head.dependencies.next = "git+https://example.test/next.git";
  head.packageManager = "pnpm@10.1.0";
  head.pnpm.overrides["braces@<3.0.3"] = "3.0.2";
  delete head.pnpm.overrides["old@1"];
  head.pnpm.overrides["new@*"] = "link:./vendor/new";
  head.pnpm.onlyBuiltDependencies = ["esbuild", "sharp"];
  const compared = comparePackages(JSON.stringify(base), JSON.stringify(head));
  assert.deepEqual(compared.newDependencies, []);
  assert.deepEqual(compared.changedSources, [
    { name: "next", source: "git" },
    { name: "react", source: "an npm: alias" },
    { name: "zod", source: "GitHub" },
    { name: "eslint", source: "a local file" },
    { name: "vitest", source: "a URL" },
  ]);
  assert.deepEqual(compared.overrides, ["braces@<3.0.3", "old@1", "new@*"]);
  assert.deepEqual(compared.newBuiltDependencies, ["sharp"]);
  assert.equal(compared.packageManagerChanged, true);

  // An unchanged non-registry source is not reported again.
  assert.deepEqual(comparePackages(JSON.stringify(head), JSON.stringify(head)).changedSources, []);
  assert.equal(dependencySource("owner/repo#v1"), "GitHub");
  assert.equal(dependencySource("link:../x"), "a local link");
  assert.equal(dependencySource("../x"), "a local path");
  assert.equal(dependencySource("^1.2.3"), null);
  assert.equal(dependencySource("workspace:*"), null);
  // A new package.json is compared with an empty one.
  assert.deepEqual(comparePackages(null, basePackage).newDependencies.length, 6);

  const result = analyseChanges([modified("package.json", "-{}", "+{}")], {
    packages: { base: JSON.stringify(base), head: JSON.stringify(head) },
  });
  assert.equal(
    summarySentence(result),
    "This PR takes 5 dependencies from outside the registry, changes 3 dependency overrides, lets 1 more package run install scripts and changes the package manager version."
  );
  const body = renderComment(result);
  assert.ok(body.includes("- Dependency taken from an npm: alias: `react`"));
  assert.ok(body.includes("- Now allowed to run install scripts: `sharp`"));
  assert.ok(body.includes("- `packageManager` changed in `package.json`"));
});

test("a test file renamed away from a test name counts as deleted; an unreadable diff is flagged", () => {
  const result = analyseFixture("renamed-away.diff");
  assert.deepEqual(result.deletedTestFiles, ["src/lib/orders.test.ts"]);
  assert.deepEqual(result.unreadable, ["src/components/very-large.test.tsx"]);
  assert.match(summarySentence(result), /changes 1 file whose diff is too large to read/);
});

test("a cut-short file list can never be clean", () => {
  const result = analyseChanges([], { complete: false });
  assert.equal(verdictLabel(result), LABEL_CHANGED);
  assert.match(summarySentence(result), /more files than GitHub lists/);
});

test("pull-request-controlled names are shown inert", () => {
  assert.equal(codeName("a`b @owner\n[x](y)"), "`a'b @owner[x](y)`");
  assert.equal(
    codeName(
      [
        "a",
        0x202e,
        "b",
        0x200b,
        "c",
        0x2066,
        "d",
        0x2069,
        "e",
        0xfeff,
        "f",
        0x200f,
        "g",
        0x202a,
        "h",
      ]
        .map((part) => (typeof part === "number" ? String.fromCharCode(part) : part))
        .join("")
    ),
    "`abcdefgh`"
  );
  const files = [{ filename: "src/@owner `x`.test.ts", status: "removed" }];
  const body = renderComment(analyseChanges(files), { headSha: "not a sha" });
  assert.ok(body.startsWith(`${MARKER}\n`));
  assert.ok(body.includes("Deleted test file: `src/@owner 'x'.test.ts`"));
  assert.ok(!body.includes("Checked at"));
});

test("the comment states the verdict, the details and that it blocks nothing", () => {
  const body = renderComment(analyseFixture("deleted-tests.diff"), {
    headSha: "0123456789abcdef0123",
  });
  assert.ok(
    body.includes(
      "This PR deletes 1 test file, removes 2 test cases and changes the coverage thresholds."
    )
  );
  assert.ok(body.includes("- Deleted test file: `src/lib/money.test.ts`"));
  assert.ok(body.includes("- 2 test cases removed from `src/lib/orders.test.ts`\n"));
  assert.ok(body.includes("- Coverage thresholds in `vitest.config.ts` changed"));
  assert.ok(
    body.includes(
      "Label: `checks-changed`. This is information for the reviewer, not a failed check."
    )
  );
  assert.ok(body.includes("Checked at 0123456789ab."));
});

test("the comment caps each list and stays under GitHub's comment limit", () => {
  const long = "x".repeat(400);
  const files = [];
  for (let index = 0; index < 3000; index += 1) {
    files.push({ filename: `src/${long}/${index}.test.ts`, status: "removed" });
    files.push(modified(`src/${long}/${index}.spec.ts`, '+it.only("x", () => {});'));
    files.push(modified(`.github/workflows/${long}${index}.yml`, "+on: push"));
    files.push({ filename: `src/${long}/${index}.big.test.ts`, status: "modified" });
  }
  const result = analyseChanges(files, { complete: false });
  const body = renderComment(result, { headSha: "0123456789abcdef0123" });
  assert.ok(body.length < 65536, String(body.length));
  assert.ok(body.includes(`- …and ${3000 - LIST_CAP} more deleted test files`));
  assert.ok(body.includes(`- …and ${3000 - LIST_CAP} more files with new marks`));
  assert.ok(body.includes(`- …and ${3000 - LIST_CAP} more unreadable files`));
  assert.ok(body.includes("Checked at 0123456789ab."));
  assert.equal(
    body.split("\n").filter((line) => line.startsWith("- Deleted test file")).length,
    LIST_CAP
  );
});

test("a sentence whose parts are lists separates them with semicolons", () => {
  const result = analyseChanges(
    filesFromGitDiff(fixture("deleted-tests.diff") + fixture("config-files.diff")).slice(0, 7)
  );
  assert.equal(
    summarySentence(result),
    "This PR deletes 1 test file; removes 2 test cases; changes the coverage thresholds; and changes the audit baselines, the legacy surface baseline, the branch rulesets and the CI workflows."
  );
});

// --- The GitHub side, against a fake API. ---

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const MERGE_BASE_SHA = "c".repeat(40);

function fakeGitHub({
  files,
  comments = [],
  labelExists = false,
  changedFiles = files.length,
  heads = [HEAD_SHA],
  packages = { [MERGE_BASE_SHA]: basePackage, [HEAD_SHA]: headPackage },
  fail = () => false,
}) {
  const calls = [];
  let pulls = 0;
  const fetchImpl = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    const route = pathname.replace("/repos/owner/repo", "");
    const method = init.method;
    calls.push({
      method,
      route,
      search: searchParams.toString(),
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    assert.equal(init.headers.Authorization, "Bearer test-token");
    assert.ok(init.signal, "every request has a time limit");
    const reply = (status, data) => ({
      ok: status < 400,
      status,
      json: async () => data,
      text: async () => JSON.stringify(data),
    });
    const failure = fail(method, route);
    if (failure === "hang") return new Promise(() => {});
    if (failure) return reply(500, { message: "boom" });
    if (method === "GET" && route === "/pulls/7") {
      const sha = heads[Math.min(pulls, heads.length - 1)];
      pulls += 1;
      return reply(200, {
        ...(changedFiles === null ? {} : { changed_files: changedFiles }),
        head: { sha },
        base: { sha: BASE_SHA },
      });
    }
    if (method === "GET" && route === "/pulls/7/files") {
      const page = Number(searchParams.get("page"));
      return reply(200, files.slice((page - 1) * 100, page * 100));
    }
    if (method === "GET" && route === `/compare/${BASE_SHA}...${HEAD_SHA}`) {
      return reply(200, { merge_base_commit: { sha: MERGE_BASE_SHA } });
    }
    if (method === "GET" && route === "/contents/package.json") {
      const text = packages[searchParams.get("ref")];
      if (text === undefined) return reply(404, {});
      return reply(200, {
        type: "file",
        encoding: "base64",
        content: Buffer.from(text).toString("base64"),
      });
    }
    if (method === "GET" && route.startsWith("/labels/")) return reply(labelExists ? 200 : 404, {});
    if (method === "POST" && route === "/labels") return reply(201, {});
    if (method === "POST" && route === "/issues/7/labels") return reply(200, []);
    if (method === "DELETE" && route.startsWith("/issues/7/labels/")) return reply(404, {});
    if (method === "GET" && route === "/issues/7/comments") return reply(200, comments);
    if (method === "PATCH" && route.startsWith("/issues/comments/")) return reply(200, {});
    if (method === "POST" && route === "/issues/7/comments") return reply(201, {});
    throw new Error(`Unexpected call ${method} ${route}`);
  };
  const writes = () =>
    calls
      .filter((call) => call.method !== "GET")
      .map((call) =>
        call.route === "/issues/7/labels"
          ? `${call.method} ${call.route} ${call.body.labels.join(",")}`
          : `${call.method} ${call.route}`
      );
  const commentBody = () =>
    calls.filter((call) => call.route.includes("comments") && call.method !== "GET").at(-1)?.body
      ?.body;
  return { calls, fetchImpl, writes, commentBody };
}

const env = {
  GITHUB_TOKEN: "test-token",
  GITHUB_REPOSITORY: "owner/repo",
  PR_NUMBER: "7",
  GITHUB_API_URL: "https://api.example.test",
  BASE_DIR: repoRoot,
};

test("run labels the pull request checks-changed first and posts one comment", async () => {
  const github = fakeGitHub({ files: filesFromGitDiff(fixture("deleted-tests.diff")) });
  const { label } = await run({ env, fetchImpl: github.fetchImpl, log: () => {} });
  assert.equal(label, LABEL_CHANGED);
  assert.deepEqual(github.writes(), [
    "POST /labels",
    "POST /issues/7/labels checks-changed",
    "DELETE /issues/7/labels/checks-clean",
    "POST /issues/7/comments",
  ]);
  // The label is set before the pull request is read.
  const firstRead = github.calls.findIndex((call) => call.route === "/pulls/7/files");
  const firstLabel = github.calls.findIndex((call) => call.route === "/issues/7/labels");
  assert.ok(firstLabel < firstRead);
  assert.ok(github.commentBody().includes(`Checked at ${HEAD_SHA.slice(0, 12)}.`));
});

test("run moves to checks-clean only after the clean comment is written", async () => {
  const comments = [
    { id: 1, user: { login: "someone", type: "User" }, body: `${MARKER}\nfake all clear` },
    {
      id: 2,
      user: { login: "github-actions[bot]", type: "Bot" },
      body: "an unrelated bot comment",
    },
    { id: 3, user: { login: "github-actions[bot]", type: "Bot" }, body: `${MARKER}\nold verdict` },
  ];
  const cleanPackages = { [MERGE_BASE_SHA]: basePackage, [HEAD_SHA]: cleanHeadPackage };
  const github = fakeGitHub({
    files: filesFromGitDiff(fixture("clean.diff")),
    comments,
    labelExists: true,
    packages: cleanPackages,
  });
  const { label } = await run({ env, fetchImpl: github.fetchImpl, log: () => {} });
  assert.equal(label, LABEL_CLEAN);
  assert.deepEqual(github.writes(), [
    "POST /issues/7/labels checks-changed",
    "DELETE /issues/7/labels/checks-clean",
    "PATCH /issues/comments/3",
    "POST /issues/7/labels checks-clean",
    "DELETE /issues/7/labels/checks-changed",
  ]);
  // package.json was read at the merge base and the head, through the API.
  assert.deepEqual(
    github.calls.filter((call) => call.route === "/contents/package.json").map((c) => c.search),
    [`ref=${MERGE_BASE_SHA}`, `ref=${HEAD_SHA}`]
  );
});

test("run reports dependencies from the fetched package.json files", async () => {
  const github = fakeGitHub({ files: filesFromGitDiff(fixture("new-dependencies.diff")) });
  const { result } = await run({ env, fetchImpl: github.fetchImpl, log: () => {} });
  assert.deepEqual(result.newDependencies, ["left-pad", "@scope/new-tool"]);
});

test("run fails closed when GitHub errors", async () => {
  const github = fakeGitHub({
    files: filesFromGitDiff(fixture("clean.diff")),
    labelExists: true,
    fail: (method, route) => method === "GET" && route === "/pulls/7/files",
  });
  await assert.rejects(run({ env, fetchImpl: github.fetchImpl, log: () => {} }), /answered 500/);
  assert.deepEqual(github.writes(), [
    "POST /issues/7/labels checks-changed",
    "DELETE /issues/7/labels/checks-clean",
    "POST /issues/7/comments",
  ]);
  assert.ok(github.commentBody().includes(COULD_NOT_CHECK));
  assert.ok(github.commentBody().startsWith(MARKER));
});

test("run fails closed when the check takes too long", async () => {
  const github = fakeGitHub({
    files: [],
    labelExists: true,
    fail: (method, route) => (route === "/pulls/7/files" ? "hang" : false),
  });
  await assert.rejects(
    run({ env, fetchImpl: github.fetchImpl, log: () => {}, deadlineMs: 50 }),
    /did not finish/
  );
  assert.ok(github.commentBody().includes(COULD_NOT_CHECK));
  assert.ok(!github.writes().includes("POST /issues/7/labels checks-clean"));
});

test("run fails closed when package.json cannot be fetched or the head moves", async () => {
  const unreadable = fakeGitHub({
    files: filesFromGitDiff(fixture("clean.diff")),
    labelExists: true,
    fail: (method, route) => route.startsWith("/compare/"),
  });
  await assert.rejects(run({ env, fetchImpl: unreadable.fetchImpl, log: () => {} }));
  assert.ok(unreadable.commentBody().includes(COULD_NOT_CHECK));

  const moved = fakeGitHub({
    files: filesFromGitDiff(fixture("clean.diff")),
    labelExists: true,
    heads: [HEAD_SHA, "d".repeat(40)],
  });
  await assert.rejects(
    run({ env, fetchImpl: moved.fetchImpl, log: () => {} }),
    /changed while it was being checked/
  );
  assert.ok(moved.commentBody().includes(COULD_NOT_CHECK));
});

test("the could-not-check mode labels checks-changed and rewrites the comment", async () => {
  const github = fakeGitHub({
    files: [],
    labelExists: true,
    comments: [
      { id: 3, user: { login: "github-actions[bot]", type: "Bot" }, body: `${MARKER}\nclean` },
    ],
  });
  await markCouldNotCheck({ env, fetchImpl: github.fetchImpl });
  assert.deepEqual(github.writes(), [
    "POST /issues/7/labels checks-changed",
    "DELETE /issues/7/labels/checks-clean",
    "PATCH /issues/comments/3",
  ]);
  assert.ok(github.commentBody().includes(COULD_NOT_CHECK));
});

test("run reads every page of files and flags a list GitHub cut short", async () => {
  const files = Array.from({ length: 150 }, (_, index) => ({
    filename: `src/f${index}.ts`,
    status: "modified",
  }));
  const github = fakeGitHub({ files, labelExists: true, changedFiles: 3500 });
  const { result } = await run({ env, fetchImpl: github.fetchImpl, log: () => {} });
  assert.equal(github.calls.filter((call) => call.route === "/pulls/7/files").length, 2);
  assert.equal(result.incomplete, true);

  const unknown = fakeGitHub({ files: [], labelExists: true, changedFiles: null });
  const { result: unknownResult } = await run({
    env,
    fetchImpl: unknown.fetchImpl,
    log: () => {},
  });
  assert.equal(unknownResult.incomplete, true);
});

test("run refuses malformed inputs before calling GitHub", async () => {
  const { calls, fetchImpl } = fakeGitHub({ files: [] });
  await assert.rejects(run({ env: { ...env, PR_NUMBER: "7; rm -rf /" }, fetchImpl }), /PR_NUMBER/);
  await assert.rejects(
    run({ env: { ...env, GITHUB_REPOSITORY: "../x" }, fetchImpl }),
    /owner\/repo/
  );
  await assert.rejects(run({ env: { ...env, GITHUB_TOKEN: "" }, fetchImpl }), /GITHUB_TOKEN/);
  assert.equal(calls.length, 0);
});
