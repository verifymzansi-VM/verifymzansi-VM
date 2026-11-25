#!/usr/bin/env node
// Behaviour checks for 20261125150338_admin_removal_needs_approval.sql (launch
// checklist item 20): one admin cannot remove another admin without a second
// admin's approval, and an appeal is decided by a reviewer who took no part in
// the decision.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of the staff payment checks (members and
// staff written directly as the database owner, accepted ID reviews as
// synthetic identity facts, members and staff acting through the production
// API commands with synthetic sessions). The script checks the read-only
// preflight, a drifted body and a premature rollback, shows that before the
// update an admin's removal of another admin applied at once, applies the
// update and proves apply -> rollback -> apply, then checks: lowering an
// admin is only a proposal; neither the proposer nor the admin it is about
// can approve it; a different admin's approval applies it; with only two
// admins it waits and expires; the proposer may withdraw it; a moderator or
// governor is still lowered at once. Then a member's ban, proposed by one
// admin and approved by a second, is appealed: both are refused as reviewers
// and a third admin overturns it, which lifts the ban and frees the person's
// ID and phone number.
//
//   node --import tsx scripts/test-foundation-admin-removal-needs-approval.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertReadOnlyPreflight } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  fingerprintOf,
  functionBodyMd5,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261125150338_admin_removal_needs_approval.sql";
const PROPOSE = "internal.propose_frontend_staff_role(text,text,text)";
const REVIEWED = "d40ad40b7afce00a05ebf599a2953d25";
const UPDATED = "e6d446d2702768234f979cdcaa20f281";
const LABEL = "admin removal needs approval";
const SUMMARY = (state) =>
  new RegExp(
    `^${LABEL}: ${state}; active admins: \\d+; role changes waiting: \\d+ \\(admin removals: \\d+\\)$`
  );
const INDEPENDENT = /independent staff role reviewer required/;

const SETUP = { update: UPDATE, label: "lockout", title: "Admin removal needs approval" };
await runTwoAdminUpdateCheck(SETUP, async (run) => {
  const { database, check, kit, world, admin, admin2 } = run;
  const { q, json, fails, member, staff, preflight } = kit;
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
  const asOwner = (sql) =>
    q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
  const role = (who) =>
    q(
      `select coalesce((select role from private.staff_roles where user_id='${who.id}' and revoked_at is null),'member');`
    );
  const proposeSql = (actor, target, to, reason = "Synthetic staff role change") =>
    staff(actor, `select api.propose_frontend_staff_role('${target.email}','${to}','${reason}');`);
  const propose = (actor, target, to) => json(proposeSql(actor, target, to));
  const reviewSql = (actor, id, action = "approve") =>
    staff(
      actor,
      `select api.review_frontend_staff_role('${id}','${action}',${action === "approve" ? 1 : "null"},null);`
    );
  const change = (id) =>
    json(`select to_jsonb(c) from private.frontend_staff_role_changes c where c.id='${id}';`);
  // A third admin with an accepted ID review.
  const admin3 = world.staffUser("lockout-admin3", "admin");
  world.review(admin3, admin, "lockout-admin3");

  // ------------------------------------------------------------ before
  await check("before the update: an admin's removal of another admin applies at once", () => {
    assert.equal(bodyMd5(PROPOSE), REVIEWED);
    const extra = world.staffUser("lockout-old-admin", "admin");
    const removed = propose(admin, extra, "member");
    assert.equal(removed.status, "applied");
    assert.equal(role(extra), "member");
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"]
    );
    assert.match(rows[0][1], SUMMARY("update not applied"));
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a premature rollback and a drifted body are refused", () => {
    assertDriftRefused(kit, { label: LABEL, signatures: [PROPOSE], rows: 2 });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: LABEL,
    applied: SUMMARY("already applied"),
    notApplied: SUMMARY("update not applied"),
  });

  // ------------------------------------------------------------- after
  await check("an admin still lowers a governor or a moderator at once", () => {
    assert.equal(bodyMd5(PROPOSE), UPDATED);
    const governor = world.staffUser("lockout-governor", "governor");
    assert.equal(propose(admin, governor, "moderator").status, "applied");
    assert.equal(role(governor), "moderator");
    assert.equal(propose(admin, governor, "member").status, "applied");
    assert.equal(role(governor), "member");
  });

  await check("lowering an admin waits for a different admin's approval", () => {
    const proposal = propose(admin, admin2, "member");
    assert.equal(proposal.status, "proposed");
    assert.equal(role(admin2), "admin");
    const row = change(proposal.id);
    assert.equal(row.direct_removal, false);
    assert.equal(row.from_role, "admin");
    // Neither the proposer nor the admin it is about can approve it.
    fails(reviewSql(admin, proposal.id), "42501", INDEPENDENT);
    fails(reviewSql(admin2, proposal.id), "42501", INDEPENDENT);
    // The admin it is about cannot reject it either; a second proposal waits.
    fails(reviewSql(admin2, proposal.id, "reject"), "42501", INDEPENDENT);
    fails(proposeSql(admin3, admin2, "governor"), "PT409", /a role change is already pending/);
    assert.equal(role(admin2), "admin");
    // A different admin approves: the removal applies.
    assert.equal(json(reviewSql(admin3, proposal.id)).status, "applied");
    assert.equal(role(admin2), "member");
    const decided = change(proposal.id);
    assert.equal(decided.status, "applied");
    assert.equal(decided.reviewer_id, admin3.id);
  });

  await check("lowering an admin to governor also needs the approval", () => {
    const proposal = propose(admin3, admin, "governor");
    assert.equal(proposal.status, "proposed");
    assert.equal(role(admin), "admin");
    // The proposer withdraws it.
    assert.equal(json(reviewSql(admin3, proposal.id, "reject")).status, "withdrawn");
    assert.equal(role(admin), "admin");
  });

  await check("with only two admins a removal waits and expires", () => {
    const proposal = propose(admin, admin3, "member");
    assert.equal(proposal.status, "proposed");
    fails(reviewSql(admin3, proposal.id), "42501", INDEPENDENT);
    fails(reviewSql(admin, proposal.id), "42501", INDEPENDENT);
    asOwner(`update private.frontend_staff_role_changes
      set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id='${proposal.id}';`);
    fails(reviewSql(admin3, proposal.id), "PT409", /changed or expired/);
    assert.equal(role(admin3), "admin");
    assert.equal(role(admin), "admin");
  });

  // ----------------------------------------------------------- appeals
  await check("a third admin decides a ban appeal; the two involved admins cannot", () => {
    // Restore a second admin: two take the decision, the third reviews it.
    const approver = world.staffUser("lockout-approver", "admin");
    world.review(approver, admin, "lockout-approver");
    const banned = world.verified("lockout-banned", admin);
    const phone = q(
      `select phone from private.verification_phone_proofs where owner_id='${banned.id}' and revoked_at is null;`
    );
    const fact = q(
      `select id from private.accepted_identity_facts where owner_id='${banned.id}' and revoked_at is null;`
    );
    const [caseId, decision] = [randomUUID(), randomUUID()];
    asOwner(`insert into private.evidence_cases(id,subject_id,kind,status) values('${caseId}','${banned.id}','restriction','decided');
      insert into private.decisions(id,case_id,action,payload,case_version,reviewed_snapshot,proposed_by,proposed_at,
          approved_by,approved_at,status,scope_kind)
        values('${decision}','${caseId}','restrict_account','{}'::jsonb,1,'[]'::jsonb,'${admin.id}',now(),
          '${approver.id}',now(),'approved','native');
      insert into private.frontend_account_restrictions(decision_id,account_id,kind,reason,emergency,starts_at)
        values('${decision}','${banned.id}','ban','Synthetic ban for an appeal check',false,now());
      insert into private.identity_ban_bindings(decision_id,fact_id,identity_hmac,category,approved_at,retain_until)
        select '${decision}','${fact}','${fingerprintOf("lockout-banned")}','fraud',d.approved_at,d.approved_at+interval '5 years'
          from private.decisions d where d.id='${decision}';`);
    q(
      `select internal.record_identity_ban('${decision}','${fingerprintOf("lockout-banned")}','fraud');`
    );
    const phoneBanned = () => q(`select internal.phone_number_banned('${phone}');`);
    assert.equal(phoneBanned(), "t");

    const reason = "I did not post the listings that were reported, please review this again.";
    const appeal = json(
      member(banned, `select api.submit_my_frontend_appeal('${decision}','${reason}');`)
    ).appeal_id;
    const resolveSql = (who) =>
      staff(
        who,
        `select api.resolve_frontend_appeal('${appeal}','overturned','Synthetic independent appeal review',1);`
      );
    // The admins who proposed and approved the ban cannot decide its appeal.
    fails(resolveSql(admin), "42501", /independent appeal reviewer required/);
    fails(resolveSql(approver), "42501", /independent appeal reviewer required/);
    // The queue tells each admin whether they may decide it.
    const canResolve = (who) =>
      json(staff(who, `select api.get_frontend_appeal_queue('${appeal}');`)).items[0].can_resolve;
    assert.equal(canResolve(admin), false);
    assert.equal(canResolve(admin3), true);

    const decided = json(resolveSql(admin3));
    assert.equal(decided.status, "overturned");
    assert.equal(decided.restrictions_changed, 1);
    const restriction = json(
      `select to_jsonb(x) from private.frontend_account_restrictions x where x.decision_id='${decision}';`
    );
    assert.ok(restriction.lifted_at);
    assert.equal(restriction.lifted_by, admin3.id);
    assert.equal(
      q(
        `select count(*) from private.banned_identities where identity_hmac='${fingerprintOf("lockout-banned")}';`
      ),
      "0"
    );
    assert.equal(phoneBanned(), "f");
    // The member sees the outcome.
    const mine = json(member(banned, "select api.get_my_frontend_decisions();")).items.find(
      (d) => d.decisionId === decision
    );
    assert.equal(mine.appeal.status, "overturned");
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the approval rule", () => {
      assert.equal(bodyMd5(PROPOSE), UPDATED);
    });
  }
});
