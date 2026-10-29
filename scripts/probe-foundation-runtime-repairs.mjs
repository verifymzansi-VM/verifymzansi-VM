import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { nativeIsolation } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";

// Run only after the maintained local native fixture is prepared. All rows and
// side effects roll back; no installed schema, authority or provider is changed.
assert.equal(process.argv.length, 2);
const { workdir, env, dockerArgs } = nativeIsolation();
const release = acquireFixtureOperation(workdir, "test");
try {
  const result = execFileSync(
    "docker",
    [
      ...dockerArgs,
      "exec",
      "-i",
      "supabase_db_backend-foundation-impl",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-XqAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: readFileSync("scripts/lib/foundation-runtime-repairs.sql", "utf8"),
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  assert.ok(result.includes("PASS runtime retention regressions"));
  process.stdout.write(
    "PASS native held-prefix progress and abandoned-upload expiry; fixture transaction rolled back.\n"
  );
} finally {
  release();
}
