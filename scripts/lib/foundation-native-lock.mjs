import { mkdirSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** Serializes this fixture's cooperating scripts; never removes a stale lock automatically. */
export function acquireFixtureOperation(workdir, operation) {
  if (
    path.resolve(workdir) !== path.resolve("tmp/backend-foundation-native") ||
    !["prepare", "start", "stop", "reset", "test"].includes(operation)
  )
    throw new Error("Invalid fixture operation");
  const lockPath = path.join(workdir, ".fixture-operation-lock");
  mkdirSync(lockPath); // Exclusive and atomic: EEXIST denies a concurrent operation.
  const nonce = randomUUID();
  const ownerPath = path.join(lockPath, "owner.json");
  writeFileSync(ownerPath, JSON.stringify({ nonce, operation, pid: process.pid }), { flag: "wx" });
  let released = false;
  return () => {
    if (released) return;
    if (JSON.parse(readFileSync(ownerPath, "utf8")).nonce !== nonce)
      throw new Error("Fixture lock ownership changed");
    // Delete only this operation's known file and its empty directory, never recursively.
    unlinkSync(ownerPath);
    rmdirSync(lockPath);
    released = true;
  };
}
