import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { newestResults, summarise } from "./foundation-native-failure-summary.mjs";

test("a failed run names the failed check, its stage, error class and SQL state", () => {
  const text = summarise({
    status: "FAIL",
    checks: [
      { id: "posting-terms-accept", status: "PASS" },
      {
        id: "next-native-check",
        status: "FAIL",
        reason:
          "Assertion or local operation failed at review holder cap race; prior check IDs delimit the failure",
        failureCode: "UNCLASSIFIED",
        sqlState: "P0001",
        diagnostic: { actual: 3, expected: 1, operator: "strictEqual" },
      },
    ],
  });
  assert.match(text, /Status FAIL: 1 passed, 1 not passed\./);
  assert.match(text, /Last passed check: `posting-terms-accept`/);
  assert.match(
    text,
    /\| next-native-check \| FAIL \| Assertion or local operation failed at review holder cap race;.* \| UNCLASSIFIED \| P0001 \|/
  );
  // Values, even redacted scalars, stay in the artifact only.
  assert.doesNotMatch(text, /strictEqual|actual/);
});

test("anything that does not look like a plain label is withheld", () => {
  const text = summarise({
    status: "FAIL",
    checks: [
      { id: "x", status: "FAIL", reason: 'token "eyJhbGciOi..." {"a":1}', failureCode: "E\nPIPE" },
    ],
  });
  assert.match(text, /\| x \| FAIL \| \(withheld\) \| \(withheld\) \|  \|/);
});

test("a green run says so without a table", () => {
  const text = summarise({ status: "PASS", checks: [{ id: "a", status: "PASS" }] });
  assert.match(text, /Status PASS: 1 passed, 0 not passed\./);
  assert.doesNotMatch(text, /\| Check \|/);
});

test("the newest results file is chosen by its timestamped folder", () => {
  const root = mkdtempSync(path.join(tmpdir(), "native-summary-"));
  try {
    for (const name of [
      "native-2026-11-10T01-00-00.000Z",
      "native-2026-11-11T01-00-00.000Z",
      "other",
    ]) {
      mkdirSync(path.join(root, name));
      writeFileSync(path.join(root, name, "results.json"), "{}");
    }
    assert.equal(
      newestResults(root),
      path.join(root, "native-2026-11-11T01-00-00.000Z", "results.json")
    );
    assert.equal(newestResults(path.join(root, "missing")), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
