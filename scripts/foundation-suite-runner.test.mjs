import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultJobs,
  formatResult,
  main,
  nodeSuite,
  parseArgs,
  runSuites,
  summary,
} from "./lib/foundation-suite-runner.mjs";

test("runs at most 4 suites at once by default, fewer on a smaller machine", () => {
  assert.equal(defaultJobs(2), 2);
  assert.equal(defaultJobs(4), 4);
  assert.equal(defaultJobs(64), 4);
  assert.equal(defaultJobs(0), 1);
  assert.deepEqual(parseArgs(["a.mjs", "b.mjs"], { cores: 8 }), {
    jobs: 4,
    suites: ["a.mjs", "b.mjs"],
  });
  assert.equal(parseArgs(["--jobs=1", "a.mjs"]).jobs, 1);
});

test("refuses an empty, repeated or unclear suite list", () => {
  assert.throws(() => parseArgs([]), /No suites/);
  assert.throws(() => parseArgs(["a.mjs", "a.mjs"]), /listed twice/);
  assert.throws(() => parseArgs(["--fast", "a.mjs"]), /Unknown option/);
  for (const jobs of ["0", "17", "2.5", "", "x"])
    assert.throws(() => parseArgs([`--jobs=${jobs}`, "a.mjs"]), /--jobs/);
});

test("keeps to the job limit, runs every suite after a failure, keeps the order", async () => {
  let active = 0;
  let peak = 0;
  const reported = [];
  const suites = ["a", "b", "c", "d", "e", "f", "g"];
  const results = await runSuites(suites, {
    jobs: 3,
    run: async (suite) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, suite === "a" ? 30 : 5));
      active -= 1;
      if (suite === "c") throw new Error("could not start");
      return { suite, code: suite === "b" ? 1 : 0, seconds: 1, output: `${suite}\n` };
    },
    report: (result) => reported.push(result.suite),
  });
  assert.equal(peak, 3);
  assert.deepEqual(
    results.map((result) => result.suite),
    suites
  );
  assert.deepEqual(
    results.map((result) => result.code),
    [0, 1, 1, 0, 0, 0, 0]
  );
  assert.match(results[2].output, /could not start/);
  assert.deepEqual([...reported].sort(), suites);
  assert.notEqual(reported[0], "a", "reported as each suite ends, not in list order");
});

test("prints each suite in one piece, folding passes on GitHub Actions", () => {
  const pass = { suite: "s.mjs", code: 0, seconds: 12, output: "PASS one" };
  const fail = { suite: "t.mjs", code: 3, seconds: 4, output: "FAIL two\n" };
  assert.equal(formatResult(pass), "===== s.mjs: passed in 12 s\nPASS one\n");
  assert.equal(
    formatResult(pass, { actions: true }),
    "::group::s.mjs: passed in 12 s\nPASS one\n::endgroup::\n"
  );
  assert.equal(
    formatResult(fail, { actions: true }),
    "::error title=Foundation suite failed::t.mjs: FAILED (exit 3) in 4 s\nFAIL two\n"
  );
  const text = summary([pass, fail], { jobs: 2, seconds: 13 });
  assert.match(text, /2 at a time, 13 s in all/);
  assert.ok(text.indexOf("s.mjs") < text.indexOf("t.mjs"), "slowest first");
  assert.match(text, /1 of 2 foundation suites failed: t\.mjs\.\n$/);
  assert.match(summary([pass], { jobs: 1, seconds: 12 }), /All 1 foundation suites passed\.\n$/);
});

test("runs real suite processes and fails when one fails", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vm-suites-"));
  try {
    const ok = path.join(dir, "ok.mjs");
    const bad = path.join(dir, "bad.mjs");
    writeFileSync(ok, 'console.log("PASS fine"); console.error("note");\n');
    writeFileSync(bad, 'console.log("PASS first"); process.exit(5);\n');
    const result = await nodeSuite(ok);
    assert.equal(result.code, 0);
    assert.match(result.output, /PASS fine/);
    assert.match(result.output, /note/);
    let text = "";
    const code = await main(["--jobs=2", ok, bad], {
      write: (chunk) => (text += chunk),
      env: {},
    });
    assert.equal(code, 1);
    assert.match(text, /bad\.mjs: FAILED \(exit 5\)/);
    assert.match(text, /ok\.mjs: passed/);
    assert.match(text, /1 of 2 foundation suites failed/);
    text = "";
    assert.equal(await main([ok], { write: (chunk) => (text += chunk), env: {} }), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the lifecycle test runs every lint-container suite through the runner", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  const words = scripts["db:foundation:lifecycle-test"].split(/\s+/);
  assert.deepEqual(words.slice(0, 2), ["node", "scripts/test-foundation-suites.mjs"]);
  assert.ok(!scripts["db:foundation:lifecycle-test"].includes("&&"));
  const listed = words.slice(2);
  assert.ok(listed.length >= 34, "no suite dropped");
  for (const suite of listed) assert.match(suite, /^scripts\/test-foundation-[\w-]+\.mjs$/);
  // Every suite that starts the lint container is listed.
  const suites = readdirSync("scripts")
    .filter((name) => /^test-foundation-.+\.mjs$/.test(name))
    .map((name) => `scripts/${name}`)
    .filter((file) =>
      /lib\/foundation-(sql-lint|staff-payment-world)\.mjs/.test(readFileSync(file, "utf8"))
    );
  assert.deepEqual(
    suites.filter((suite) => !listed.includes(suite)),
    []
  );
});
