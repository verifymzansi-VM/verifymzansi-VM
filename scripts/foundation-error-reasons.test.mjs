import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  findRawReasonComparisons,
  parseRaiseStatements,
  runReasonCheck,
} from "./lib/foundation-error-reasons.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = "src/lib/foundation/error-reasons.ts";
const FUNCTIONS = "database/foundation/current/functions";

/** A throwaway checkout holding the real current schema and shared list. */
function copyOfRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "error-reasons-"));
  cpSync(path.join(repo, FUNCTIONS), path.join(root, FUNCTIONS), { recursive: true });
  mkdirSync(path.join(root, "src/lib/foundation"), { recursive: true });
  mkdirSync(path.join(root, "workers"), { recursive: true });
  writeFileSync(path.join(root, SHARED), readFileSync(path.join(repo, SHARED), "utf8"));
  return root;
}
const editFile = (root, file, from, to) => {
  const full = path.join(root, file);
  const text = readFileSync(full, "utf8");
  assert.ok(text.includes(from), `${file} contains ${from}`);
  writeFileSync(full, text.replace(from, to));
};

test("the shared list matches the current database and the website code", () => {
  const { failures, reasons } = runReasonCheck({ root: repo });
  assert.deepEqual(failures, []);
  assert.ok(reasons >= 50);
});

test("renaming a database reason fails until the shared list is regenerated", (t) => {
  const root = copyOfRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // What `pnpm db:foundation:snapshot` writes after an update renames the reason.
  editFile(
    root,
    `${FUNCTIONS}/internal/set_my_avatar.sql`,
    "detail='avatar_unavailable'",
    "detail='avatar_missing'"
  );
  const { failures } = runReasonCheck({ root });
  assert.ok(failures.some((line) => line.includes("raises 'avatar_missing'")));
  assert.ok(failures.some((line) => line.includes("names 'avatar_unavailable'")));
  const cli = spawnSync(
    process.execPath,
    [path.join(repo, "scripts/check-foundation-error-reasons.mjs")],
    {
      cwd: root,
      encoding: "utf8",
    }
  );
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /avatar_missing/);
  // --write regenerates the list; callers of the old name then fail the type check.
  assert.deepEqual(runReasonCheck({ root, write: true }).failures, []);
  const list = readFileSync(path.join(root, SHARED), "utf8");
  assert.match(list, /\n {2}avatar_missing: \["22023"\],\n/);
  assert.doesNotMatch(list, /avatar_unavailable/);
});

test("a changed code, a dropped message and a dynamic reason fail", (t) => {
  const root = copyOfRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  editFile(root, SHARED, 'avatar_unavailable: ["22023"]', 'avatar_unavailable: ["PT409"]');
  for (const name of ["activate_post", "queue_intro_trial"])
    editFile(
      root,
      `${FUNCTIONS}/internal/${name}.sql`,
      "'all posting capacity is in use'",
      "'posting capacity is in use'"
    );
  editFile(
    root,
    `${FUNCTIONS}/internal/set_my_avatar.sql`,
    "detail='avatar_unavailable'",
    "detail=v_reason"
  );
  const { failures } = runReasonCheck({ root });
  assert.ok(failures.some((line) => line.includes("detail is not a literal reason token")));
  assert.ok(failures.some((line) => line.includes("postingCapacityInUse")));
  editFile(
    root,
    `${FUNCTIONS}/internal/set_my_avatar.sql`,
    "detail=v_reason",
    "detail='avatar_unavailable'"
  );
  assert.ok(
    runReasonCheck({ root }).failures.some((line) =>
      line.includes("'avatar_unavailable' with code(s) 22023; the shared list says PT409")
    )
  );
});

test("website code may not match a reason by comparing details with a string", () => {
  const found = findRawReasonComparisons([
    ["a.ts", 'if (error.details === "slug_conflict") fail();'],
    ["b.ts", 'if ("slug_conflict" !== result.error?.details) ok();'],
    ["c.ts", 'if (typeof record.details === "object") read(record.details);'],
    ["d.ts", 'if (hasDatabaseReason(error, "slug_conflict")) fail();'],
  ]);
  assert.deepEqual(
    found.map((line) => line.split(":")[0]),
    ["a.ts", "b.ts"]
  );
});

test("raise statements are read across lines, with semicolons and quotes in messages", () => {
  const [first, second, third] = parseRaiseStatements(`
    raise exception 'Posting terms changed; review the current version'
      using errcode = 'PT409', detail = 'posting_terms_changed';
    raise exception 'it''s %', v_name using errcode='22023', detail='x_invalid', hint = format('a, b');
    -- raise exception 'commented out' using detail='ignored';
    raise exception using message = 'by option', errcode = 'PT404';
  `);
  assert.deepEqual(first, {
    message: "Posting terms changed; review the current version",
    formatted: false,
    options: { errcode: "PT409", detail: "posting_terms_changed" },
    dynamic: [],
  });
  assert.equal(second.message, "it's %");
  assert.equal(second.formatted, true);
  assert.deepEqual(second.dynamic, ["hint"]);
  assert.equal(third.message, "by option");
});
