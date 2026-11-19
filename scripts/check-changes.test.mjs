import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "./check-changed-checks.mjs";
import {
  LABEL_CHANGED,
  LABEL_CLEAN,
  MARKER,
  analyseChanges,
  codeName,
  filesFromGitDiff,
  hasFindings,
  newDependencies,
  parsePatch,
  renderComment,
  summarySentence,
  verdictLabel,
} from "./lib/check-changes.mjs";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "check-changes"
);
const fixture = (name) => readFileSync(path.join(fixtures, name), "utf8");
const basePackageJson = fixture("base-package.json");
const analyseFixture = (name, options = {}) =>
  analyseChanges(filesFromGitDiff(fixture(name)), { basePackageJson, ...options });

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
  const result = analyseFixture("clean.diff");
  assert.equal(hasFindings(result), false, JSON.stringify(result));
  assert.equal(verdictLabel(result), LABEL_CLEAN);
  assert.match(summarySentence(result), /^This PR changes no tests or checks/);
});

test("deleted test files, removed test cases and threshold changes are reported", () => {
  const result = analyseFixture("deleted-tests.diff");
  assert.deepEqual(result.deletedTestFiles, ["src/lib/money.test.ts"]);
  // Three removed, one retitled in place: two test cases are gone.
  assert.equal(result.removedTestCases, 2);
  assert.deepEqual(result.removedTestCasesByFile, [{ file: "src/lib/orders.test.ts", count: 2 }]);
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

test("new top-level dependencies are found; version bumps, engines and scripts are not", () => {
  const result = analyseFixture("new-dependencies.diff");
  assert.deepEqual(result.newDependencies, ["left-pad", "@scope/new-tool"]);
  assert.deepEqual(result.changedCommands, ["test"]);
  assert.equal(
    summarySentence(result),
    "This PR changes 1 test or check command in package.json and adds 2 new dependencies."
  );
});

test("without main's package.json the patch alone still finds new dependencies", () => {
  const files = filesFromGitDiff(fixture("new-dependencies.diff"));
  const lines = parsePatch(files[0].patch);
  // The engines hunk names its section; zod and vitest are removed and re-added.
  assert.deepEqual(newDependencies(lines, undefined), ["left-pad", "@scope/new-tool"]);
});

test("a dependency moved between sections is not new", () => {
  const patch = [
    "@@ -13,8 +13,8 @@",
    '     "next": "16.0.0",',
    '     "react": "19.0.0",',
    '-    "zod": "4.0.0"',
    '+    "zod": "4.0.0",',
    '+    "typescript": "5.9.0"',
    "   },",
    '   "devDependencies": {',
    '     "eslint": "9.0.0",',
    '-    "typescript": "5.9.0",',
    '     "vitest": "4.0.0"',
  ].join("\n");
  assert.deepEqual(newDependencies(parsePatch(patch), basePackageJson), []);
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
  assert.ok(body.includes("- 2 test cases removed from `src/lib/orders.test.ts`"));
  assert.ok(body.includes("- Coverage thresholds in `vitest.config.ts` changed"));
  assert.ok(
    body.includes(
      "Label: `checks-changed`. This is information for the reviewer, not a failed check."
    )
  );
  assert.ok(body.includes("Checked at 0123456789ab."));
});

function fakeGitHub({ files, comments = [], labelExists = false, changedFiles = files.length }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    const route = pathname.replace("/repos/owner/repo", "");
    const method = init.method;
    calls.push({ method, route, body: init.body ? JSON.parse(init.body) : undefined });
    assert.equal(init.headers.Authorization, "Bearer test-token");
    const reply = (status, data) => ({
      ok: status < 400,
      status,
      json: async () => data,
      text: async () => JSON.stringify(data),
    });
    if (method === "GET" && route === "/pulls/7") {
      return reply(200, { changed_files: changedFiles, head: { sha: "abcdef1234567890" } });
    }
    if (method === "GET" && route === "/pulls/7/files") {
      const page = Number(searchParams.get("page"));
      return reply(200, files.slice((page - 1) * 100, page * 100));
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
  return { calls, fetchImpl };
}

const env = {
  GITHUB_TOKEN: "test-token",
  GITHUB_REPOSITORY: "owner/repo",
  PR_NUMBER: "7",
  GITHUB_API_URL: "https://api.example.test",
  BASE_PACKAGE_JSON: path.join(fixtures, "base-package.json"),
};

test("run labels the pull request and posts one comment", async () => {
  const { calls, fetchImpl } = fakeGitHub({
    files: filesFromGitDiff(fixture("deleted-tests.diff")),
  });
  const { label } = await run({ env, fetchImpl, log: () => {} });
  assert.equal(label, LABEL_CHANGED);
  const writes = calls
    .filter((call) => call.method !== "GET")
    .map((call) => `${call.method} ${call.route}`);
  assert.deepEqual(writes, [
    "POST /labels",
    "POST /issues/7/labels",
    "DELETE /issues/7/labels/checks-clean",
    "POST /issues/7/comments",
  ]);
  assert.deepEqual(calls.find((call) => call.route === "/issues/7/labels").body, {
    labels: [LABEL_CHANGED],
  });
});

test("run rewrites its own comment and ignores look-alikes posted by people", async () => {
  const comments = [
    { id: 1, user: { login: "someone", type: "User" }, body: `${MARKER}\nfake all clear` },
    {
      id: 2,
      user: { login: "github-actions[bot]", type: "Bot" },
      body: "an unrelated bot comment",
    },
    { id: 3, user: { login: "github-actions[bot]", type: "Bot" }, body: `${MARKER}\nold verdict` },
  ];
  const { calls, fetchImpl } = fakeGitHub({
    files: filesFromGitDiff(fixture("clean.diff")),
    comments,
    labelExists: true,
  });
  const { label } = await run({ env, fetchImpl, log: () => {} });
  assert.equal(label, LABEL_CLEAN);
  const writes = calls
    .filter((call) => call.method !== "GET")
    .map((call) => `${call.method} ${call.route}`);
  assert.deepEqual(writes, [
    "POST /issues/7/labels",
    "DELETE /issues/7/labels/checks-changed",
    "PATCH /issues/comments/3",
  ]);
});

test("run reads every page of files and flags a list GitHub cut short", async () => {
  const files = Array.from({ length: 150 }, (_, index) => ({
    filename: `src/f${index}.ts`,
    status: "modified",
  }));
  const { calls, fetchImpl } = fakeGitHub({ files, labelExists: true, changedFiles: 3500 });
  const { result } = await run({ env, fetchImpl, log: () => {} });
  assert.equal(calls.filter((call) => call.route === "/pulls/7/files").length, 2);
  assert.equal(result.incomplete, true);
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

test("a sentence whose parts are lists separates them with semicolons", () => {
  const result = analyseChanges(
    filesFromGitDiff(fixture("deleted-tests.diff") + fixture("config-files.diff")).slice(0, 7)
  );
  assert.equal(
    summarySentence(result),
    "This PR deletes 1 test file; removes 2 test cases; changes the coverage thresholds; and changes the audit baselines, the legacy surface baseline, the branch rulesets and the CI workflows."
  );
});
