import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  unlinkSync,
  rmdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { assertFixturePath, ensureFixtureDirectory } from "./lib/foundation-native-paths.mjs";

test("fixture directory creation refuses a nested junction before writing", () => {
  const parent = path.resolve("tmp");
  mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(path.join(parent, "native-path-"));
  const elsewhere = path.join(base, "elsewhere");
  mkdirSync(elsewhere);
  const nested = ensureFixtureDirectory(base, "tmp/supabase");
  const link = path.join(nested, "migrations");
  try {
    symlinkSync(elsewhere, link, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => ensureFixtureDirectory(base, "tmp/supabase/migrations/new"));
    assert.equal(existsSync(path.join(elsewhere, "new")), false);
    assert.throws(() =>
      assertFixturePath(base, "tmp/supabase/migrations/config.toml", {
        allowMissing: true,
        type: "file",
      })
    );
    assert.throws(() => ensureFixtureDirectory(base, "../outside"));
  } finally {
    unlinkSync(link);
    rmdirSync(nested);
    rmdirSync(path.dirname(nested));
    rmdirSync(elsewhere);
    rmdirSync(base);
  }
});
test("fixture file checks refuse a symlink and accept only ordinary owned files", () => {
  const parent = path.resolve("tmp");
  mkdirSync(parent, { recursive: true });
  const base = mkdtempSync(path.join(parent, "native-path-"));
  const file = path.join(base, "source.sql"),
    link = path.join(base, "alias.sql");
  writeFileSync(file, "select 1;");
  try {
    symlinkSync(file, link, "file");
    assert.throws(() => assertFixturePath(base, "alias.sql", { type: "file" }));
    assert.equal(assertFixturePath(base, "source.sql", { type: "file" }), file);
  } finally {
    if (existsSync(link)) unlinkSync(link);
    unlinkSync(file);
    rmdirSync(base);
  }
});
