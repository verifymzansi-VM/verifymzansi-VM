import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import modernDefault, { minimatch, Minimatch } from "minimatch";
import { glob, globSync } from "glob";

const require = createRequire(import.meta.url);
test("fixed minimatch supports legacy callable and modern named/default interfaces", () => {
  const legacy = require("minimatch");
  assert.equal(require("minimatch/package.json").version, "11.0.1");
  assert.equal(typeof legacy, "function");
  assert.equal(legacy.minimatch, legacy);
  assert.equal(modernDefault, minimatch);
  for (const match of [legacy, minimatch, modernDefault]) {
    assert.equal(match("src/app/home/page.tsx", "src/**/page.tsx"), true);
    assert.equal(match("photo.png", "*.tsx"), false);
    assert.equal(match("script.ts", "*.{ts,tsx}"), true);
  }
  assert.equal(new Minimatch("*.ts").match("script.ts"), true);
  assert.equal(new legacy.Minimatch("*.ts").match("script.ts"), true);
});

test("the frozen lockfile records the exact reviewed compatibility patch", () => {
  const patch = readFileSync("patches/minimatch@11.0.1.patch");
  const hash = createHash("sha256").update(patch).digest("hex");
  const lock = readFileSync("pnpm-lock.yaml", "utf8");
  assert.equal(lock.match(/minimatch@11\.0\.1:\s+hash:\s+([a-f0-9]+)/)?.[1], hash);
  assert.match(patch.toString(), /module\.exports = Object\.assign\(core\.minimatch, core\)/);
});

test("fixed glob preserves the synchronous and asynchronous build-tool APIs", async () => {
  assert.equal(require("glob/package.json").version, "14.0.2");
  const pattern = "src/lib/foundation/*-route.ts";
  const sync = globSync(pattern).sort();
  assert.ok(
    sync.some((file) => file.replaceAll("\\", "/") === "src/lib/foundation/contact-reveal-route.ts")
  );
  assert.deepEqual((await glob(pattern)).sort(), sync);
});
