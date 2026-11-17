import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LINT_IMAGE,
  assertLocalDocker,
  collapseFindings,
  compareLint,
  lintContainerArgs,
  nextLintBaseline,
  readLintBaseline,
} from "./lib/foundation-sql-lint.mjs";

const finding = (overrides) => ({
  function: "internal.f()",
  relation: "-",
  level: "warning",
  sqlstate: "00000",
  message: 'unused variable "x"',
  line: 3,
  ...overrides,
});
const collapsed = (overrides) => ({
  function: "internal.f()",
  level: "warning",
  sqlstate: "00000",
  message: 'unused variable "x"',
  count: 1,
  lines: [3],
  ...overrides,
});
const emptyBaseline = { knownErrors: [], warnings: [] };

test("the lint database only runs on a local Docker daemon, without any network", () => {
  for (const host of [
    undefined,
    "unix:///var/run/docker.sock",
    "npipe:////./pipe/docker_engine",
    "tcp://127.0.0.1:2375",
    "tcp://localhost:2376",
  ]) {
    assert.doesNotThrow(() => assertLocalDocker(host ? { DOCKER_HOST: host } : {}));
  }
  for (const host of ["tcp://db.example.com:2375", "tcp://10.0.0.5:2375", "ssh://user@remote"]) {
    assert.throws(() => assertLocalDocker({ DOCKER_HOST: host }), /non-local Docker daemon/);
  }
  const args = lintContainerArgs("vm-foundation-sql-lint-test", "pw");
  assert.equal(args[args.indexOf("--network") + 1], "none");
  assert.ok(
    !args.some((arg) => ["-p", "--publish", "-P", "--publish-all", "--add-host"].includes(arg))
  );
  assert.ok(args.includes(LINT_IMAGE));
  assert.match(
    LINT_IMAGE,
    /^public\.ecr\.aws\/supabase\/postgres:17\.[0-9.]+@sha256:[0-9a-f]{64}$/
  );
});

test("a trigger finding counts only when every attached table reports it", () => {
  const raw = {
    targets: [
      { function: "internal.guard()", relation: "private.a" },
      { function: "internal.guard()", relation: "private.b" },
      { function: "internal.f()", relation: "-" },
    ],
    findings: [
      // Branch for table b only: reported against a, not against b.
      finding({
        function: "internal.guard()",
        relation: "private.a",
        level: "error",
        sqlstate: "42703",
        message: 'record "new" has no field "b_only"',
        line: 7,
      }),
      // Real on every table.
      finding({
        function: "internal.guard()",
        relation: "private.a",
        level: "error",
        sqlstate: "42703",
        message: 'record "new" has no field "missing"',
        line: 9,
      }),
      finding({
        function: "internal.guard()",
        relation: "private.b",
        level: "error",
        sqlstate: "42703",
        message: 'record "new" has no field "missing"',
        line: 9,
      }),
      finding({}),
      finding({ line: 5 }),
    ],
    unattachedTriggers: ["internal.orphan()"],
  };
  assert.deepEqual(collapseFindings(raw), [
    collapsed({ count: 2, lines: [3, 5] }),
    collapsed({
      function: "internal.guard()",
      level: "error",
      sqlstate: "42703",
      message: 'record "new" has no field "missing"',
      lines: [9],
    }),
    collapsed({
      function: "internal.orphan()",
      level: "error",
      sqlstate: "VM001",
      message: "trigger function is not attached to any table, so plpgsql_check cannot check it",
      lines: [],
    }),
  ]);
});

test("a new lint error or an extra warning fails; a reviewed known error does not", () => {
  const error = collapsed({
    level: "error",
    sqlstate: "42703",
    message: 'column "x" does not exist',
  });
  assert.match(
    compareLint([error], emptyBaseline)[0],
    /^new error: internal\.f\(\) line 3: column "x" does not exist/
  );
  const known = {
    knownErrors: [
      {
        function: "internal.f()",
        sqlstate: "42703",
        message: 'column "x" does not exist',
        reason: "tracked",
      },
    ],
    warnings: [],
  };
  assert.deepEqual(compareLint([error], known), []);

  const baseline = {
    knownErrors: [],
    warnings: [{ ...collapsed({}), lines: undefined, count: 1 }],
  };
  assert.deepEqual(compareLint([collapsed({})], baseline), []);
  assert.match(
    compareLint([collapsed({ count: 2 })], baseline)[0],
    /^new warning: .* x2, baseline 1$/
  );
  assert.match(compareLint([collapsed({ message: "other" })], baseline).join("\n"), /new warning/);
});

test("the baseline can only shrink", () => {
  const baseline = { knownErrors: [], warnings: [{ ...collapsed({}), count: 2 }] };
  assert.match(
    compareLint([collapsed({ count: 1 })], baseline)[0],
    /^fixed \(shrink the baseline\)/
  );
  assert.match(compareLint([], baseline)[0], /no longer reported/);

  assert.equal(nextLintBaseline([collapsed({ count: 1 })], baseline).warnings[0].count, 1);
  assert.throws(() => nextLintBaseline([collapsed({ count: 3 })], baseline), /Refusing to grow/);
  assert.equal(
    nextLintBaseline([collapsed({ count: 3 })], baseline, { acceptNew: true }).warnings[0].count,
    3
  );
  assert.throws(
    () => nextLintBaseline([collapsed({ level: "error" })], emptyBaseline, { acceptNew: true }),
    /Refusing to record new errors/
  );
  const known = {
    knownErrors: [{ function: "internal.f()", sqlstate: "1", message: "m", reason: "r" }],
    warnings: [],
  };
  assert.deepEqual(nextLintBaseline([], known).knownErrors, []);
});

test("the committed baseline is reviewed: every known error has a reason", () => {
  const baseline = readLintBaseline();
  for (const entry of baseline.knownErrors) {
    assert.ok(entry.function && entry.sqlstate && entry.message);
    assert.ok(entry.reason?.length > 20, `${entry.function} needs a reason`);
  }
  for (const entry of baseline.warnings) {
    assert.ok(entry.level !== "error" && Number.isInteger(entry.count) && entry.count > 0);
  }
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /pnpm db:foundation:lint/);
  assert.match(workflow, /pnpm db:foundation:snapshot/);
  assert.match(workflow, /pnpm db:foundation:api-check/);
});
