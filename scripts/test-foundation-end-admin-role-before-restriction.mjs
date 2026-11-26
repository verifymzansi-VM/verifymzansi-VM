#!/usr/bin/env node
// Behaviour checks for 20261125174942_end_admin_role_before_restriction.sql
// (launch checklist item 20, part 3): no account restriction (ban,
// suspension or emergency containment) for a person who holds an active admin
// role; their admin role ends first.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of the staff payment checks (members and
// staff written directly as the database owner, accepted ID reviews as
// synthetic identity facts, staff acting through the production API commands
// with synthetic sessions). The script shows that before the update two
// governors could ban an admin (api.propose_verified_identity_ban, then
// api.approve_decision), which ended the admin's staff access; checks the
// read-only preflight, a drifted body and a premature rollback; applies the
// update and proves apply -> rollback -> apply; then checks: the same identity
// ban of an admin is refused, and so are a plain restrict_account proposal, a
// moderator's report ban and a governor's emergency containment of an admin;
// an approval is refused when the person became an admin after the proposal;
// an admin whose role was first ended can then be banned; members and
// moderators can still be banned and suspended.
//
//   node --import tsx scripts/test-foundation-end-admin-role-before-restriction.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertReadOnlyPreflight } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  functionBodyMd5,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261125174942_end_admin_role_before_restriction.sql";
const BODIES = {
  "internal.propose_decision(uuid,integer,text,jsonb)": [
    "03ca62789e3072be4ad9f2674f623585",
    "14c5db672f2151a86ad769d3629df3ce",
  ],
  "internal.propose_frontend_report_restriction(uuid,integer,text,uuid,text,text,integer,boolean)":
    ["99896a347df072ba0d1aca2c86839e7b", "93ce413d7760cf1e4a4da586cf180e47"],
  "internal.approve_decision(uuid)": [
    "baf094a3e7e2985bf0962c1a8922c7cb",
    "46ede56eac0b30fae87597fa886ef604",
  ],
};
const LABEL = "end admin role before restriction";
const COUNTS =
  "active admins: \\d+; admins who cannot sign in: \\d+; restriction proposals about an admin: \\d+";
const NOT_APPLIED = new RegExp(`^${LABEL}: update not applied; ${COUNTS}$`);
const APPLIED = new RegExp(`^${LABEL}: already applied; ${COUNTS}$`);
const ADMIN = /End this person's admin role first/;

const SETUP = { update: UPDATE, label: "noadminban", title: "End admin role before restriction" };
await runTwoAdminUpdateCheck(SETUP, async (run) => {
  const { database, check, kit, world, admin, admin2 } = run;
  const { q, json, fails, staff, preflight } = kit;
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
  const assertBodies = (index) => {
    for (const [signature, md5s] of Object.entries(BODIES))
      assert.equal(bodyMd5(signature), md5s[index], signature);
  };
  const role = (who) =>
    q(
      `select coalesce((select role from private.staff_roles where user_id='${who.id}' and revoked_at is null),'member');`
    );
  const canSignIn = (who) =>
    q(`select exists(select 1 from private.current_account_access where id='${who.id}');`) === "t";
  const fact = (who) =>
    q(
      `select id from private.accepted_identity_facts where owner_id='${who.id}' and revoked_at is null;`
    );
  const makeAdmin = (who) =>
    q(`insert into private.staff_roles(user_id,role) values('${who.id}','admin');`);
  // The break tester's repro: an identity ban proposed by one governor.
  const identityBanSql = (actor, subject) =>
    staff(
      actor,
      `select api.propose_verified_identity_ban('${subject.id}','${fact(subject)}','fraud','${randomUUID()}');`
    );
  const approveSql = (actor, decision) =>
    staff(actor, `select api.approve_decision('${decision}');`);
  const identityBan = (proposer, approver, subject) => {
    const decision = json(identityBanSql(proposer, subject)).decision_id;
    assert.equal(json(approveSql(approver, decision)).status, "approved");
    return decision;
  };
  // Reports, written directly as the database owner, reviewed through the
  // production commands (claim, then the v2 report action).
  let reportNumber = 0;
  const report = (subject) =>
    q(`insert into private.reports(subject_account_id,category,description,reporter_ip_hmac)
      values('${subject.id}','scam','A synthetic report about this account.','${String(++reportNumber).padStart(43, "r")}')
      returning id;`);
  const reportRow = (id) => json(`select to_jsonb(r) from private.reports r where r.id='${id}';`);
  const reportActionSql = (who, id, action, { days = null, emergency = false } = {}) => {
    const lease = json(staff(who, `select api.claim_queue_item('report','${id}');`));
    return staff(
      who,
      `select api.execute_frontend_report_action_v2('${id}',${reportRow(id).revision},'${lease.claim_generation}','${lease.claim_nonce}','${action}','Synthetic restriction reason',${days ?? "null"},${emergency},null);`
    );
  };
  const restrictions = (who) =>
    Number(
      q(`select count(*) from private.frontend_account_restrictions where account_id='${who.id}';`)
    );

  const governor = world.staffUser("noadminban-governor", "governor");
  const governor2 = world.staffUser("noadminban-governor2", "governor");
  const moderator = world.staffUser("noadminban-moderator", "moderator");
  for (const [who, label] of [
    [governor, "noadminban-governor"],
    [governor2, "noadminban-governor2"],
    [moderator, "noadminban-moderator"],
  ])
    world.review(who, admin, label);

  // ------------------------------------------------------------ before
  await check("before the update: two governors ban an admin, who loses staff access", () => {
    assertBodies(0);
    const victim = world.staffUser("noadminban-old-admin", "admin");
    world.review(victim, admin, "noadminban-old-admin");
    identityBan(governor, governor2, victim);
    assert.equal(role(victim), "admin");
    assert.equal(canSignIn(victim), false);
    fails(staff(victim, "select api.get_my_profile();"), "42501");
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"]
    );
    assert.match(rows[0][1], NOT_APPLIED);
    assert.match(rows[0][1], /admins who cannot sign in: 1;/);
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a premature rollback and a drifted body are refused", () => {
    assertDriftRefused(kit, { label: LABEL, signatures: Object.keys(BODIES), rows: 2 });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: LABEL,
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  // ------------------------------------------------------------- after
  await check("two governors cannot ban an admin through an identity ban", () => {
    assertBodies(1);
    const refusal = fails(identityBanSql(governor, admin2), "PT409", ADMIN);
    assert.match(refusal, /subject_is_admin/);
    assert.equal(canSignIn(admin2), true);
    assert.equal(
      q(
        `select count(*) from private.identity_ban_proposal_requests where owner_id='${admin2.id}';`
      ),
      "0"
    );
  });

  await check("a plain restrict_account proposal about an admin is refused", () => {
    const caseId = q(
      `insert into private.evidence_cases(subject_id,kind) values('${admin2.id}','restriction') returning id;`
    );
    fails(
      staff(governor, `select api.propose_decision('${caseId}',1,'restrict_account','{}'::jsonb);`),
      "PT409",
      ADMIN
    );
  });

  await check("a moderator's report ban of an admin is refused", () => {
    const id = report(admin2);
    fails(reportActionSql(moderator, id, "ban"), "PT409", ADMIN);
    assert.equal(reportRow(id).status, "open");
    assert.equal(reportRow(id).active_proposal_id, null);
    assert.equal(restrictions(admin2), 0);
  });

  await check("a governor's emergency containment of an admin is refused", () => {
    const id = report(admin2);
    fails(reportActionSql(governor, id, "suspend", { days: 7, emergency: true }), "PT409", ADMIN);
    assert.equal(restrictions(admin2), 0);
    assert.equal(canSignIn(admin2), true);
  });

  await check("an approval is refused when the person became an admin after the proposal", () => {
    // An identity ban and a report ban proposed while the person was a member.
    const person = world.verified("noadminban-promoted", admin);
    const ban = json(identityBanSql(governor, person)).decision_id;
    const id = report(person);
    const reportBan = json(reportActionSql(moderator, id, "ban")).decision_id;
    makeAdmin(person);
    fails(approveSql(governor2, ban), "PT409", ADMIN);
    fails(approveSql(governor2, reportBan), "PT409", ADMIN);
    assert.equal(restrictions(person), 0);
    assert.equal(canSignIn(person), true);
  });

  await check("an admin whose role was ended first can then be banned", () => {
    const third = world.staffUser("noadminban-third", "admin");
    world.review(third, admin, "noadminban-third");
    const removal = json(
      staff(
        admin,
        `select api.propose_frontend_staff_role('${third.email}','member','Synthetic role ending before a ban');`
      )
    );
    // With 20261125150338_admin_removal_needs_approval.sql a different admin
    // approves the removal; before it, the removal applies at once.
    if (removal.status === "proposed")
      assert.equal(
        json(
          staff(admin2, `select api.review_frontend_staff_role('${removal.id}','approve',1,null);`)
        ).status,
        "applied"
      );
    assert.equal(role(third), "member");
    identityBan(governor, governor2, third);
    assert.equal(canSignIn(third), false);
  });

  await check("members and moderators can still be banned, suspended and contained", () => {
    const member = world.verified("noadminban-member", admin);
    identityBan(governor, governor2, member);
    assert.equal(canSignIn(member), false);

    const reported = world.verified("noadminban-reported", admin);
    const id = report(reported);
    const proposal = json(reportActionSql(moderator, id, "ban"));
    assert.equal(proposal.status, "proposed");
    assert.equal(json(approveSql(governor, proposal.decision_id)).status, "approved");
    assert.equal(canSignIn(reported), false);

    const contained = world.verified("noadminban-contained", admin);
    const urgent = report(contained);
    assert.equal(
      json(reportActionSql(governor, urgent, "suspend", { days: 7, emergency: true })).status,
      "emergency_applied"
    );
    assert.equal(canSignIn(contained), false);

    // A moderator holds no admin role, so the rule does not protect them.
    identityBan(governor, governor2, moderator);
    assert.equal(canSignIn(moderator), false);
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the rule", () => {
      assertBodies(1);
    });
  }
});
