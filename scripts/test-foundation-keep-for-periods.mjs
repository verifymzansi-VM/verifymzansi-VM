#!/usr/bin/env node
// Behaviour checks for 20261126053631_keep_for_periods.sql (launch checklist
// item 51): keep-for periods for the newer personal-data tables, payment
// records kept 7 years and privacy request proofs 3 years.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of the staff payment checks. Records are
// written as their flows write them (as the database owner, triggers off where
// a flow's side effects are not under test), dated in the past; the retention
// sweep runs through the production command api.run_retention as
// `service_role`, as the website's retention job runs it.
//
// It shows that before the update a return kept on a closed account's case
// fails the whole sweep, checks the read-only preflight, drifted bodies and a
// premature rollback, applies the update and proves apply -> rollback ->
// apply, then checks each period: a record just past it is deleted, one just
// inside it (or still open, in force, or held) is kept; payment records go 7
// years after the tax year, not 5; the slot limit guard still refuses any other
// delete; the sweep's counts; who may run it is unchanged. Any later updates
// are applied at the end.
//
//   node --import tsx scripts/test-foundation-keep-for-periods.mjs
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

const UPDATE = "20261126053631_keep_for_periods.sql";
const BODIES = {
  "internal.retention_tax_year_due(timestamp with time zone)": [
    "330c487132c054e1995261d5e92871b2",
    "e9e2b8fd093f12e0363d0fadf760ffec",
  ],
  "internal.retention_privacy_requests(integer)": [
    "ae00ab54c00fd3f6f64ac6b8061ba929",
    "daec57205cdb25a6d30b767ecec59ffd",
  ],
  "internal.retention_operations(integer)": [
    "c435cece42784f1bcf61a3b47ea32944",
    "a76b7c5b983c43c687d0abf47965f6f6",
  ],
  "internal.retention_staff_records(integer)": [
    "63218a3ffaab86d4ead4788f13ed5103",
    "94c034a1b8e5812a357fca776bc0f2a8",
  ],
  "internal.retention_verification(integer)": [
    "6a7db601e6af1cfcc55f697f7d841dd2",
    "56e4f71f0ad4ecb994e79ea9b0d695b8",
  ],
  "internal.individual_slot_limit_guard()": [
    "556e2de64a5eb7ca998744fa0abb5c84",
    "9a7d826f695d7e18d815b122d6c5afd2",
  ],
};
const ZEROS =
  "contact messages: 0; admin invitations: 0; change logs: 0; appeals and holds: 0; role changes: 0; claim events: 0; slot limits: 0; ID return reasons: 0; privacy request proofs: 0";
const NOT_APPLIED = new RegExp(`^keep-for periods: update not applied; ${ZEROS}$`);
const APPLIED = new RegExp(`^keep-for periods: already applied; ${ZEROS}$`);

const SETUP = { update: UPDATE, label: "keep", title: "Keep-for periods" };
await runTwoAdminUpdateCheck(SETUP, async (run) => {
  const { database, check, kit, world, admin, admin2 } = run;
  const { q, json, fails, service, preflight } = kit;
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
  /** Runs `sql` as the database owner with triggers off (the flows' side effects are not under test). */
  const asOwner = (sql) =>
    q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
  const sweepSql = () => service("select api.run_retention(500);");
  const sweep = () => json(sweepSql());
  const exists = (table, where) =>
    q(`select count(*) from private.${table} where ${where};`) === "1";
  const ago = (interval) => `now()-interval '${interval}'`;
  /** A kyc evidence case of `owner`; its id. */
  const kycCase = (owner) => {
    const id = randomUUID();
    asOwner(
      `insert into private.evidence_cases(id,subject_id,kind,status) values('${id}','${owner.id}','kyc','decided');`
    );
    return id;
  };
  /** A reason for returning an ID on `caseId`, `interval` ago; its id. */
  const returned = (caseId, interval) => {
    const id = randomUUID();
    asOwner(`insert into private.verification_return_requests(id,case_id,case_version,reason,reviewer_id,created_at)
      values('${id}','${caseId}',1,'The photo of the ID was blurred.','${admin.id}',${ago(interval)});`);
    return id;
  };
  /** A member whose account closed 6 years ago with every file deleted (due for the five-year sweep). */
  const closedLongAgo = (label) => {
    const m = world.verified(label, admin);
    const caseId = kycCase(m);
    asOwner(`insert into private.account_closures(user_id,closed_at,evidence_delete_after)
      values('${m.id}',${ago("6 years")},${ago("6 years")}+interval '90 days');`);
    return { member: m, caseId };
  };

  // ------------------------------------------------------------ before
  await check("before the update: a return kept on a closed account's case fails the sweep", () => {
    for (const [signature, [reviewed]] of Object.entries(BODIES))
      assert.equal(bodyMd5(signature), reviewed, signature);
    const { member, caseId } = closedLongAgo("keep-before");
    returned(caseId, "1 day");
    fails(sweepSql(), "23503", /verification_return_requests/);
    // Nothing changed: the whole run rolled back.
    assert.ok(exists("evidence_cases", `id='${caseId}'`));
    assert.ok(exists("accepted_identity_facts", `owner_id='${member.id}'`));
    // Leave the sweep runnable for the rest of the checks.
    asOwner(`delete from private.verification_return_requests where case_id='${caseId}';
      delete from private.account_closures where user_id='${member.id}';`);
    // Payment records went 5 years after the tax year.
    assert.equal(
      q(`select internal.retention_tax_year_due(${ago("6 years 11 months")})::text;`),
      "true"
    );
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"]
    );
    assert.match(rows[0][1], NOT_APPLIED);
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a premature rollback and drifted bodies are refused", () => {
    assertDriftRefused(kit, {
      label: "keep-for periods",
      signatures: Object.keys(BODIES),
      rows: 2,
    });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "keep-for periods",
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  // ------------------------------------------------------------- after
  await check("the update's bodies are installed", () => {
    for (const [signature, [, updated]] of Object.entries(BODIES))
      assert.equal(bodyMd5(signature), updated, signature);
  });

  await check("payment records: 7 years after the end of the tax year, not 5", () => {
    const due = (interval) => q(`select internal.retention_tax_year_due(${ago(interval)})::text;`);
    assert.equal(due("6 years 11 months"), "false");
    assert.equal(due("7 years"), "false");
    assert.equal(due("8 years 1 day"), "true");
    // The end of February closes a tax year: a payment on 28 February 2019 is
    // due on 1 March 2026, one on 1 March 2020 on 1 March 2028.
    assert.equal(
      q(`select internal.retention_tax_year_due(make_timestamptz(2019,2,28,12,0,0,'Africa/Johannesburg'))::text
        ||':'||internal.retention_tax_year_due(make_timestamptz(2020,3,1,12,0,0,'Africa/Johannesburg'))::text;`),
      "true:false"
    );
    const payer = world.user("keep-payer");
    const payment = (interval) => {
      const id = randomUUID();
      asOwner(`insert into private.payments(id,owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status,created_at,status_changed_at)
        select '${id}','${payer.id}','plan',id,100,'ZAR','{}','failed',${ago(interval)},${ago(interval)}
        from private.plan_versions order by id limit 1;`);
      return id;
    };
    const sevenYearsOld = payment("7 years");
    const nineYearsOld = payment("9 years");
    sweep();
    assert.ok(exists("payments", `id='${sevenYearsOld}'`), "kept: inside 7 tax years");
    assert.ok(!exists("payments", `id='${nineYearsOld}'`), "deleted: past 7 tax years");
  });

  await check("privacy request proofs: 3 years after the request closed", () => {
    const request = (interval) => {
      const id = randomUUID();
      asOwner(`insert into private.privacy_requests(id,type,requester_email,requester_phone,description,identity_check,
          status,received_at,due_by,legal_basis,completed_at,minimised_at)
        select '${id}',r.request_type,'removed','not_provided','Removed after the request was closed.','manual',
          'completed',${ago(interval)},${ago(interval)}+interval '30 days','POPIA s23',${ago(interval)},${ago(interval)}
        from private.privacy_request_rules r order by r.request_type limit 1;`);
      return id;
    };
    const kept = request("2 years 11 months");
    const gone = request("3 years 1 day");
    const result = sweep();
    assert.ok(result.privacy_requests.purged >= 1, JSON.stringify(result.privacy_requests));
    assert.ok(exists("privacy_requests", `id='${kept}'`));
    assert.ok(!exists("privacy_requests", `id='${gone}'`));
  });

  await check("contact messages: 12 months after they were resolved; open ones stay", () => {
    const ticket = (status, created, resolvedEvents) => {
      const id = randomUUID();
      asOwner(`insert into private.support_tickets(id,name,email,category,message,status,revision,created_at)
        values('${id}','Thandi Dube','thandi@example.invalid','general_support','A question about my post.','${status}',
          ${resolvedEvents.length + 1},${ago(created)});
        ${resolvedEvents
          .map(
            (
              [eventStatus, when],
              i
            ) => `insert into private.support_ticket_events(ticket_id,revision,actor_id,status,created_at)
          values('${id}',${i + 2},'${admin.id}','${eventStatus}',${ago(when)});`
          )
          .join("\n")}`);
      return id;
    };
    const resolvedLongAgo = ticket("resolved", "2 years", [["resolved", "12 months 1 day"]]);
    const resolvedNoEvent = ticket("resolved", "12 months 1 day", []);
    // Received 2 years ago but reopened and resolved again 11 months ago.
    const resolvedRecently = ticket("resolved", "2 years", [
      ["resolved", "18 months"],
      ["in_progress", "12 months"],
      ["resolved", "11 months"],
    ]);
    const open = ticket("new", "3 years", []);
    const inProgress = ticket("in_progress", "3 years", [["in_progress", "3 years"]]);
    const result = sweep();
    assert.equal(result.operations.support_tickets, 2, JSON.stringify(result.operations));
    assert.ok(!exists("support_tickets", `id='${resolvedLongAgo}'`));
    assert.equal(
      q(`select count(*) from private.support_ticket_events where ticket_id='${resolvedLongAgo}';`),
      "0"
    );
    assert.ok(!exists("support_tickets", `id='${resolvedNoEvent}'`));
    for (const id of [resolvedRecently, open, inProgress])
      assert.ok(exists("support_tickets", `id='${id}'`), id);
  });

  await check(
    "owner admin invitations: 12 months after revocation or the claimant's erasure",
    () => {
      const invite = (email, fields) =>
        asOwner(`insert into private.owner_admin_invitations(email,created_at${Object.keys(fields)
          .map((k) => `,${k}`)
          .join("")})
        values('${email}',${ago("3 years")}${Object.values(fields)
          .map((v) => `,${v}`)
          .join("")});`);
      const erasedClaimant = world.user("keep-erased-admin");
      const erasedRecently = world.user("keep-erased-recent");
      const erasure = (who, interval) =>
        asOwner(`insert into private.account_erasures(user_id,closed_at,erase_after,closed_by,erased_at,erased_by,erased_counts)
        values('${who.id}',${ago(interval)}-interval '30 days',${ago(interval)},'member',${ago(interval)},'sweep','{}');`);
      erasure(erasedClaimant, "12 months 1 day");
      erasure(erasedRecently, "11 months");
      invite("revoked-old@example.invalid", { revoked_at: ago("12 months 1 day") });
      invite("revoked-new@example.invalid", { revoked_at: ago("11 months") });
      invite("open@example.invalid", {});
      invite("claimed-erased@example.invalid", {
        claimed_by: `'${erasedClaimant.id}'`,
        claimed_at: ago("2 years"),
      });
      invite("claimed-erased-recent@example.invalid", {
        claimed_by: `'${erasedRecently.id}'`,
        claimed_at: ago("2 years"),
      });
      invite("claimed-admin@example.invalid", {
        claimed_by: `'${admin2.id}'`,
        claimed_at: ago("2 years"),
      });
      const result = sweep();
      assert.equal(result.operations.owner_admin_invitations, 2, JSON.stringify(result.operations));
      const left = json(
        `select coalesce(jsonb_agg(email order by email),'[]') from private.owner_admin_invitations where email like '%@example.invalid';`
      );
      assert.deepEqual(left, [
        "claimed-admin@example.invalid",
        "claimed-erased-recent@example.invalid",
        "open@example.invalid",
        "revoked-new@example.invalid",
      ]);
    }
  );

  await check("runtime switch and sign-up mode change logs: 5 years", () => {
    const flag = q(`select id from private.frontend_feature_flags order by key limit 1;`);
    assert.match(flag, /^[0-9a-f-]{36}$/);
    const flagEvent = (revision, interval) => {
      const id = randomUUID();
      asOwner(`insert into private.frontend_feature_flag_events(id,flag_id,actor_id,revision,mode,rollout_percent,allowlist_roles,reason,created_at)
        values('${id}','${flag}','${admin.id}',${revision},'off',0,'{}','A reason.',${ago(interval)});`);
      return id;
    };
    const modeEvent = (interval) => {
      const id = randomUUID();
      asOwner(`insert into private.signup_mode_events(id,from_mode,to_mode,changed_by,reason,changed_at)
        values('${id}','invite_only','open','${admin.id}','Opening up.',${ago(interval)});`);
      return id;
    };
    const oldFlag = flagEvent(9001, "5 years 1 day");
    const newFlag = flagEvent(9002, "4 years 11 months");
    const oldMode = modeEvent("5 years 1 day");
    const newMode = modeEvent("4 years 11 months");
    const result = sweep();
    assert.equal(result.operations.feature_flag_events, 1, JSON.stringify(result.operations));
    assert.equal(result.operations.signup_mode_events, 1, JSON.stringify(result.operations));
    assert.ok(!exists("frontend_feature_flag_events", `id='${oldFlag}'`));
    assert.ok(exists("frontend_feature_flag_events", `id='${newFlag}'`));
    assert.ok(!exists("signup_mode_events", `id='${oldMode}'`));
    assert.ok(exists("signup_mode_events", `id='${newMode}'`));
    // Outside the sweep the log stays append-only.
    fails(`delete from private.signup_mode_events where id='${newMode}';`, "23514", /append-only/);
  });

  await check("appeals and content holds: 2 years after the decision or release", () => {
    const member = world.user("keep-appellant");
    const banned = world.user("keep-banned");
    const appeal = (who, status, resolvedInterval, action = randomUUID(), kind = "warning") => {
      const id = randomUUID();
      const resolved = resolvedInterval ? ago(resolvedInterval) : "null";
      asOwner(`insert into private.frontend_appeals(id,action_id,appellant_id,kind,reason,status,created_at,reviewer_id,reviewer_rationale,resolved_at)
        values('${id}','${action}','${who.id}','${kind}','I did not break the rules in this post.','${status}',${ago("3 years")},
          ${resolvedInterval ? `'${admin.id}','Checked the post again.'` : "null,null"},${resolved});`);
      return id;
    };
    const hold = (releasedInterval) => {
      const id = randomUUID();
      asOwner(`insert into private.frontend_content_holds(id,account_id,actor_id,reason,applied_at,released_at,released_by,release_reason)
        values('${id}','${member.id}','${admin.id}','Reported as misleading.',${ago("3 years")},
          ${releasedInterval ? `${ago(releasedInterval)},'${admin.id}','Fixed by the owner.'` : "null,null,null"});`);
      return id;
    };
    /** An approved report ban of `who`, 3 years old; the decision's id (the appealable action). */
    const ban = (who) => {
      const caseId = randomUUID();
      const decision = randomUUID();
      asOwner(`insert into private.evidence_cases(id,subject_id,kind,status) values('${caseId}','${who.id}','restriction','decided');
        insert into private.decisions(id,case_id,action,payload,case_version,reviewed_snapshot,proposed_by,proposed_at,approved_by,approved_at,status,scope_kind)
          values('${decision}','${caseId}','restrict_account','{}',1,'[]','${admin.id}',${ago("3 years")},'${admin2.id}',${ago("3 years")},'approved','report_ban');
        insert into private.frontend_account_restrictions(decision_id,account_id,kind,reason,emergency,starts_at)
          values('${decision}','${who.id}','ban','Repeated scam posts.',false,${ago("3 years")});`);
      return decision;
    };
    // The decision appealed is gone: deleted 2 years after its decision.
    const oldAppeal = appeal(member, "dismissed", "2 years 1 day");
    const newAppeal = appeal(member, "upheld", "1 year 11 months");
    const openAppeal = appeal(member, "submitted", null);
    // The decision appealed still stands: kept, however old.
    const activeHold = hold(null);
    const onActiveHold = appeal(member, "dismissed", "2 years 1 day", activeHold, "content_hidden");
    const onBan = appeal(banned, "upheld", "2 years 1 day", ban(banned), "ban");
    const oldHold = hold("2 years 1 day");
    const newHold = hold("1 year 11 months");
    // A released hold an appeal still waits on is kept with it.
    const awaitedHold = hold("2 years 1 day");
    const awaiting = appeal(member, "submitted", null, awaitedHold, "content_hidden");
    const result = sweep();
    assert.equal(result.staff_records.appeals, 1, JSON.stringify(result.staff_records));
    assert.equal(result.staff_records.content_holds, 1, JSON.stringify(result.staff_records));
    assert.ok(!exists("frontend_appeals", `id='${oldAppeal}'`));
    for (const id of [newAppeal, openAppeal, onActiveHold, onBan, awaiting])
      assert.ok(exists("frontend_appeals", `id='${id}'`), id);
    assert.ok(!exists("frontend_content_holds", `id='${oldHold}'`));
    for (const id of [newHold, activeHold, awaitedHold])
      assert.ok(exists("frontend_content_holds", `id='${id}'`), id);
    // A second appeal against the standing decision is still refused.
    const second = kit.member(
      member,
      `select api.submit_my_frontend_appeal('${activeHold}','This hide is still wrong, please look at it again.');`
    );
    fails(second, "PT409", /decision already appealed/);
    // Once the waiting appeal is decided and 2 years pass, both go (the
    // appeal at the sweep after its hold).
    asOwner(`update private.frontend_appeals set status='dismissed',reviewer_id='${admin.id}',
        reviewer_rationale='Checked the post again.',resolved_at=${ago("2 years 1 day")} where id='${awaiting}';`);
    sweep();
    assert.ok(!exists("frontend_content_holds", `id='${awaitedHold}'`));
    sweep();
    assert.ok(!exists("frontend_appeals", `id='${awaiting}'`));
  });

  await check(
    "staff role changes 5 years after the decision or expiry; claim events 2 years",
    () => {
      const target = world.user("keep-role-target");
      const change = (status, decidedInterval, expiresInterval) => {
        const id = randomUUID();
        asOwner(`insert into private.frontend_staff_role_changes(id,target_id,from_role,to_role,proposer_id,reviewer_id,reason,status,created_at,expires_at,decided_at)
        values('${id}','${target.id}','member','moderator','${admin.id}',${decidedInterval ? `'${admin2.id}'` : "null"},
          'Helps with the queue.','${status}',${ago("7 years")},${ago(expiresInterval)},${decidedInterval ? ago(decidedInterval) : "null"});`);
        return id;
      };
      const oldDecided = change("applied", "5 years 1 day", "5 years");
      const oldExpired = change("proposed", null, "5 years 1 day");
      const newDecided = change("rejected", "4 years 11 months", "4 years 10 months");
      const caseId = kycCase(target);
      const claim = (reason, interval) => {
        q(`insert into private.frontend_evidence_claim_events(case_id,actor_id,from_staff,event,claim_generation,reason,created_at)
        values('${caseId}','${admin.id}','${admin2.id}','released_by_staff',1,'${reason}',${ago(interval)});`);
        return q(
          `select id from private.frontend_evidence_claim_events where case_id='${caseId}' and reason='${reason}';`
        );
      };
      const oldClaim = claim("Shift ended long ago.", "2 years 1 day");
      const newClaim = claim("Shift ended last year.", "1 year 11 months");
      const result = sweep();
      assert.equal(
        result.staff_records.staff_role_changes,
        2,
        JSON.stringify(result.staff_records)
      );
      assert.equal(
        result.staff_records.evidence_claim_events,
        1,
        JSON.stringify(result.staff_records)
      );
      assert.ok(!exists("frontend_staff_role_changes", `id='${oldDecided}'`));
      assert.ok(!exists("frontend_staff_role_changes", `id='${oldExpired}'`));
      assert.ok(exists("frontend_staff_role_changes", `id='${newDecided}'`));
      assert.ok(!exists("frontend_evidence_claim_events", `id=${oldClaim}`));
      assert.ok(exists("frontend_evidence_claim_events", `id=${newClaim}`));
    }
  );

  await check("raised slot limits: 2 years after they ended; any other delete is refused", () => {
    const limit = (label, granted, ends, revoked) => {
      const id = randomUUID();
      q(`insert into private.individual_slot_limits(id,identity_hmac,slot_limit,ends_at,reason,granted_by,granted_at,revoked_at,revoked_by,revoke_reason)
        values('${id}','${fingerprintOf(label)}',8,${ago(ends)},'Busy season.','${admin.id}',${ago(granted)},
          ${revoked ? `${ago(revoked)},'${admin.id}','Season over.'` : "null,null,null"});`);
      return id;
    };
    const ended = limit("keep-limit-ended", "3 years", "2 years 1 day", null);
    const revoked = limit("keep-limit-revoked", "2 years 6 months", "2 years", "2 years 1 day");
    const recent = limit("keep-limit-recent", "2 years 6 months", "1 year 11 months", null);
    const result = sweep();
    assert.equal(result.staff_records.slot_limits, 2, JSON.stringify(result.staff_records));
    assert.ok(!exists("individual_slot_limits", `id='${ended}'`));
    assert.ok(!exists("individual_slot_limits", `id='${revoked}'`));
    assert.ok(exists("individual_slot_limits", `id='${recent}'`));
    fails(
      `delete from private.individual_slot_limits where id='${recent}';`,
      "23514",
      /slot limit history is retained/
    );
  });

  await check("ID return reasons: 12 months unless a legal or fraud hold keeps them", () => {
    const plain = world.user("keep-return-plain");
    const legal = world.user("keep-return-legal");
    const fraud = world.user("keep-return-fraud");
    const plainCase = kycCase(plain);
    const legalCase = kycCase(legal);
    const fraudCase = kycCase(fraud);
    const oldPlain = returned(plainCase, "12 months 1 day");
    const newPlain = returned(plainCase, "11 months");
    const oldLegal = returned(legalCase, "2 years");
    const oldFraud = returned(fraudCase, "2 years");
    asOwner(`insert into private.legal_holds(subject_id,reason,placed_by) values('${legal.id}','Court order pending.','${admin.id}');
      insert into private.evidence_fraud_holds(case_id,reason,placed_by) values('${fraudCase}','Possible stolen ID.','${admin.id}');`);
    const result = sweep();
    assert.equal(result.verification.return_reasons, 1, JSON.stringify(result.verification));
    assert.ok(!exists("verification_return_requests", `id='${oldPlain}'`));
    for (const id of [newPlain, oldLegal, oldFraud])
      assert.ok(exists("verification_return_requests", `id='${id}'`), id);
    // A released hold lets the next sweep delete it.
    asOwner(
      `update private.legal_holds set released_at=now(),released_by='${admin.id}' where subject_id='${legal.id}';`
    );
    sweep();
    assert.ok(!exists("verification_return_requests", `id='${oldLegal}'`));
    assert.ok(exists("verification_return_requests", `id='${oldFraud}'`));
  });

  await check("the five-year sweep deletes a closed account's history with its returns", () => {
    const { member, caseId } = closedLongAgo("keep-after");
    const recent = returned(caseId, "1 day");
    const result = sweep();
    assert.ok(
      result.verification.closed_account_verification_histories >= 1,
      JSON.stringify(result.verification)
    );
    assert.ok(!exists("verification_return_requests", `id='${recent}'`));
    assert.ok(!exists("evidence_cases", `id='${caseId}'`));
    assert.ok(!exists("accepted_identity_facts", `owner_id='${member.id}'`));
  });

  await check("who may run the sweep is unchanged", () => {
    const member = world.user("keep-caller");
    fails(kit.member(member, "select api.run_retention(10);"), "42501");
    for (const signature of Object.keys(BODIES))
      for (const role of ["anon", "authenticated", "service_role"])
        assert.equal(
          q(`select has_function_privilege('${role}','${signature}','execute');`),
          "f",
          `${role} ${signature}`
        );
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the keep-for periods", () => {
      assert.equal(
        q(`select internal.retention_tax_year_due(${ago("6 years 11 months")})::text;`),
        "false"
      );
    });
  }
});
