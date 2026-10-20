import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import config from "../lint-staged.config.cjs";

const script = config["**/*.{ts,tsx}"];
const format = config["**/*.{json,css,md}"];
const vendor = path.resolve(".agents/skills/next-browser/src/browser.ts");

test("upstream browser-tool files keep their own lint and formatting policy", () => {
  assert.deepEqual(script([vendor]), []);
  assert.deepEqual(format([path.resolve(".agents/skills/next-browser/README.md")]), []);
});

test("mixed staged files retain application and root-config checks", () => {
  const file = path.resolve("src/app/(auth)/login/page.tsx");
  const root = path.resolve("tailwind.config.ts");
  const tasks = script([vendor, file, root]);
  assert.equal(tasks.length, 2);
  assert.ok(tasks[0].startsWith("pnpm exec eslint --fix --max-warnings=0 "));
  assert.ok(tasks[1].startsWith("pnpm exec prettier --write "));
  for (const task of tasks) {
    assert.ok(task.includes("src/app/(auth)/login/page.tsx"));
    assert.ok(task.includes("tailwind.config.ts"));
    assert.equal(task.includes("next-browser"), false);
  }
});

test("maintained audit skills still receive formatting checks", () => {
  const tasks = format([path.resolve(".agents/skills/code-review-security-auditor/SKILL.md")]);
  assert.equal(tasks.length, 1);
  assert.ok(tasks[0].includes("code-review-security-auditor/SKILL.md"));
});

test("a file outside the checkout cannot be added to a task", () => {
  assert.throws(() => script([path.resolve("..", "outside.ts")]), /outside the project/);
});
