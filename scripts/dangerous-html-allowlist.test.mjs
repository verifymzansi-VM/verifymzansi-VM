// dangerouslySetInnerHTML is allowed only in the reviewed files listed in
// eslint.config.mjs (DANGEROUS_HTML_ALLOWLIST). These tests prove the lint
// rule rejects a new use anywhere else, and keep the list equal to the files
// that use it today, so an entry cannot linger and silently cover a later use.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { ESLint } from "eslint";
import { DANGEROUS_HTML_ALLOWLIST } from "../eslint.config.mjs";

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

test("the allowlist names exactly the files that use dangerouslySetInnerHTML", () => {
  const output = execFileSync(
    "git",
    [
      "grep",
      "-l",
      "--untracked",
      "-e",
      "dangerouslySetInnerHTML",
      "--",
      "src",
      "workers",
      "remotion",
      "e2e",
    ],
    { encoding: "utf8" }
  );
  const using = output
    .split("\n")
    .filter(Boolean)
    .filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file))
    .sort();
  assert.deepEqual(using, [...DANGEROUS_HTML_ALLOWLIST].sort());
});
