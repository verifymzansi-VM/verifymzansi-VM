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

/** An SQL string literal (quotes doubled). */
export const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** A jsonb literal, or SQL null for null. */
export const sqlJsonb = (value) =>
  value === null || value === undefined ? "null" : `${sqlLiteral(JSON.stringify(value))}::jsonb`;

/**
 * An Auth user created as GoTrue would (user details, and app details when
 * given, on the same insert, so triggers on auth.users see them), with a live
 * session. `json` is sqlHelpers' json. Returns { id, session }.
 */
export function authSignUp(json, meta, { app, anonymous = false, deleted = false } = {}) {
  return json(`with u as (
      insert into auth.users(id,email,email_confirmed_at,is_anonymous,deleted_at,raw_user_meta_data,raw_app_meta_data)
      values(gen_random_uuid(),${anonymous ? "null" : "'signup-'||gen_random_uuid()||'@example.invalid'"},
        ${anonymous ? "null" : "now()"},${anonymous},${deleted ? "now()" : "null"},${sqlJsonb(meta)},${sqlJsonb(app)})
      returning id),
    s as (insert into auth.sessions(id,user_id,aal) select gen_random_uuid(),id,'aal1' from u returning id,user_id)
    select jsonb_build_object('id',s.user_id,'session',s.id) from s;`);
}

/** For each function signature, whether anon, authenticated and
 * service_role may execute it. */
export function executeGrants(json, signatures) {
  return json(`select jsonb_object_agg(f, (select jsonb_object_agg(r, has_function_privilege(r,f,'execute'))
      from unnest(array['anon','authenticated','service_role']) r))
    from unnest(array[${signatures.map(sqlLiteral).join(",")}]) f;`);
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

/** A plan version that is on sale: `planId` itself; once the Individual slots
 * are on sale (20261113002421_individual_slots_r69.sql), the Individual slot
 * for the same number of days; between the switch to posting-v4
 * (20261112173841_switch_posting_terms_v4.sql), which takes every plan off
 * sale, and that update, a copy published as the next version of the same plan
 * code, as a later catalogue update would. For checks that still buy a plan
 * after later updates (quote it with planQuoteSql). */
export function planOnSale(q, planId) {
  if (
    q(
      `select count(*) from private.plan_versions where id='${planId}' and is_public and retired_at is null;`
    ) === "1"
  )
    return planId;
  const slot = q(`select coalesce((select s.id::text from private.plan_versions s
      join private.plan_versions p on p.id='${planId}' and p.duration_days=s.duration_days
    where s.plan_code in ('individual_30d','individual_90d','individual_180d') and s.is_public
      and s.retired_at is null order by s.version desc limit 1),'');`);
  if (slot) return slot;
  return q(`insert into private.plan_versions (plan_code, version, area, label, price_cents, currency, duration_days,
      slot_capacity, activations_per_period, activation_period_days, max_photos, max_videos, addon_capabilities)
    select p.plan_code, (select max(x.version)+1 from private.plan_versions x where x.plan_code=p.plan_code), p.area,
      p.label, p.price_cents, p.currency, p.duration_days, p.slot_capacity, p.activations_per_period,
      p.activation_period_days, p.max_photos, p.max_videos, p.addon_capabilities
    from private.plan_versions p where p.id='${planId}' returning id;`).split("\n")[0];
}

/** The member's quote for one slot of plan `planId`, as the website makes it:
 * with api.start_slot_checkout (the cooling-off consent, the shown total) once
 * 20261113002421_individual_slots_r69.sql is applied, for a member whose ID
 * review is accepted (slotBuyer gives `owner` one); before it with
 * api.start_checkout. */
export function planQuoteSql(q, member, owner, planId) {
  const slots =
    q(
      "select to_regprocedure('api.start_slot_checkout(uuid,integer,bigint,boolean)') is not null;"
    ) === "t";
  if (!slots) return member(owner, `select api.start_checkout('${planId}',null);`);
  slotBuyer(q, owner.id);
  const price = q(`select price_cents from private.plan_versions where id='${planId}';`);
  return member(owner, `select api.start_slot_checkout('${planId}',1,${price},true);`);
}

/** Gives `ownerId` an accepted ID review for the slot checkout: a synthetic
 * identity fingerprint answered by a stand-in internal.current_verified_identity
 * that keeps the installed body for everyone else (identity review has its own
 * suites). Installed once per database, only by checks that buy a slot. */
function slotBuyer(q, ownerId) {
  if (q("select to_regclass('vmtest_slots.buyers') is null;") === "t") {
    const installed = q(
      "select prosrc from pg_proc where oid='internal.current_verified_identity(uuid)'::regprocedure;"
    )
      .trim()
      .replace(/;\s*$/, "");
    q(`create schema vmtest_slots;
      create table vmtest_slots.buyers(owner_id uuid primary key, fingerprint text not null);
      create or replace function internal.current_verified_identity(p_owner uuid) returns text
        language sql set search_path to 'pg_catalog' as $fn$
        select coalesce((select b.fingerprint from vmtest_slots.buyers b where b.owner_id=p_owner
            and exists(select 1 from private.current_account_access a where a.id=p_owner)),
          (${installed})) $fn$;`);
  }
  q(`insert into vmtest_slots.buyers(owner_id,fingerprint) values('${ownerId}',
      left(translate(encode(sha256(convert_to('slot-buyer-${ownerId}','UTF8')),'base64'),'+/=','-_'),42)||'A')
    on conflict do nothing;`);
}
