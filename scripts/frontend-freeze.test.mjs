import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BASELINE_COMMIT,
  COLUMNS,
  FROZEN_PATHSPEC,
  LEDGER_END,
  LEDGER_FILE,
  LEDGER_START,
  compareLedger,
  currentVersions,
  differingPaths,
  ensureBaseline,
  parseLedger,
  refreshVersions,
} from "./lib/frontend-freeze.mjs";

const header = `| ${COLUMNS.join(" | ")} |\n| ${COLUMNS.map(() => "---").join(" | ")} |`;
const row = (file, version = "0123456789ab", overrides = {}) => {
  const cells = {
    kind: "rewiring",
    reason: "Reads from the new backend",
    screen: "Nothing",
    proposed: "keep",
    decision: "awaiting owner",
    date: "2026-11-08",
    ...overrides,
  };
  return `| \`${file}\` | ${cells.kind} | ${cells.reason} | ${cells.screen} | ${cells.proposed} | ${cells.decision} | ${cells.date} | ${version} |`;
};
const ledger = (...rows) =>
  `# Ledger\n\n${LEDGER_START}\n\n## Group\n\n${header}\n${rows.join("\n")}\n\n${LEDGER_END}\n\n## Put back\n\n| File | Put back on | How |\n| --- | --- | --- |\n| \`src/old.tsx\` | 2026-11-09 | checkout |\n`;

test("the scope matches FRONTEND-RESTORE.md and the chosen commit is pinned", () => {
  assert.equal(BASELINE_COMMIT, "0b562f42f96b5390c62244cb9e97b219da1471f4");
  for (const entry of [
    "src/components",
    "src/hooks",
    "src/stores",
    "public",
    "tailwind.config.ts",
    ":(glob)src/app/**/*.tsx",
    ":(glob)src/app/**/*.css",
    ":(glob)src/app/**/*.scss",
  ]) {
    assert(FROZEN_PATHSPEC.includes(entry), entry);
  }
});

test("parses active rows only and validates every cell", () => {
  const { rows, errors } = parseLedger(ledger(row("src/components/a.tsx"), row("src/app/b.tsx")));
  assert.deepEqual(errors, []);
  assert.deepEqual(
    rows.map((item) => item.path),
    ["src/components/a.tsx", "src/app/b.tsx"]
  );
  assert.equal(rows[0].decision, "awaiting owner");

  const bad = parseLedger(
    ledger(
      row("src/components/a.tsx", "zz"),
      row("src/components/b.tsx", undefined, { kind: "style" }),
      row("src/components/c.tsx", undefined, { proposed: "maybe" }),
      row("src/components/d.tsx", undefined, { decision: "" }),
      row("src/components/e.tsx", undefined, { date: "8 Nov" }),
      "| src/components/f.tsx | rewiring | r | s | keep | awaiting owner | 2026-11-08 | 0123456789ab |",
      "| `src/components/g.tsx` | rewiring | too few |"
    )
  );
  assert.equal(bad.errors.length, 7, bad.errors.join("\n"));
  assert.match(bad.errors.join("\n"), /Version must be/);
  assert.match(bad.errors.join("\n"), /kind "style"/);
  assert.match(bad.errors.join("\n"), /Proposed must start/);
  assert.match(bad.errors.join("\n"), /Owner decision is empty/);
  assert.match(bad.errors.join("\n"), /Date must be/);
  assert.match(bad.errors.join("\n"), /one path in backticks/);
  assert.match(bad.errors.join("\n"), /expected 8 cells/);
});

test("refuses a ledger without markers or with a changed header", () => {
  assert.match(parseLedger(`${header}\n${row("a.tsx")}`).errors[0], /needs the markers/);
  const renamed = ledger(row("a.tsx")).replace("| Owner decision |", "| Decision |");
  assert.match(parseLedger(renamed).errors.join("\n"), /table header must be/);
});

test("accepts escaped pipes and deleted files", () => {
  const { rows, errors } = parseLedger(
    ledger(row("src/components/a.tsx", "deleted", { reason: "a \\| b" }))
  );
  assert.deepEqual(errors, []);
  assert.equal(rows[0].version, "deleted");
});

test("reports missing, changed, stale and duplicate rows", () => {
  const differing = new Map([
    ["src/components/a.tsx", "aaaaaaaaaaaa"],
    ["src/components/b.tsx", "bbbbbbbbbbbb"],
    ["src/components/new.tsx", "cccccccccccc"],
  ]);
  const { rows } = parseLedger(
    ledger(
      row("src/components/a.tsx", "aaaaaaaaaaaa"),
      row("src/components/b.tsx", "000000000000"),
      row("src/components/back.tsx", "dddddddddddd"),
      row("src/components/a.tsx", "aaaaaaaaaaaa")
    )
  );
  const result = compareLedger(differing, rows);
  assert.deepEqual(result.missing, ["src/components/new.tsx"]);
  assert.deepEqual(
    result.changed.map((item) => item.path),
    ["src/components/b.tsx"]
  );
  assert.deepEqual(
    result.stale.map((item) => item.path),
    ["src/components/back.tsx"]
  );
  assert.deepEqual(
    result.duplicates.map((item) => item.path),
    ["src/components/a.tsx"]
  );
  assert.deepEqual(
    compareLedger(new Map([["src/components/a.tsx", "aaaaaaaaaaaa"]]), [
      { path: "src/components/a.tsx", version: "aaaaaaaaaaaa", line: 1 },
    ]),
    { missing: [], stale: [], changed: [], duplicates: [] }
  );
});

test("refreshes versions of listed rows without adding or removing rows", () => {
  const text = ledger(row("src/components/a.tsx", "000000000000"), row("src/components/b.tsx"));
  const { text: next, updated } = refreshVersions(
    text.replace(/\n/g, "\r\n"),
    new Map([
      ["src/components/a.tsx", "aaaaaaaaaaaa"],
      ["src/components/new.tsx", "cccccccccccc"],
    ])
  );
  assert.deepEqual(updated, ["src/components/a.tsx"]);
  assert(next.includes("\r\n"), "keeps CRLF line endings");
  const rows = parseLedger(next).rows;
  assert.equal(rows.find((item) => item.path === "src/components/a.tsx").version, "aaaaaaaaaaaa");
  assert.equal(rows.find((item) => item.path === "src/components/b.tsx").version, "0123456789ab");
  assert.equal(rows.length, 2);
});

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "frontend-freeze-"));
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.test",
        "-c",
        "core.autocrlf=false",
        ...args,
      ],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  git("init", "-q");
  return { dir, git, write };
}

test("finds differences in the restored scope against a baseline commit", (t) => {
  const { dir, git, write } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  write("src/components/card.tsx", "export const a = 1;\n");
  write("src/components/old-name.tsx", "export const b = 1;\n");
  write("src/app/page.tsx", "export default 1;\n");
  write("src/app/api/route.ts", "export const GET = 1;\n");
  write("src/lib/data.ts", "export const c = 1;\n");
  write("public/logo.svg", "<svg/>\n");
  git("add", "-A");
  git("commit", "-q", "-m", "baseline");
  const baseline = git("rev-parse", "HEAD");

  write("src/components/card.tsx", "export const a = 2;\n");
  git("mv", "src/components/old-name.tsx", "src/components/new-name.tsx");
  write("src/app/api/route.ts", "export const GET = 2;\n");
  write("src/lib/data.ts", "export const c = 2;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "drift");
  write("src/app/(group)/new/page.tsx", "export default 2;\n");

  const differing = differingPaths({ cwd: dir, commit: baseline });
  assert.deepEqual(differing, [
    "src/app/(group)/new/page.tsx",
    "src/components/card.tsx",
    "src/components/new-name.tsx",
    "src/components/old-name.tsx",
  ]);
  const versions = currentVersions({ cwd: dir, paths: differing });
  assert.equal(versions.get("src/components/old-name.tsx"), "deleted");
  assert.equal(
    versions.get("src/components/card.tsx"),
    git("rev-parse", "HEAD:src/components/card.tsx").slice(0, 12)
  );

  const ledgerText = ledger(
    row("src/components/card.tsx", versions.get("src/components/card.tsx")),
    row("src/components/new-name.tsx", versions.get("src/components/new-name.tsx")),
    row("src/components/old-name.tsx", "deleted"),
    row("src/app/(group)/new/page.tsx", versions.get("src/app/(group)/new/page.tsx"))
  );
  writeFileSync(path.join(dir, LEDGER_FILE), ledgerText);
  const result = compareLedger(
    versions,
    parseLedger(readFileSync(path.join(dir, LEDGER_FILE), "utf8")).rows
  );
  assert.deepEqual(result, { missing: [], stale: [], changed: [], duplicates: [] });

  write("src/components/card.tsx", "export const a = 3;\n");
  const after = currentVersions({
    cwd: dir,
    paths: differingPaths({ cwd: dir, commit: baseline }),
  });
  assert.deepEqual(
    compareLedger(after, parseLedger(ledgerText).rows).changed.map((item) => item.path),
    ["src/components/card.tsx"]
  );
});

test("does not fetch when the baseline is present and refuses when fetching is off", (t) => {
  const { dir, git, write } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  write("a.txt", "a\n");
  git("add", "-A");
  git("commit", "-q", "-m", "one");
  const head = git("rev-parse", "HEAD");
  assert.deepEqual(ensureBaseline({ cwd: dir, commit: head }), { fetched: false });
  assert.throws(
    () => ensureBaseline({ cwd: dir, commit: "1".repeat(40), fetch: false }),
    /is not in this clone/
  );
  assert.throws(
    () => ensureBaseline({ cwd: dir, commit: "1".repeat(40), remote: "missing-remote" }),
    /Could not fetch/
  );
});

test("the committed ledger is well formed", () => {
  const { rows, errors } = parseLedger(readFileSync(LEDGER_FILE, "utf8"));
  assert.deepEqual(errors, []);
  assert(rows.length > 0);
  assert.equal(new Set(rows.map((item) => item.path)).size, rows.length);
});
