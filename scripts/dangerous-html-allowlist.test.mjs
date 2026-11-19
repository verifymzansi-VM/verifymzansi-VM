// dangerouslySetInnerHTML is allowed only in the reviewed files listed in
// eslint.config.mjs (DANGEROUS_HTML_ALLOWLIST). These tests prove the lint
// rule rejects a new use anywhere else, and pin how many times each allowed
// file names the prop (DANGEROUS_HTML_USES), counted as plain text anywhere in
// the repository's code. So an entry cannot linger, a second use in an allowed
// file fails, and forms the lint selectors miss (a computed key) still count.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";
import { DANGEROUS_HTML_ALLOWLIST, DANGEROUS_HTML_USES } from "../eslint.config.mjs";

const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedSyntax(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === "no-restricted-syntax");
}

const JSX_USE =
  'export default function Page() {\n  return <div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />;\n}\n';

test("a new dangerouslySetInnerHTML outside the allowlist is a lint error", async () => {
  for (const filePath of ["src/app/new-page/page.tsx", "src/components/listing/card.tsx"]) {
    const messages = await restrictedSyntax(filePath, JSX_USE);
    assert.equal(messages.length, 1, filePath);
    assert.equal(messages[0].severity, 2);
    assert.match(messages[0].message, /DANGEROUS_HTML_ALLOWLIST/);
  }
});

test("the prop is caught when passed through createElement or spread props", async () => {
  const code = [
    'import { createElement } from "react";',
    'export const a = createElement("div", { dangerouslySetInnerHTML: { __html: "x" } });',
    'export const b = createElement("div", { "dangerouslySetInnerHTML": { __html: "x" } });',
    "",
  ].join("\n");
  assert.equal((await restrictedSyntax("src/lib/html.ts", code)).length, 2);
});

test("the reviewed files may keep their uses, including paths with brackets", async () => {
  for (const filePath of [
    "src/app/layout.tsx",
    "src/app/listing/[id]/page.tsx",
    "src/app/(marketplace)/promotions/page.tsx",
  ]) {
    assert.deepEqual(await restrictedSyntax(filePath, JSX_USE), [], filePath);
  }
});

// Files that name the prop without using it: this lint configuration and the
// tests about it.
const NAMES_ONLY = new Set(["eslint.config.mjs", "scripts/dangerous-html-allowlist.test.mjs"]);

/**
 * How many times each code file in the repository (tracked or untracked, not
 * ignored) contains the text "dangerouslySetInnerHTML", in any form: JSX, an
 * object key, a quoted or computed key, a string. Test and spec files and
 * NAMES_ONLY are left out.
 */
function textUses(cwd = process.cwd(), { noIndex = false } = {}) {
  const output = execFileSync(
    "git",
    [
      "grep",
      "-o",
      noIndex ? "--no-index" : "--untracked",
      "-e",
      "dangerouslySetInnerHTML",
      "--",
      ...["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"].map((ext) => `*.${ext}`),
    ],
    { cwd, encoding: "utf8" }
  );
  const counts = {};
  for (const line of output.split("\n").filter(Boolean)) {
    const file = line.slice(0, line.lastIndexOf(":dangerouslySetInnerHTML"));
    if (NAMES_ONLY.has(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
    counts[file] = (counts[file] ?? 0) + 1;
  }
  return counts;
}

test("the prop text appears only in the allowlist, as often as each entry pins", () => {
  const sorted = (record) => Object.fromEntries(Object.entries(record).sort());
  assert.ok(DANGEROUS_HTML_ALLOWLIST.length > 0);
  assert.deepEqual(sorted(textUses()), sorted(DANGEROUS_HTML_USES));
});

test("the count sees a second use in an allowed file and a computed key elsewhere", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dangerous-html-"));
  try {
    mkdirSync(path.join(dir, "src", "lib"), { recursive: true });
    writeFileSync(
      path.join(dir, "src", "page.tsx"),
      [
        'export const A = () => <i dangerouslySetInnerHTML={{ __html: "a" }} />;',
        'export const B = () => <b dangerouslySetInnerHTML={{ __html: "b" }} />;',
        "",
      ].join("\n")
    );
    // A computed key: invisible to the lint selectors, not to the text count.
    writeFileSync(
      path.join(dir, "src", "lib", "html.ts"),
      'const props = { ["dangerouslySetInnerHTML"]: { __html: "x" } };\nexport default props;\n'
    );
    writeFileSync(path.join(dir, "src", "lib", "html.test.ts"), "// dangerouslySetInnerHTML\n");
    assert.deepEqual(textUses(dir, { noIndex: true }), { "src/lib/html.ts": 1, "src/page.tsx": 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
