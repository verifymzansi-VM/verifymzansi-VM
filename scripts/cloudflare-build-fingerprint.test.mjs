import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cloudflareBuildFingerprint } from "./lib/cloudflare-build-fingerprint.mjs";
function fixture(run) {
  const base = realpathSync(tmpdir());
  const root = mkdtempSync(path.join(base, "vm-build-cache-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "src", "page.ts"), "export const value = 1;");
  const list = () => "src/page.ts\0";
  try {
    run(root, list);
  } finally {
    assert.equal(path.dirname(realpathSync(root)), base);
    assert.ok(path.basename(root).startsWith("vm-build-cache-"));
    rmSync(root, { recursive: true, force: true });
  }
}
test("a changed client project cannot reuse an old Worker artifact", () =>
  fixture((root, list) => {
    const previous = cloudflareBuildFingerprint(
      root,
      { NEXT_PUBLIC_SUPABASE_URL: "https://retired.invalid" },
      list
    );
    assert.notEqual(
      previous,
      cloudflareBuildFingerprint(
        root,
        { NEXT_PUBLIC_SUPABASE_URL: "https://approved.invalid" },
        list
      )
    );
  }));
test("source changes invalidate output independently of credentials", () =>
  fixture((root, list) => {
    const previous = cloudflareBuildFingerprint(root, {}, list);
    writeFileSync(path.join(root, "src", "page.ts"), "export const value = 2;");
    assert.notEqual(previous, cloudflareBuildFingerprint(root, {}, list));
  }));
test("runtime secrets are never part of the public build fingerprint", () =>
  fixture((root, list) => {
    const first = cloudflareBuildFingerprint(
      root,
      { PRIVATE_RUNTIME_TOKEN: "synthetic-runtime-one" },
      list
    );
    assert.equal(
      first,
      cloudflareBuildFingerprint(root, { PRIVATE_RUNTIME_TOKEN: "synthetic-runtime-two" }, list)
    );
  }));
test("file order and environment insertion order do not change the artifact identity", () =>
  fixture((root, list) => {
    assert.equal(
      cloudflareBuildFingerprint(root, { NEXT_PUBLIC_A: "a", NEXT_PUBLIC_B: "b" }, list),
      cloudflareBuildFingerprint(root, { NEXT_PUBLIC_B: "b", NEXT_PUBLIC_A: "a" }, list)
    );
  }));
test("unexpected or escaping file paths cannot enter the build cache", () =>
  fixture((root) => {
    assert.throws(() => cloudflareBuildFingerprint(root, {}, () => "../secret\0"), /Unexpected/);
    assert.throws(() => cloudflareBuildFingerprint(root, {}, () => ""), /No build sources/);
  }));
