import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WORKER_BUDGET_BYTES,
  budgetFromEnvironment,
  evaluateWorkerSize,
  parseWranglerUpload,
} from "./lib/worker-size.mjs";

test("reads the compressed size from Wrangler's upload line", () => {
  const output =
    "\u001b[2mTotal Upload: 42198.71 KiB / gzip: 9020.41 KiB\u001b[0m\n--dry-run: exiting now.";
  assert.deepEqual(parseWranglerUpload(output), {
    totalBytes: Math.round(42198.71 * 1024),
    gzipBytes: Math.round(9020.41 * 1024),
  });
  assert.equal(parseWranglerUpload("no size here"), null);
});

test("passes under the 9.5 MB budget and reports headroom", () => {
  const verdict = evaluateWorkerSize(Math.round(9020.41 * 1024));
  assert.equal(verdict.ok, true);
  assert.match(verdict.summary, /^worker gzip = 9\.24 MB, budget 9\.50 MB/);
  assert.equal(verdict.lowHeadroom, false);
});

test("fails above the budget and warns when headroom is under 0.5 MB", () => {
  const verdict = evaluateWorkerSize(9_600_000);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.lowHeadroom, true);
});

test("a budget below today's size fails (negative check)", () => {
  const today = Math.round(9020.41 * 1024);
  const budgetBytes = budgetFromEnvironment({ WORKER_GZIP_BUDGET_BYTES: String(today - 1) });
  assert.equal(evaluateWorkerSize(today, { budgetBytes }).ok, false);
});

test("the override can only lower the budget", () => {
  assert.equal(budgetFromEnvironment({}), WORKER_BUDGET_BYTES);
  assert.throws(
    () => budgetFromEnvironment({ WORKER_GZIP_BUDGET_BYTES: "99999999" }),
    /only lower/
  );
  assert.throws(
    () => budgetFromEnvironment({ WORKER_GZIP_BUDGET_BYTES: "9.5MB" }),
    /positive integer/
  );
});
