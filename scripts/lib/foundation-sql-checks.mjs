// Shared helpers for the behaviour checks that run against the throwaway SQL
// lint container (scripts/test-foundation-*.mjs): named checks, psql calls that
// fail with the current check's name, synthetic API-role sessions, replaying
// the updates before the one under test and the read-only preflight check.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replaySteps } from "./foundation-replay.mjs";
import { applySteps } from "./foundation-sql-lint.mjs";

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

/** Replays prelude, candidate.sql and every update before `update` into
 * `database`; returns the replay steps, the update's index and its step. */
export function applyStepsBefore(database, update) {
  const { steps } = replaySteps();
  const index = steps.findIndex((step) => step.label === update);
  assert.ok(index > 0, `${update} is missing`);
  applySteps(database, steps.slice(0, index));
  return { steps, index, step: steps[index] };
}

/** A preflight must not write: in one read-only transaction, a write after it
 * fails with 25006. */
export function assertReadOnlyPreflight(database, preflight) {
  const write = database.psql(`${preflight}\ncreate table vmtest.marker(id uuid);`, [
    "-A",
    "-t",
    "-1",
    "-v",
    "VERBOSITY=verbose",
  ]);
  assert.notEqual(write.status, 0);
  assert.match(write.stderr, /ERROR:\s+25006:/);
}

/**
 * Read-only views of `database` an update's behaviour check uses: the schema
 * fingerprint, the update's preflight result as rows of [kind, detail], a
 * function body's md5 ("missing" when absent), and synthetic members (an
 * Auth user with a live session), written as the database owner.
 */
export function updateCheckViews(database, current, { preflight }) {
  const { q, json } = sqlHelpers(database, current);
  const fingerprintSql = readFileSync("database/foundation/fingerprint.sql", "utf8");
  let membersReady = false;
  return {
    fingerprint: () => q(`set search_path to pg_catalog;\n${fingerprintSql}`),
    preflightRows: () =>
      q(preflight)
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("|")),
    bodyMd5: (signature) =>
      q(
        `select coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('${signature}')),'missing');`
      ),
    syntheticMember: (label) => {
      if (!membersReady) {
        q(`create schema if not exists vmtest;
          create or replace function vmtest.member(p_label text) returns jsonb language plpgsql as $$
          declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
            insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
              values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
            insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
            return jsonb_build_object('id',uid,'session',sid);
          end$$;`);
        membersReady = true;
      }
      return json(`select vmtest.member('${label}');`);
    },
  };
}
