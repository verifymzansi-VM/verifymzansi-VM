#!/usr/bin/env node
// Behaviour checks for 20261117064820_ban_blocks_phone_numbers.sql: a ban also
// blocks every phone number the banned person verified (while the proof is
// still on record), except one another person now holds; a blocked number gets
// no code (PT409 phone_banned, before a challenge is stored) and a code sent
// before the ban is refused at the last step; the numbers are released when the
// ban is lifted and once its 5 years have passed, and are never readable by an
// API role.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Phone proofs are made through the production service commands (create,
// claim, finalize) as the website's server does; no SMS is sent. Bans are
// recorded through internal.record_identity_ban, as an approved account
// restriction does; the restriction case, its decision, the accepted identity
// and earlier (revoked) phone proofs are written directly as the database
// owner. The script runs the update's read-only preflight, checks its
// refusals, applies it, checks the rules, and proves apply -> rollback ->
// apply returns the same fingerprints. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-ban-blocks-phone-numbers.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { phoneChecks } from "./lib/foundation-phone-checks.mjs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  executeGrants,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261117064820_ban_blocks_phone_numbers.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const CREATE = "internal.create_verification_phone_challenge(uuid,text,text)";
const FINALIZE = "internal.finalize_verification_phone(uuid,uuid,text)";
const BANNED = "internal.phone_number_banned(text)";
const TRIGGER_FN = "internal.ban_identity_phone_numbers()";
// The banned person's current number and an older one they verified before.
const CURRENT = "+27720000001";
const OLDER = "+27720000002";
// A number the banned person once had that someone else now holds.
const RECYCLED = "+27720000003";
// A number a second banned person once had, used for the last-step check.
const LATE = "+27720000004";
const FREE = "+27720000005";

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  fails,
  service,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  // ------------------------------------------------------- synthetic world
  const {
    createSql,
    create,
    finalizeSql,
    prove,
    refusedWith: refused,
    challengeCount,
  } = phoneChecks({ q, json, fails, service });
  const asOwner = (sql) =>
    q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
  const fingerprintOf = (label) =>
    `${createHash("sha256").update(`person-${label}`).digest("base64url").slice(0, 42)}A`;
  const reviewer = syntheticMember("ban-reviewer");
  const approver = syntheticMember("ban-approver");
  /** An accepted identity for `owner`, written directly. */
  const accept = (owner, label) =>
    asOwner(`insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by)
      values('${owner.id}',gen_random_uuid(),'${fingerprintOf(label)}','${reviewer.id}');`);
  /** An earlier, revoked proof of `phone` for `owner`, written directly. */
  const formerly = (owner, phone) =>
    asOwner(`insert into private.verification_phone_proofs(owner_id,challenge_id,phone,verified_at,contact_changed_at,revoked_at)
      values('${owner.id}',gen_random_uuid(),'${phone}',now()-interval '60 days',now()-interval '60 days',now()-interval '20 days');`);
  /** An approved account restriction of `owner`; returns its decision id. */
  const restriction = (owner) => {
    const [caseId, decision] = [randomUUID(), randomUUID()];
    asOwner(`insert into private.evidence_cases(id,subject_id,kind,status) values('${caseId}','${owner.id}','restriction','decided');
      insert into private.decisions(id,case_id,action,payload,case_version,reviewed_snapshot,proposed_by,proposed_at,
          approved_by,approved_at,status,scope_kind)
        values('${decision}','${caseId}','restrict_account','{}'::jsonb,1,'[]'::jsonb,'${reviewer.id}',now(),
          '${approver.id}',now(),'approved','native');`);
    return decision;
  };
  /** Records the ban as an approved restriction does (triggers fire). */
  const ban = (decision, label) =>
    q(`select internal.record_identity_ban('${decision}','${fingerprintOf(label)}','fraud');`);
  /** The numbers a person's ban blocks (only after the update). */
  const blocked = (label) =>
    json(
      `select coalesce(jsonb_agg(phone order by phone),'[]') from private.banned_phone_numbers
        where identity_hmac='${fingerprintOf(label)}';`
    );

  // The banned person: an account with an accepted identity, a current number
  // and an older one, and an older number someone else now holds.
  const bannedAccount = syntheticMember("ban-person");
  prove(bannedAccount, CURRENT);
  accept(bannedAccount, "ban-person");
  formerly(bannedAccount, OLDER);
  formerly(bannedAccount, RECYCLED);
  const innocent = syntheticMember("ban-innocent");
  prove(innocent, RECYCLED);
  const banDecision = restriction(bannedAccount);
  ban(banDecision, "ban-person");
  // The same person, back on a new account before the ID step.
  const returning = syntheticMember("ban-returning");

  // ------------------------------------------------------------ before
  await check("before the update: a banned person's older number gets a code", () => {
    assert.equal(bodyMd5(CREATE), "6bd315ea00157c1caf6655ed17a079be");
    assert.ok(create(returning, OLDER).challenge_id);
    // The current number is refused only because the banned account holds it.
    refused(createSql(returning, CURRENT), "phone_in_use");
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "ban blocks phone numbers: update not applied; running bans: 1; numbers to block: 2"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    for (const sig of [CREATE, FINALIZE]) {
      const live = q(`select pg_get_functiondef('${sig}'::regprocedure);`);
      q(
        `do $$begin execute replace(pg_get_functiondef('${sig}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
      );
      const rows = preflight();
      assert.equal(rows.length, 2, JSON.stringify(rows));
      assert.match(rows[0][1], /unexpected state/);
      assert.ok(rows[1][1].startsWith(`${sig} is not the reviewed body`), rows[1][1]);
      assert.match(fails(step.sql, "55000"), /phone ban drift/);
      q(`${live};`);
    }
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  const grants = executeGrants(json, [CREATE, FINALIZE]);
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "ban blocks phone numbers",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^ban blocks phone numbers: already applied; running bans: 1; numbers blocked: 2; numbers to block: 2$/,
  });

  await check("a ban recorded before the update blocks the person's numbers", () => {
    assert.deepEqual(blocked("ban-person"), [CURRENT, OLDER]);
  });
  await check("a banned person's numbers get no code, and no challenge is stored", () => {
    const stored = challengeCount(returning);
    refused(createSql(returning, OLDER), "phone_banned");
    // Blocked comes before 'in use': nobody learns which account holds it.
    refused(createSql(returning, CURRENT), "phone_banned");
    assert.equal(challengeCount(returning), stored, "no challenge row");
    assert.ok(create(returning, FREE).challenge_id, "a free number still gets a code");
  });
  await check("a recycled number someone else holds is not blocked", () => {
    assert.ok(!blocked("ban-person").includes(RECYCLED));
    refused(createSql(returning, RECYCLED), "phone_in_use");
  });
  await check("a ban recorded after the update blocks at once, also a code already sent", () => {
    const member = syntheticMember("ban-late-member");
    const sent = create(member, LATE);
    const second = syntheticMember("ban-second");
    accept(second, "ban-second");
    formerly(second, LATE);
    ban(restriction(second), "ban-second");
    assert.deepEqual(blocked("ban-second"), [LATE]);
    // The code was sent before the ban: the last step still refuses it.
    refused(finalizeSql(member, sent), "phone_banned");
    assert.equal(
      q(
        `select count(*) from private.verification_phone_proofs where phone='${LATE}' and revoked_at is null;`
      ),
      "0"
    );
    refused(createSql(member, LATE), "phone_banned");
  });
  await check("a replacement decision keeps the numbers; lifting the ban releases them", () => {
    const replacement = restriction(bannedAccount);
    q(
      `update private.banned_identities set decision_id='${replacement}' where identity_hmac='${fingerprintOf("ban-person")}';`
    );
    refused(createSql(returning, OLDER), "phone_banned");
    // Lifting deletes the ban's row, as internal.lift_frontend_account_restriction does.
    q(
      `delete from private.banned_identities where identity_hmac='${fingerprintOf("ban-person")}';`
    );
    assert.deepEqual(blocked("ban-person"), []);
    assert.ok(create(returning, OLDER).challenge_id);
  });
  await check(
    "a ban whose 5 years have passed blocks nothing, and the purge removes its numbers",
    () => {
      q(`update private.banned_identities set banned_at=now()-interval '5 years 1 day',retain_until=now()-interval '1 day'
        where identity_hmac='${fingerprintOf("ban-second")}';`);
      const member = syntheticMember("ban-after-expiry");
      assert.ok(create(member, LATE).challenge_id);
      q(`select internal.purge_expired_identity_bans(100);`);
      assert.deepEqual(blocked("ban-second"), []);
    }
  );
  await check("no API role can read the list or run the helpers", () => {
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        q(
          `select has_table_privilege('${role}','private.banned_phone_numbers','select,insert,update,delete');`
        ),
        "f",
        role
      );
    const none = { anon: false, authenticated: false, service_role: false };
    assert.deepEqual(executeGrants(json, [BANNED, TRIGGER_FN]), {
      [BANNED]: none,
      [TRIGGER_FN]: none,
    });
    assert.deepEqual(executeGrants(json, [CREATE, FINALIZE]), grants);
    assert.equal(
      q(`select relrowsecurity from pg_class where oid='private.banned_phone_numbers'::regclass;`),
      "t"
    );
  });
  await check("account and number validation still come first", () => {
    const stranger = { id: "00000000-0000-4000-8000-0000000000aa" };
    fails(createSql(stranger, FREE), "42501", /active subject required/);
    fails(createSql(returning, "+2772"), "22023", /valid phone challenge required/);
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep blocking a banned person's numbers", () => {
      const person = syntheticMember("ban-later");
      accept(person, "ban-later");
      formerly(person, "+27720000009");
      ban(restriction(person), "ban-later");
      refused(createSql(syntheticMember("ban-later-new"), "+27720000009"), "phone_banned");
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Ban blocks phone numbers checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
