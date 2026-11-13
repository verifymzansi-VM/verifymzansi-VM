// Shared synthetic world for the staff payment behaviour checks
// (scripts/test-foundation-staff-payment-fixes.mjs and
// scripts/test-foundation-staff-invoice-payments.mjs) on the throwaway SQL lint
// container: an update's companions and read-only views, members and staff
// written directly as the database owner, a second psql session for races, and
// the apply -> rollback -> apply check. Nothing here can reach a hosted database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { applyStepsBefore, sqlHelpers } from "./foundation-sql-checks.mjs";
import { applySteps } from "./foundation-sql-lint.mjs";

/** The Individual slots on sale since 20261113002421_individual_slots_r69.sql. */
export const P30 = { id: "d6ca48e5-43be-40df-8d8c-72c98a6fda96", cents: 6900 };
export const P180 = { id: "ce4ef578-344a-4816-ab6a-6961bec46621", cents: 41400 };
export const sha = (text) => createHash("sha256").update(text).digest("hex");
/** A synthetic identity fingerprint for a label. */
export const fingerprintOf = (label) =>
  `${createHash("sha256").update(`person-${label}`).digest("base64url").slice(0, 42)}A`;

/**
 * Replays every update before `update` into `database` and returns the SQL
 * helpers with the update's step, its preflight and rollback companions, the
 * schema fingerprint and the preflight result as rows of [kind, detail].
 */
export function updateCheckKit(database, update, current) {
  const companion = (folder, suffix) =>
    readFileSync(`database/foundation/${folder}/${update.replace(/\.sql$/, suffix)}`, "utf8");
  const preflightSql = companion("preflight", ".check.sql");
  const rollbackSql = companion("rollback", ".down.sql");
  const fingerprintSql = readFileSync("database/foundation/fingerprint.sql", "utf8");
  const replay = applyStepsBefore(database, update);
  const helpers = sqlHelpers(database, current);
  const { q } = helpers;
  return {
    ...replay,
    ...helpers,
    preflightSql,
    rollbackSql,
    asRole: (role, sql) => `set role ${role};\n${sql}`,
    fingerprint: () => q(`set search_path to pg_catalog;\n${fingerprintSql}`),
    preflight: () =>
      q(preflightSql)
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("|")),
    count: (sql) => Number(q(`select count(*) from ${sql};`)),
  };
}

/**
 * Creates schema vmtest: members (an Auth user with a live session; returns
 * id, session and email), staff (AAL2 session, verified authenticator app, a
 * role), accepted and ended identity reviews, posts, and the stand-in for
 * internal.current_verified_identity (the member's current accepted fact).
 */
export function createPaymentWorld({ q, json }) {
  q(`create schema vmtest;
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); mail text; begin
      mail:=p_label||'-'||uid||'@example.invalid';
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,mail,now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid,'email',mail);
    end$$;
    create function vmtest.staff(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role);
      return m;
    end$$;
    create function vmtest.verified(p_owner uuid,p_staff uuid,p_fp text) returns void language plpgsql as $$
    begin
      perform set_config('session_replication_role','replica',true);
      insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by)
        values(p_owner,gen_random_uuid(),p_fp,p_staff);
      insert into private.verification_phone_proofs(owner_id,challenge_id,phone)
        values(p_owner,gen_random_uuid(),'+2782'||lpad((abs(hashtext(p_owner::text))%10000000)::text,7,'0'));
      insert into private.verification_localities(owner_id,province_id,city_id) values(p_owner,'gp','gp_johannesburg');
      perform set_config('session_replication_role','origin',true);
    end$$;
    -- An ended accepted review: the account was once reviewed as that person.
    create function vmtest.past_identity(p_owner uuid,p_staff uuid,p_fp text) returns void language plpgsql as $$
    begin
      perform set_config('session_replication_role','replica',true);
      insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by,revoked_at)
        values(p_owner,gen_random_uuid(),p_fp,p_staff,now());
      perform set_config('session_replication_role','origin',true);
    end$$;
    create function vmtest.post(p_owner uuid,p_kind text,p_area text) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cat text; begin
      select c.category_key into cat from private.post_category_contracts c
        where c.kind=p_kind and c.area=p_area order by c.category_key limit 1;
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
        values(pid,p_owner,p_kind,p_area,cat,(select a.key from private.category_activities a join private.categories c on c.key=a.category_key
          where a.category_key=cat and c.activity_required order by a.key limit 1),
          'Fixture '||p_kind||' '||left(pid::text,8),'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      if p_kind='listing' then insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
      elsif p_kind='business' then insert into private.business_details(post_id) values(pid); end if;
      return pid;
    end$$;
    create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path to 'pg_catalog' as $fn$
      select f.identity_hmac from private.accepted_identity_facts f where f.owner_id=p_owner and f.revoked_at is null
        and exists(select 1 from private.current_account_access a where a.id=p_owner) $fn$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const staffUser = (label, role) => json(`select vmtest.staff('${label}','${role}');`);
  return {
    user,
    staffUser,
    /** A member with an accepted ID review, reviewed by `reviewer`. */
    verified: (label, reviewer) => {
      const m = user(label);
      m.fingerprint = fingerprintOf(label);
      q(`select vmtest.verified('${m.id}','${reviewer.id}','${m.fingerprint}');`);
      return m;
    },
    review: (person, reviewer, label) =>
      q(`select vmtest.verified('${person.id}','${reviewer.id}','${fingerprintOf(label)}');`),
    pastIdentity: (person, reviewer, fingerprint) =>
      q(`select vmtest.past_identity('${person.id}','${reviewer.id}','${fingerprint}');`),
    post: (owner, kind, area) => q(`select vmtest.post('${owner.id}','${kind}','${area}');`),
  };
}

/** A separate psql session in the container (for races), and one started after a delay. */
export function psqlSessions(database) {
  const session = (sql) =>
    new Promise((resolve) => {
      const child = spawn(
        "docker",
        [
          "exec",
          "-i",
          database.name,
          "psql",
          "-X",
          "-q",
          "-A",
          "-t",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "postgres",
        ],
        { windowsHide: true }
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(`\\set VERBOSITY verbose\n${sql}`);
    });
  const sessionAfter = (ms, sql) =>
    new Promise((resolve) => setTimeout(resolve, ms)).then(() => session(sql));
  return { session, sessionAfter };
}

/**
 * Applies the update, then checks (as the named check "apply, roll back and
 * apply again are clean") that it changed the schema, that the preflight is
 * one summary row matching `applied`, and that the rollback and two re-applies
 * return the fingerprint to the same values.
 */
export async function applyAndProveRollback(kit, database, check, { label, applied, notApplied }) {
  const before = kit.fingerprint();
  applySteps(database, [kit.step]);
  const after = kit.fingerprint();
  await check("apply, roll back and apply again are clean", () => {
    assert.notEqual(after, before);
    assert.deepEqual(
      kit.preflight().map((r) => r[0]),
      ["summary"]
    );
    assert.match(kit.preflight()[0][1], applied);
    assertRollbackAndReapply(kit, database, { before, after, label, notApplied });
  });
  return { before, after };
}

/**
 * Rolls the update back (the schema returns to `before`, `notApplied` matches
 * the preflight summary), applies it again and once more (both `after`).
 */
function assertRollbackAndReapply(kit, database, { before, after, label, notApplied }) {
  applySteps(database, [{ label: `${label} rollback`, sql: kit.rollbackSql }]);
  assert.equal(kit.fingerprint(), before, "the rollback leaves the pre-update schema");
  assert.match(kit.preflight()[0][1], notApplied);
  applySteps(database, [kit.step]);
  assert.equal(kit.fingerprint(), after, "re-applying gives the same schema");
  applySteps(database, [kit.step]);
  assert.equal(kit.fingerprint(), after, "a repeated run changes nothing");
}
