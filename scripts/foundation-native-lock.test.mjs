import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";

// Unit tests own a disposable cwd; never contend with a running real fixture.
function isolatedLockTest(action) {
  const original = process.cwd();
  const base = mkdtempSync(path.join(tmpdir(), "vm-foundation-lock-"));
  const workdir = path.join(base, "tmp/backend-foundation-native");
  mkdirSync(workdir, { recursive: true });
  try {
    process.chdir(base);
    action(workdir);
  } finally {
    process.chdir(original);
    // Only remove our known empty directories; preserve unexpected state.
    rmdirSync(workdir);
    rmdirSync(path.dirname(workdir));
    rmdirSync(base);
  }
}

test("native test excludes reset/start/stop until it releases its owned fence", () =>
  isolatedLockTest(() => {
    const workdir = path.resolve("tmp/backend-foundation-native");
    mkdirSync(workdir, { recursive: true });
    const release = acquireFixtureOperation(workdir, "test");
    try {
      for (const operation of ["prepare", "reset", "start", "stop", "test"])
        assert.throws(() => acquireFixtureOperation(workdir, operation));
    } finally {
      release();
    }
    const after = acquireFixtureOperation(workdir, "reset");
    after();
    after();
  }));
test("release refuses to delete another operation's lock ownership", () =>
  isolatedLockTest(() => {
    const workdir = path.resolve("tmp/backend-foundation-native");
    const release = acquireFixtureOperation(workdir, "test");
    const ownerPath = path.join(workdir, ".fixture-operation-lock/owner.json");
    const original = readFileSync(ownerPath, "utf8");
    try {
      writeFileSync(ownerPath, JSON.stringify({ nonce: "different-owner" }));
      assert.throws(release);
    } finally {
      writeFileSync(ownerPath, original);
      release();
    }
    assert.throws(() => acquireFixtureOperation(path.resolve("supabase"), "reset"));
  }));
