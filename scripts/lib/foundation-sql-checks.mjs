// Shared helpers for the behaviour checks that run against the throwaway SQL
// lint container (scripts/test-foundation-staff-rules.mjs,
// scripts/test-foundation-selfie-capture.mjs): named checks, psql calls that
// fail with the current check's name, and synthetic API-role sessions.
import assert from "node:assert/strict";

/** Named checks; `current()` is the check that is running (for messages). */
export function createChecks() {
  const passed = [];
  let current = "start";
  return {
    passed,
    current: () => current,
    check(id, fn) {
      current = id;
      return Promise.resolve(fn()).then(() => {
        passed.push(id);
        console.log(`PASS ${id}`);
      });
    },
  };
}

/** psql helpers for `database` (startLintDatabase) and synthetic sessions:
 * members and staff as `authenticated` with JWT claims and a live session row,
 * server calls as `service_role`. */
export function sqlHelpers(database, current) {
  const run = (sql) => database.psql(`\\set VERBOSITY verbose\n${sql}`, ["-A", "-t"]);
  const q = (sql) => {
    const result = run(sql);
    if (result.status !== 0) throw new Error(`[${current()}] SQL failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  const json = (sql) => JSON.parse(q(sql));
  const fails = (sql, state, message) => {
    const result = run(sql);
    assert.notEqual(result.status, 0, `[${current()}] expected ${state}, the command succeeded`);
    const sqlstate = /ERROR:\s+([0-9A-Z]{5}):/.exec(result.stderr)?.[1];
    assert.equal(sqlstate, state, `[${current()}] ${result.stderr}`);
    if (message) assert.match(result.stderr, message, `[${current()}] ${result.stderr}`);
    return result.stderr;
  };
  const claims = (user) => ({
    sub: user.id,
    role: "authenticated",
    session_id: user.session,
    aal: "aal1",
    is_anonymous: false,
  });
  const as = (payload, sql) =>
    `\\o /dev/null\nselect set_config('request.jwt.claim.sub','${payload.sub}',false),set_config('request.jwt.claims','${JSON.stringify(payload)}',false);\n\\o\nset role authenticated;\n${sql}`;
  const member = (user, sql) => as(claims(user), sql);
  // A staff session whose authenticator app was verified at `totpAt` (now by
  // default).
  const staff = (user, sql, totpAt = Math.floor(Date.now() / 1000)) =>
    as({ ...claims(user), aal: "aal2", amr: [{ method: "totp", timestamp: totpAt }] }, sql);
  const service = (sql) => `set role service_role;\n${sql}`;
  return { run, q, json, fails, claims, as, member, staff, service };
}
