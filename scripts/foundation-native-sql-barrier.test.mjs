import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { controlNativeSqlChild } from "./lib/foundation-native-sql-barrier.mjs";

function controlledChild() {
  return spawn(
    process.execPath,
    [
      "-e",
      `
    let started = false;
    process.stdin.on('data', chunk => {
      if (!started) { started = true; process.stdout.write('EVIDENCE_LOCK_HELD:1234\\n'); }
      else if (/commit|rollback/.test(chunk.toString())) process.exit(0);
    });
    process.stdin.on('end', () => process.exit(started ? 0 : 1));
  `,
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
  );
}

test("explicit hold retains stdin until release and tracks actual child close", async () => {
  const child = controlledChild();
  const lock = controlNativeSqlChild(child, "begin;", { hold: true });
  try {
    await lock.barrier;
    assert.equal(lock.backendPid, 1234);
    assert.equal(child.stdin.writableEnded, false);
    assert.equal(child.exitCode, null);
    lock.release();
    lock.release();
    assert.equal(await lock.done, 0);
    assert.equal(child.stdin.writableEnded, true);
  } finally {
    lock.close();
    await lock.done;
  }
});

test("cleanup releases an explicit hold when a probe fails before commit", async () => {
  const lock = controlNativeSqlChild(controlledChild(), "begin;", { hold: true });
  try {
    await lock.barrier;
    lock.close();
    assert.equal(await lock.done, 0);
  } finally {
    lock.close();
    await lock.done;
  }
});

test("a child exiting before its barrier is a failure, not lock evidence", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(1)"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const lock = controlNativeSqlChild(child, "begin;", { hold: true });
  await assert.rejects(lock.barrier, /Local evidence (barrier missing|input failed)/);
  assert.equal(await lock.done, 1);
  lock.close();
});

function simulatedChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
}

test("a marker split across pipe chunks waits for the complete PID line", async () => {
  const child = simulatedChild();
  const lock = controlNativeSqlChild(child, "begin;", { hold: true });
  let reached = false;
  lock.barrier.then(() => {
    reached = true;
  });
  child.stdout.write("EVIDENCE_LOCK_HELD:12");
  await Promise.resolve();
  assert.equal(reached, false);
  assert.equal(lock.backendPid, undefined);
  child.stdout.write("345\n");
  await lock.barrier;
  assert.equal(lock.backendPid, 12345);
  lock.close();
  child.emit("close", 0);
  assert.equal(await lock.done, 0);
});

test("a child error rejects its barrier but completion waits for close", async () => {
  const child = simulatedChild();
  const lock = controlNativeSqlChild(child, "begin;", { hold: true });
  const rejection = assert.rejects(lock.barrier, /process failed/);
  let completed = false;
  lock.done.then(() => {
    completed = true;
  });
  child.emit("error", new Error("synthetic startup failure"));
  await rejection;
  assert.equal(completed, false);
  child.emit("close", -1);
  assert.equal(await lock.done, -1);
  lock.close();
});

test("an unavailable executable is closed and reported as failed evidence", async () => {
  const child = spawn(process.execPath + ".missing-foundation-probe", [], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let closed = false;
  child.once("close", () => {
    closed = true;
  });
  const lock = controlNativeSqlChild(child, "begin;", { hold: true });
  await assert.rejects(lock.barrier, /Local evidence (process|input) failed/);
  assert.notEqual(await lock.done, 0);
  assert.equal(closed, true);
  lock.close();
});
