import assert from "node:assert/strict";
import { test } from "node:test";
import { summarise, summariseMissing } from "./e2e-foundation-summary.mjs";

const ESC = String.fromCharCode(27);

/** @param {Array<Record<string, any>>} tests */
function report(tests, { errors = [], duration = 390_000 } = {}) {
  return {
    stats: { duration },
    errors,
    suites: [
      {
        title: "staff-review.spec.ts",
        file: "staff-review.spec.ts",
        suites: [
          {
            title: "staff review",
            specs: tests.map((item, index) => ({
              title: item.title,
              file: "staff-review.spec.ts",
              line: 10 + index,
              tests: [
                {
                  status: item.status,
                  expectedStatus: item.expectedStatus ?? "passed",
                  results: item.results ?? [{ status: "passed", errors: [] }],
                },
              ],
            })),
          },
        ],
      },
    ],
  };
}

const passing = { title: "queue lists the post", status: "expected" };
const markedToFail = {
  title: "known gap",
  status: "expected",
  expectedStatus: "failed",
  results: [{ status: "failed", errors: [{ message: "Error: known" }] }],
};

test("a green run counts expected failures as passed and gives the duration", () => {
  const text = summarise(report([passing, markedToFail]), "chromium");
  assert.match(text, /## Foundation browser tests \(chromium\)/);
  assert.match(text, /All tests passed\./);
  assert.match(text, /2 passed \(1 of them expected failures marked `test\.fail`\), 0 failed/);
  assert.match(text, /Took 6\.5 min\./);
  assert.doesNotMatch(text, /timed out/i);
});

test("a real failure is listed with its place and first error line", () => {
  const text = summarise(
    report([
      passing,
      {
        title: "approves | publishes",
        status: "unexpected",
        results: [
          { status: "failed", errors: [{ message: `${ESC}[31mError: first try${ESC}[39m` }] },
          {
            status: "failed",
            errors: [{ message: `\n${ESC}[31mError: expect(page) failed${ESC}[39m\n  at x` }],
          },
        ],
      },
    ]),
    "mobile-chrome"
  );
  assert.match(text, /\*\*1 test\(s\) failed\.\*\*/);
  assert.match(
    text,
    /\| staff review › approves \/ publishes \(staff-review\.spec\.ts:11\) \| Error: expect\(page\) failed \|/
  );
  assert.doesNotMatch(text, new RegExp(ESC));
  assert.doesNotMatch(text, /no test failure recorded/);
});

test("a global timeout with no failure says so and counts the tests that did not run", () => {
  const text = summarise(
    report(
      [
        passing,
        { title: "cut off", status: "skipped", results: [{ status: "interrupted", errors: [] }] },
        { title: "never started", status: "skipped", results: [] },
        {
          title: "documented skip",
          status: "skipped",
          expectedStatus: "skipped",
          results: [{ status: "skipped", errors: [] }],
        },
      ],
      {
        errors: [
          { message: `${ESC}[31mTimed out waiting 720s for the test suite to run${ESC}[39m` },
        ],
        duration: 720_500,
      }
    ),
    "chromium"
  );
  assert.match(
    text,
    /\*\*Timed out after 12\.0 min — no test failure recorded\.\*\* 2 test\(s\) did not run/
  );
  assert.match(text, /1 passed .*0 failed, 0 flaky, 1 skipped, 2 did not run\. Took 12\.0 min\./);
});

test("a global timeout after a real failure keeps the failure visible", () => {
  const text = summarise(
    report(
      [
        {
          title: "broken",
          status: "unexpected",
          results: [{ status: "failed", errors: [{ message: "Error: boom" }] }],
        },
        { title: "never started", status: "skipped", results: [] },
      ],
      { errors: [{ message: "Timed out waiting 720s for the test suite to run" }] }
    ),
    "chromium"
  );
  assert.match(text, /\*\*Timed out after 12\.0 min with 1 failed test\(s\)\.\*\*/);
  assert.match(text, /Error: boom/);
  assert.doesNotMatch(text, /no test failure recorded/);
});

test("flaky tests are named", () => {
  const text = summarise(
    report([
      {
        title: "slow page",
        status: "flaky",
        results: [
          { status: "failed", errors: [{ message: "Error: slow" }] },
          { status: "passed", errors: [] },
        ],
      },
    ]),
    "chromium"
  );
  assert.match(text, /All tests passed\./);
  assert.match(text, /Passed only on retry:\n- staff review › slow page/);
});

test("a run error other than the timeout is reported as an incomplete run", () => {
  const text = summarise(
    report([], {
      errors: [{ message: "Error: Timed out waiting 1200000ms from config.webServer." }],
    }),
    "chromium"
  );
  assert.match(
    text,
    /\*\*The run did not complete:\*\* Error: Timed out waiting 1200000ms from config\.webServer\./
  );
});

test("a missing report means the step stopped before Playwright finished", () => {
  const text = summariseMissing("mobile-chrome", 780_000);
  assert.match(text, /## Foundation browser tests \(mobile-chrome\)/);
  assert.match(text, /stopped after 13\.0 min before Playwright finished/);
  assert.match(text, /no test failure recorded/);
  assert.match(summariseMissing("chromium", undefined), /stopped before Playwright finished/);
});
