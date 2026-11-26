#!/usr/bin/env node
// Behaviour checks for 20261126001811_staff_access_follow_ups.sql (launch
// checklist item 56, batch F): an owner admin invitation added for a person
// who already has a verified authenticator app makes them an admin; every
// claim takes the per-person lock first, so a claim racing a ban waits for it
// and then refuses; and the service-only api.close_account_evidence refuses an
// account with an active staff role.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of the staff payment checks (members and
// staff written directly as the database owner, invitations added as the
// owner's SQL session would). The script shows that before the update an
// invitation added after the authenticator app was never claimed and the
// service command closed a staff account; checks the read-only preflight, a
// drifted body and a premature rollback; applies the update (which claims
// nothing itself) and proves apply -> rollback -> apply; then checks the new
// invitation trigger, the unchanged authenticator-app path and its refusals,
// the lock, and the closure refusal.
//
//   node --import tsx scripts/test-foundation-staff-access-follow-ups.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { assertReadOnlyPreflight } from "./lib/foundation-sql-checks.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  functionBodyMd5,
  psqlSessions,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261126001811_staff_access_follow_ups.sql";
const CLAIM = "internal.claim_owner_admin_invitation()";
const CLOSE = "internal.close_account_evidence(uuid)";
const BODIES = {
  [CLAIM]: ["9b58d1999a5babe02f2ab051cb79bcce", "aad6e9487ca76eba953086e5054fad11"],
  [CLOSE]: ["ae0f20403df41b820bad1c96d93a0be1", "1b447b3fe8805138814c3cdb0ceb6daa"],
};
const LABEL = "staff access follow-ups";
const counts = (waiting, withApp) =>
  `active admins: \\d+; admin invitations waiting: ${waiting} \\(account already has an authenticator app: ${withApp}\\); closed accounts with a staff role: 0`;
const summary = (state, waiting, withApp) =>
  new RegExp(`^${LABEL}: ${state}; ${counts(waiting, withApp)}$`);
const ANY = "\\d+";

const SETUP = { update: UPDATE, label: "staffaccess", title: "Staff access follow-ups" };
await runTwoAdminUpdateCheck(SETUP, async (run) => {
  const { database, check, kit, world } = run;
  const { q, json, fails, service, preflight } = kit;
  const { session, sessionAfter } = psqlSessions(database);
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
  const assertBodies = (index) => {
    for (const [signature, md5s] of Object.entries(BODIES))
      assert.equal(bodyMd5(signature), md5s[index], signature);
  };
  const role = (who) =>
    q(
      `select coalesce((select role from private.staff_roles where user_id='${who.id}' and revoked_at is null),'member');`
    );
  const addApp = (who, status = "verified") =>
    q(
      `insert into auth.mfa_factors(user_id,factor_type,status) values('${who.id}','totp','${status}');`
    );
  const invite = (who) =>
    q(`insert into private.owner_admin_invitations(email) values(lower('${who.email}'));`);
  const reinvite = (who) =>
    q(`delete from private.owner_admin_invitations where email=lower('${who.email}');
      insert into private.owner_admin_invitations(email) values(lower('${who.email}'));`);
  const claimedBy = (who) =>
    q(
      `select coalesce(claimed_by::text,'unclaimed') from private.owner_admin_invitations where email=lower('${who.email}');`
    );
  const closeSql = (who) =>
    service(`select api.close_account_evidence('${who.id}')->>'closed_at' is not null;`);

  // ------------------------------------------------------------ before
  const early = world.user("staffaccess-early");
  await check(
    "before the update: an invitation added after the authenticator app is never claimed",
    () => {
      assertBodies(0);
      addApp(early);
      invite(early);
      assert.equal(role(early), "member");
      assert.equal(claimedBy(early), "unclaimed");
    }
  );
  await check("before the update: the service command closes a staff account", () => {
    const governor = world.staffUser("staffaccess-old-governor", "governor");
    assert.equal(q(closeSql(governor)), "t");
    // Put the test world back: that account is closed and keeps its role.
    q(
      `update private.staff_roles set revoked_at=now(),revoked_by='${run.admin.id}' where user_id='${governor.id}';`
    );
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"]
    );
    assert.match(rows[0][1], summary("update not applied", 1, 1));
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a premature rollback and a drifted body are refused", () => {
    assertDriftRefused(kit, { label: LABEL, signatures: [CLAIM, CLOSE], rows: 2 });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: LABEL,
    applied: summary("already applied", ANY, ANY),
    notApplied: summary("update not applied", ANY, ANY),
  });

  // ------------------------------------------------------------- after
  await check("the update claims nothing itself; adding the invitation again does", () => {
    assertBodies(1);
    assert.equal(role(early), "member");
    assert.match(preflight()[0][1], summary("already applied", 1, 1));
    reinvite(early);
    assert.equal(role(early), "admin");
    assert.equal(claimedBy(early), early.id);
    assert.match(preflight()[0][1], summary("already applied", 0, 0));
  });

  await check(
    "an invitation for a person with an authenticator app makes them an admin at once",
    () => {
      const person = world.user("staffaccess-has-app");
      addApp(person);
      invite(person);
      assert.equal(role(person), "admin");
      assert.equal(claimedBy(person), person.id);
    }
  );

  await check("without an authenticator app the invitation waits; a new app claims it", () => {
    const person = world.user("staffaccess-new-app");
    addApp(person, "unverified");
    invite(person);
    assert.equal(role(person), "member");
    assert.equal(claimedBy(person), "unclaimed");
    q(`update auth.mfa_factors set status='verified' where user_id='${person.id}';`);
    assert.equal(role(person), "admin");
    const later = world.user("staffaccess-later-app");
    invite(later);
    assert.equal(role(later), "member");
    addApp(later);
    assert.equal(role(later), "admin");
    assert.equal(claimedBy(later), later.id);
  });

  await check(
    "a banned account, an earlier role and another account's sign-up are never claimed",
    () => {
      const banned = world.user("staffaccess-banned");
      addApp(banned);
      q(`update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
      invite(banned);
      assert.equal(role(banned), "member");
      assert.equal(claimedBy(banned), "unclaimed");

      const former = world.staffUser("staffaccess-former", "moderator");
      q(
        `update private.staff_roles set revoked_at=now(),revoked_by='${run.admin.id}' where user_id='${former.id}';`
      );
      invite(former);
      assert.equal(role(former), "member");
      assert.equal(claimedBy(former), "unclaimed");

      const person = world.user("staffaccess-signed-up-elsewhere");
      const other = world.user("staffaccess-other");
      addApp(person);
      q(`insert into private.owner_admin_invitations(email,signed_up_at,signed_up_by)
      values(lower('${person.email}'),now(),'${other.id}');`);
      assert.equal(role(person), "member");
      assert.equal(claimedBy(person), "unclaimed");
      // A revoked invitation added later claims nothing either.
      const revoked = world.user("staffaccess-revoked");
      addApp(revoked);
      q(
        `insert into private.owner_admin_invitations(email,revoked_at) values(lower('${revoked.email}'),now());`
      );
      assert.equal(role(revoked), "member");
    }
  );

  // A ban that holds the person's lock for 3 seconds, and `sql` started 0.8 s
  // later in another session; returns when `sql` finished (ms after the start).
  const raceBan = async (person, sql) => {
    const started = Date.now();
    const [ban, other] = await Promise.all([
      session(`begin;
        select internal.lock_evidence_subject('${person.id}');
        select pg_sleep(3);
        update auth.users set banned_until=now()+interval '100 years' where id='${person.id}';
        commit;`),
      sessionAfter(800, sql).then((result) => ({ ...result, at: Date.now() - started })),
    ]);
    assert.equal(ban.status, 0, ban.stderr);
    assert.equal(other.status, 0, other.stderr);
    return other.at;
  };

  await check("a claim waits for a ban holding the per-person lock, then refuses", async () => {
    const person = world.user("staffaccess-race");
    addApp(person);
    const at = await raceBan(
      person,
      `insert into private.owner_admin_invitations(email) values(lower('${person.email}'));`
    );
    assert.ok(at >= 2500, `the invitation waited for the lock (${at} ms)`);
    assert.equal(role(person), "member");
    assert.equal(claimedBy(person), "unclaimed");
    // The authenticator-app path waits for the same lock.
    const second = world.user("staffaccess-race-app");
    invite(second);
    const appAt = await raceBan(
      second,
      `insert into auth.mfa_factors(user_id,factor_type,status) values('${second.id}','totp','verified');`
    );
    assert.ok(appAt >= 2500, `the authenticator app waited for the lock (${appAt} ms)`);
    assert.equal(role(second), "member");
    assert.equal(claimedBy(second), "unclaimed");
  });

  await check("the service command refuses a staff account and still closes a member", () => {
    const governor = world.staffUser("staffaccess-governor", "governor");
    fails(closeSql(governor), "PT409", /end the staff roles of this account first/);
    fails(closeSql(run.admin), "PT409", /staff_account/);
    assert.equal(
      q(
        `select count(*) from private.account_closures where user_id in('${governor.id}','${run.admin.id}');`
      ),
      "0"
    );
    const member = world.user("staffaccess-closing");
    assert.equal(q(closeSql(member)), "t");
    // Once the role has ended, the account closes.
    q(
      `update private.staff_roles set revoked_at=now(),revoked_by='${run.admin.id}' where user_id='${governor.id}';`
    );
    assert.equal(q(closeSql(governor)), "t");
    // Still service only; the new functions are executable by no API role.
    const grants =
      json(`select jsonb_build_object('service',has_function_privilege('service_role','api.close_account_evidence(uuid)','execute'),
        'anon',has_function_privilege('anon','api.close_account_evidence(uuid)','execute'),
        'authenticated',has_function_privilege('authenticated','api.close_account_evidence(uuid)','execute'),
        'helper',has_function_privilege('service_role','internal.claim_owner_admin_invitation_for(uuid)','execute'),
        'trigger',has_function_privilege('authenticated','internal.claim_new_owner_admin_invitation()','execute'));`);
    assert.deepEqual(grants, {
      service: true,
      anon: false,
      authenticated: false,
      helper: false,
      trigger: false,
    });
  });
});
