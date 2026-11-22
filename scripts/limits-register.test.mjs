// Tests for the limits register check (scripts/lib/limits-register.mjs) and
// the committed register (docs/testing/limits-register.json).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  checkLimitsRegister,
  readLimitsRegister,
  scanLimitFindings,
  sqlLimitNumbers,
} from "./lib/limits-register.mjs";

/** A throwaway repository with `files` ({ path: text }). */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "limits-register-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const FN = "database/foundation/current/functions/internal/send_thing.sql";
const TABLE = "database/foundation/current/tables/private/things.sql";
const TEST = "scripts/send-thing.test.mjs";
const baseFiles = () => ({
  [FN]: [
    "CREATE OR REPLACE FUNCTION internal.send_thing()",
    "  -- a comment mentioning >= 99 is ignored",
    "  if (select count(*) from private.things t",
    "      where t.created_at>statement_timestamp()-interval '1 hour')>=10 then",
    "    raise exception 'too many things' using errcode='PT429'; end if;",
    "  if p_revision not between 1 and 2147483646 then raise exception 'x'; end if;",
  ].join("\n"),
  [TABLE]: [
    "create table private.things (",
    "  note text,",
    "  constraint things_note_check CHECK (length(note) >= 1 AND length(note) <= 300),",
    "  constraint things_kind_check CHECK (kind = ANY (ARRAY['a'::text]))",
    ");",
  ].join("\n"),
  [TEST]: "// LIM-SQL-things-hour\n",
});
const entry = (overrides = {}) => ({
  id: "LIM-SQL-things-hour",
  title: "Things: at most 10 an hour",
  value: 10,
  category: "rate",
  enforcedAt: [{ file: FN, contains: "interval '1 hour')>=10 then" }],
  tests: [{ kind: "behaviour", file: TEST }],
  ...overrides,
});
const tableEntry = {
  id: "LIM-T-things_note_check",
  title: "Things: note 1 to 300 characters",
  value: "1 to 300",
  category: "length",
  enforcedAt: [
    {
      file: TABLE,
      contains: "constraint things_note_check CHECK (length(note) >= 1 AND length(note) <= 300)",
    },
  ],
  tests: [{ kind: "declaration", mechanism: "LIM-SQL-things-hour" }],
};
const run = (files, register) => {
  const root = fixture(files);
  try {
    return checkLimitsRegister({ root, register });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("SQL limit numbers ignore integer-range guards, small numbers and non-comparisons", () => {
  assert.deepEqual(sqlLimitNumbers("if x>=10 then"), [10]);
  assert.deepEqual(sqlLimitNumbers("p_limit not between 1 and 500"), [500]);
  assert.deepEqual(sqlLimitNumbers("p_revision not between 1 and 2147483646"), []);
  assert.deepEqual(sqlLimitNumbers("claim_generation<9223372036854775807"), []);
  assert.deepEqual(sqlLimitNumbers("p->>'notes' and x->0 and y=>5"), []);
  assert.deepEqual(sqlLimitNumbers("internal.privacy_text(p_note,10,1000)"), [10, 1000]);
  assert.deepEqual(sqlLimitNumbers("order by created_at desc limit 50;"), [50]);
  assert.deepEqual(sqlLimitNumbers("photo_limit:=10; video_limit:=1;"), [10]);
  assert.deepEqual(sqlLimitNumbers("allowed := least(p_limit, 20 - (select 1));"), [20]);
  assert.deepEqual(sqlLimitNumbers("raise exception 'limit 1 to 500 reached';"), []);
  assert.deepEqual(sqlLimitNumbers("x := greatest(a, interval '7 days');"), []);
});

test("a short anchor cannot cover a line with a number it does not name", () => {
  const files = baseFiles();
  files[FN] += "\n  if p_limit not between 1 and 50 then raise exception 'x'; end if;";
  const broad = { file: FN, contains: "if p_limit not between", reason: "fixture" };
  const loose = run(files, { limits: [entry(), tableEntry], notLimits: [broad] });
  assert.ok(loose.failures.some((f) => /unregistered limit-looking line .*and 50 then/.test(f)));
  const exact = { ...broad, contains: "if p_limit not between 1 and 50 then" };
  assert.deepEqual(run(files, { limits: [entry(), tableEntry], notLimits: [exact] }).failures, []);
});

test("guard-only entries are counted as present but not behaviour-tested", () => {
  const guard = {
    id: "LIM-MECH-SQL-GUARD",
    title: "guard lines",
    value: "mechanism",
    category: "mechanism",
    enforcedAt: [{ file: FN, contains: "send_thing" }],
    tests: [{ kind: "register", file: TEST }],
  };
  const files = { ...baseFiles(), [TEST]: "// LIM-SQL-things-hour limits-register.json\n" };
  const { failures, stats } = run(files, {
    limits: [
      entry({ tests: [{ kind: "declaration", mechanism: "LIM-MECH-SQL-GUARD" }] }),
      guard,
      { ...tableEntry, tests: [{ kind: "register", file: TEST }] },
    ],
  });
  assert.deepEqual(failures, []);
  assert.equal(stats.untested, 1);
  assert.equal(stats.register, 2);
  assert.equal(stats.declaration, 0);
});

test("a complete register passes", () => {
  const { failures, stats } = run(baseFiles(), { limits: [entry(), tableEntry], notLimits: [] });
  assert.deepEqual(failures, []);
  assert.equal(stats.limits, 2);
  assert.equal(stats.findings, 2);
});

test("a changed value fails: the anchor no longer matches", () => {
  const files = baseFiles();
  files[FN] = files[FN].replace(")>=10 then", ")>=12 then");
  const { failures } = run(files, { limits: [entry(), tableEntry], notLimits: [] });
  assert.ok(
    failures.some((f) => /LIM-SQL-things-hour: .* no longer contains/.test(f)),
    failures.join("\n")
  );
  assert.ok(failures.some((f) => /unregistered limit-looking line .*>=12 then/.test(f)));
});

test("a missing test file, or a test that does not name the id, fails", () => {
  const missing = run(baseFiles(), {
    limits: [entry({ tests: [{ kind: "behaviour", file: "scripts/gone.test.mjs" }] }), tableEntry],
  });
  assert.ok(missing.failures.some((f) => /test file scripts\/gone\.test\.mjs is missing/.test(f)));
  const files = baseFiles();
  files[TEST] = "// tests something else\n";
  const unnamed = run(files, { limits: [entry(), tableEntry] });
  assert.ok(unnamed.failures.some((f) => /does not reference LIM-SQL-things-hour/.test(f)));
  // A longer id that starts with this one does not name it.
  files[TEST] = "// LIM-SQL-things-hour-2 and LIM-SQL-things-hour_daily\n";
  const prefixed = run(files, { limits: [entry(), tableEntry] });
  assert.ok(prefixed.failures.some((f) => /does not reference LIM-SQL-things-hour/.test(f)));
});

test("a register-driven test must read the register", () => {
  const { failures } = run(baseFiles(), {
    limits: [entry({ tests: [{ kind: "register", file: TEST }] }), tableEntry],
  });
  assert.ok(failures.some((f) => /does not read the register/.test(f)));
});

test("a declaration needs a tested mechanism", () => {
  const unknown = run(baseFiles(), {
    limits: [entry(), { ...tableEntry, tests: [{ kind: "declaration", mechanism: "LIM-X-nope" }] }],
  });
  assert.ok(unknown.failures.some((f) => /mechanism LIM-X-nope is not in the register/.test(f)));
  const untested = run(baseFiles(), {
    limits: [
      entry({ tests: [{ kind: "declaration", mechanism: "LIM-T-things_note_check" }] }),
      tableEntry,
    ],
  });
  assert.ok(untested.failures.some((f) => /must itself have a behaviour or register test/.test(f)));
});

test("an unregistered limit-looking line fails until registered or reviewed as not a limit", () => {
  const { failures } = run(baseFiles(), { limits: [entry()] });
  assert.ok(failures.some((f) => /unregistered limit-looking line .*things_note_check/.test(f)));
  const reviewed = run(baseFiles(), {
    limits: [entry()],
    notLimits: [
      {
        file: TABLE,
        contains: "things_note_check CHECK (length(note) >= 1 AND length(note) <= 300)",
        reason: "fixture",
      },
    ],
  });
  assert.deepEqual(reviewed.failures, []);
});

test("a stale notLimits item, a duplicate id and a malformed entry fail", () => {
  const { failures } = run(baseFiles(), {
    limits: [entry(), entry(), tableEntry, { id: "bad" }],
    notLimits: [{ file: TABLE, contains: "no such line", reason: "fixture" }],
  });
  assert.ok(failures.some((f) => /duplicate id/.test(f)));
  assert.ok(failures.some((f) => /^bad: malformed/.test(f)));
  assert.ok(failures.some((f) => /notLimits\[0\]: .* no longer has a line/.test(f)));
});

test("the committed register matches the repository", () => {
  const register = readLimitsRegister();
  const { failures, stats } = checkLimitsRegister({ register, findings: scanLimitFindings() });
  assert.deepEqual(failures, []);
  assert.ok(stats.limits > 500, `${stats.limits} limits`);
});
