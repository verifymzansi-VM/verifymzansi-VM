#!/usr/bin/env node
// Behaviour checks for 20261125212548_email_alert_follow_ups.sql: follow-ups
// to the lost-email alert and the staff deadline emails (launch checklist item
// 56, batch B).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members and staff have synthetic sessions; privacy requests go through
// the production command as `service_role`; appeals, the decisions they appeal
// against, reports and lost queue rows are written as the database owner, as
// if their own flows had run. The email job claims through
// api.claim_lost_email_alert as `service_role`. No email is sent.
//
// It checks the read-only preflight (a lost email counted only once its lease
// has ended) and the update's refusals, applies the update, proves apply ->
// rollback -> apply returns the same fingerprints, then:
// - a sent alert is deleted 400 days after sending on every claim, also while
//   nothing is lost;
// - an alert counts every lost payment email (payments), listed or not, and
//   an alert offered again returns the same count; one made before the update
//   returns null;
// - staff without a verified authenticator app are not emailed, and the email
//   job's check skips them;
// - an appeal is not emailed to whoever took, approved or reported the
//   decision appealed against;
// - LIM-F-queue_staff_deadline_emails: a privacy request is always emailed,
//   outside the cap; appeals and reports keep the cap of 30 in 24 hours,
//   counting only themselves;
// - at repeatable read or serializable an appeal or report queues no email; a
//   privacy request still does;
// - who may run the functions is unchanged; the rollback keeps queued emails
//   and alerts.
// Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-email-alert-follow-ups.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertReadOnlyPreflight, executeGrants } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  functionBodyMd5,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261125212548_email_alert_follow_ups.sql";
const CLAIM = "internal.claim_lost_email_alert(integer)";
const DUE = "internal.staff_email_due(text,uuid,uuid)";
const QUEUE = "internal.queue_staff_deadline_emails()";
const REVIEWED = {
  [CLAIM]: "25fee44314e2556ef9bea1f44e05c9bc",
  [DUE]: "33aed641726695e14ea1f64c4b0ba2eb",
  [QUEUE]: "69ea078b94ffc5d1116dcfbd63e50744",
};
const UPDATED = {
  [CLAIM]: "174244d1d29cb28747f23b7a72c9b22e",
  [DUE]: "81cdbb19b32d10b7e0edb1a9b8b82ba3",
  [QUEUE]: "9dc8c0a562a998d41bec910dc740e717",
};
const LABEL = "email alert follow-ups";
// One lost email (lease ended) and one at its 8th attempt still in its lease.
const SUMMARY =
  "lost emails: 1; alerts sent over 400 days ago: 0; staff without an authenticator app: 0; staff emails queued today: 0 / 0";
const NOT_APPLIED = new RegExp(`^${LABEL}: update not applied; ${SUMMARY}$`);
const ALREADY_APPLIED = new RegExp(`^${LABEL}: already applied; ${SUMMARY}$`);
const SERVICE_ONLY = { anon: false, authenticated: false, service_role: true };
const NO_API_ROLE = { anon: false, authenticated: false, service_role: false };
const NOTHING = { claim: null, total: 0, items: [] };

await runTwoAdminUpdateCheck(
  { update: UPDATE, label: "eaf", title: "Email alert follow-ups" },
  async ({ database, check, kit, world, admin, admin2 }) => {
    const { q, json, fails, service, steps, index, preflight } = kit;
    const replica = (sql) =>
      q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
    const member = (label) => world.user(label);
    const bodies = (expected) => {
      for (const [signature, md5] of Object.entries(expected))
        assert.equal(functionBodyMd5(kit, signature), md5, signature);
    };
    /** A day has passed: earlier staff emails no longer count towards the cap. */
    const newDay = () =>
      replica(`update private.outbox_events set created_at=created_at-interval '25 hours'
        where kind like 'staff\\_%';`);

    /** A queued email of `kind` (owner `owner`) as the email job left it; its id. */
    const queued = (owner, { kind = "enquiry_received", attempts = 8, lease = null } = {}) =>
      q(`insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key,delivery_attempts,delivery_until,
          delivery_error)
        values('${kind}',gen_random_uuid(),'${owner.id}','vmtest:'||gen_random_uuid(),${attempts},
          ${lease ? `now()+interval '${lease}'` : "null"},'delivery_failed') returning id;`);
    const claimAlert = (limit = 50) =>
      json(service(`select api.claim_lost_email_alert(${limit});`));
    const completeAlert = (token, sent) =>
      q(service(`select api.complete_lost_email_alert('${token}',${sent});`));
    /** Alerts no longer block a new one (none being sent, none sent recently). */
    const alertsAged = () =>
      q(
        `update private.lost_email_alerts set sent_at=sent_at-interval '16 minutes' where sent_at is not null;`
      );

    /** A member's privacy request through the production command; its id. */
    const privacyRequest = (person, type = "access") =>
      json(
        service(`select api.record_frontend_privacy_request('${person.id}','${person.session}','${type}',
          'Thandi Member',null,null);`)
      ).id;
    /** An appeal by `person` against `action` (none of the stored decisions by default); its id. */
    const appeal = (person, action = randomUUID(), kind = "suspension") =>
      q(`insert into private.frontend_appeals(action_id,appellant_id,kind,reason)
        values('${action}','${person.id}','${kind}','A synthetic appeal reason that is long enough.')
        returning id;`);
    const reportSql = (subject, id = randomUUID()) =>
      `insert into private.reports(id,subject_account_id,category,description,reporter_ip_hmac)
        values('${id}','${subject.id}','scam','A synthetic report description.',
          '${"C".repeat(42)}'||floor(random()*10)::text);`;
    const report = (subject) => {
      const id = randomUUID();
      q(reportSql(subject, id));
      return id;
    };
    /** Owners of the staff emails queued about `item`, sorted. */
    const staffEmails = (item) =>
      json(`select coalesce(jsonb_agg(owner_id order by owner_id),'[]') from private.outbox_events
        where subject_id='${item}' and kind like 'staff\\_%';`);
    const owners = (...people) => people.map((p) => p.id).sort();
    const due = (kind, item, person) =>
      q(`select internal.staff_email_due('${kind}','${item}','${person.id}');`);
    /** Fills today's appeal and report cap with 30 synthetic rows of `kind`. */
    const filler = (kind, rows = 30) =>
      q(`insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
        select '${kind}',gen_random_uuid(),'${admin.id}','vmtest-cap:'||gen_random_uuid()
        from generate_series(1,${rows});`);

    // ------------------------------------------------------------ before
    const early = member("eaf-early");
    const earlyLost = queued(early);
    const trying = queued(early, { lease: "30 minutes" });
    await check(
      "before the update: the reviewed bodies, and the preflight reads not applied",
      () => {
        bodies(REVIEWED);
        const rows = preflight();
        assert.deepEqual(
          rows.map((r) => r[0]),
          ["summary"],
          JSON.stringify(rows)
        );
        assert.match(rows[0][1], NOT_APPLIED);
        assertReadOnlyPreflight(database, kit.preflightSql);
        assert.equal(
          q(
            "select count(*) from information_schema.columns where table_name='lost_email_alerts' and column_name='payments';"
          ),
          "0"
        );
      }
    );
    await check("drift and a premature rollback are refused", () =>
      assertDriftRefused(kit, { label: LABEL, signatures: [CLAIM, DUE, QUEUE], rows: 2 })
    );
    const grants = executeGrants(json, [CLAIM, DUE, QUEUE]);
    await applyAndProveRollback(kit, database, check, {
      label: LABEL,
      applied: ALREADY_APPLIED,
      notApplied: NOT_APPLIED,
    });
    await check("after the update: the bodies are the update's", () => bodies(UPDATED));
    // Only the rows made below are lost.
    q(`delete from private.outbox_events where id in('${earlyLost}','${trying}');`);

    // The staff: two admins (from the world), a governor and a moderator.
    const governor = world.staffUser("eaf-governor", "governor");
    const moderator = world.staffUser("eaf-moderator", "moderator");

    // ------------------------------------------------------------ the alert
    await check(
      "a sent alert is deleted 400 days after sending, also while nothing is lost",
      () => {
        const old = randomUUID();
        const kept = randomUUID();
        q(`insert into private.lost_email_alerts(id,created_at,claimed_until,items,total,sent_at) values
        ('${old}',now()-interval '402 days',now()-interval '402 days','[]',1,now()-interval '401 days'),
        ('${kept}',now()-interval '400 days',now()-interval '400 days','[]',1,now()-interval '399 days');`);
        assert.match(preflight()[0][1], /alerts sent over 400 days ago: 1;/);
        assert.deepEqual(claimAlert(), NOTHING);
        assert.equal(
          json(
            `select coalesce(jsonb_agg(id order by id),'[]') from private.lost_email_alerts;`
          ).join(),
          kept
        );
        assert.match(preflight()[0][1], /alerts sent over 400 days ago: 0;/);
      }
    );

    await check("an alert counts every lost payment email, listed or not", () => {
      const sipho = member("eaf-sipho");
      for (const kind of [
        "enquiry_received",
        "payment_completed",
        "payment_reversed",
        "payment_completed",
      ])
        queued(sipho, { kind });
      queued(sipho, { kind: "payment_completed", attempts: 7 });
      const alert = claimAlert(2);
      assert.equal(alert.total, 4);
      assert.equal(alert.payments, 3);
      assert.equal(alert.items.length, 2);
      assert.equal(
        q(`select payments from private.lost_email_alerts where id='${alert.claim}';`),
        "3"
      );
      // Given back: offered again with the same count.
      assert.equal(completeAlert(alert.claim, false), "t");
      assert.deepEqual(claimAlert(2), alert);
      assert.equal(completeAlert(alert.claim, true), "t");
      // No payment among the lost: 0.
      alertsAged();
      queued(sipho);
      const none = claimAlert();
      assert.equal(none.total, 1);
      assert.equal(none.payments, 0);
      completeAlert(none.claim, true);
      // The check: never more than the total.
      fails(
        `update private.lost_email_alerts set payments=total+1 where id='${none.claim}';`,
        "23514",
        /lost_email_alerts_payments_check/
      );
    });

    await check("an alert made before the update is offered again without a count", () => {
      alertsAged();
      const id = randomUUID();
      q(`insert into private.lost_email_alerts(id,created_at,claimed_until,items,total)
        values('${id}',now()-interval '1 hour',now()-interval '1 minute','[]',2);`);
      assert.deepEqual(claimAlert(), { claim: id, total: 2, payments: null, items: [] });
      completeAlert(id, true);
      alertsAged();
    });

    // ------------------------------------------------------------ staff emails
    await check("staff without a verified authenticator app get no deadline email", () => {
      newDay();
      const noApp = world.staffUser("eaf-no-app", "governor");
      q(`delete from auth.mfa_factors where user_id='${noApp.id}';`);
      const unverified = world.staffUser("eaf-unverified", "governor");
      q(`update auth.mfa_factors set status='unverified' where user_id='${unverified.id}';`);
      assert.match(preflight()[0][1], /staff without an authenticator app: 2;/);
      const item = appeal(member("eaf-zola"));
      assert.deepEqual(staffEmails(item), owners(admin, admin2, governor));
      const request = privacyRequest(member("eaf-lerato"));
      assert.deepEqual(staffEmails(request), owners(admin, admin2, governor));
      // The email job's check skips a staff member who lost theirs since.
      assert.equal(due("staff_appeal", item, governor), "t");
      q(`update auth.mfa_factors set status='unverified' where user_id='${governor.id}';`);
      assert.equal(due("staff_appeal", item, governor), "f");
      assert.equal(due("staff_privacy_request", request, governor), "f");
      q(`update auth.mfa_factors set status='verified' where user_id='${governor.id}';`);
      assert.equal(due("staff_appeal", item, governor), "t");
      q(`update private.staff_roles set revoked_at=now(),revoked_by='${admin.id}'
        where user_id in('${noApp.id}','${unverified.id}') and revoked_at is null;`);
    });

    await check(
      "an appeal is not emailed to whoever took, approved or reported the decision",
      () => {
        newDay();
        // A content hold applied by an admin on a governor's report.
        const nandi = member("eaf-nandi");
        const hold = randomUUID();
        replica(`insert into private.frontend_content_holds(id,account_id,actor_id,reporter_id,reason,applied_at)
        values('${hold}','${nandi.id}','${admin.id}','${governor.id}','A synthetic hold reason.',now());`);
        const onHold = appeal(nandi, hold, "content_hidden");
        assert.deepEqual(staffEmails(onHold), [admin2.id]);
        assert.equal(due("staff_appeal", onHold, admin), "f");
        assert.equal(due("staff_appeal", onHold, governor), "f");
        assert.equal(due("staff_appeal", onHold, admin2), "t");
        // A suspension proposed by one admin and approved by the other.
        const thabo = member("eaf-thabo");
        const decision = randomUUID();
        replica(`insert into private.decisions(id,case_id,action,payload,case_version,reviewed_snapshot,proposed_by,
          approved_by,approved_at,status)
        values('${decision}',gen_random_uuid(),'restrict_account','{}',1,'[]','${admin2.id}','${admin.id}',now(),'approved');
        insert into private.frontend_account_restrictions(decision_id,account_id,kind,reason,emergency,starts_at,ends_at)
        values('${decision}','${thabo.id}','suspension','A synthetic suspension reason.',false,now(),now()+interval '7 days');`);
        const onSuspension = appeal(thabo, decision);
        assert.deepEqual(staffEmails(onSuspension), [governor.id]);
        assert.equal(due("staff_appeal", onSuspension, admin), "f");
        assert.equal(due("staff_appeal", onSuspension, admin2), "f");
        assert.equal(due("staff_appeal", onSuspension, governor), "t");
      }
    );

    await check(
      "LIM-F-queue_staff_deadline_emails: privacy requests are always emailed, outside the cap of 30",
      () => {
        newDay();
        filler("staff_report");
        // Appeals and reports: the cap is full.
        assert.deepEqual(staffEmails(appeal(member("eaf-capped"))), []);
        assert.deepEqual(staffEmails(report(member("eaf-capped-shop"))), []);
        // A privacy request still reaches every staff member with dsar:manage.
        assert.deepEqual(
          staffEmails(privacyRequest(member("eaf-request"))),
          owners(admin, admin2, governor)
        );
        // Privacy request emails do not use up the cap.
        newDay();
        filler("staff_privacy_request");
        filler("staff_report", 29);
        assert.equal(staffEmails(report(member("eaf-room-shop"))).length, 1);
        assert.deepEqual(staffEmails(appeal(member("eaf-full"))), []);
        assert.match(preflight()[0][1], /staff emails queued today: 30 \/ 30$/);
      }
    );

    await check(
      "at a stricter isolation level an appeal or report queues none; a request still does",
      () => {
        newDay();
        const shop = member("eaf-strict-shop");
        const reported = randomUUID();
        q(`begin isolation level repeatable read;\n${reportSql(shop, reported)}\ncommit;`);
        assert.deepEqual(staffEmails(reported), []);
        const appellant = member("eaf-strict-appeal");
        q(`begin isolation level serializable;
        insert into private.frontend_appeals(action_id,appellant_id,kind,reason)
        values(gen_random_uuid(),'${appellant.id}','suspension','A synthetic appeal reason that is long enough.');
        commit;`);
        const strictAppeal = q(
          `select id from private.frontend_appeals where appellant_id='${appellant.id}';`
        );
        assert.deepEqual(staffEmails(strictAppeal), []);
        const requester = member("eaf-strict-request");
        q(`begin isolation level repeatable read;
        ${service(`select api.record_frontend_privacy_request('${requester.id}','${requester.session}','access',
          'Thandi Member',null,null);`)}
        commit;`);
        const request = q(
          `select id from private.privacy_requests where subject_user_id='${requester.id}';`
        );
        assert.deepEqual(staffEmails(request), owners(admin, admin2, governor));
        // At read committed the same report is emailed.
        assert.deepEqual(staffEmails(report(shop)), owners(admin, admin2, governor, moderator));
      }
    );

    await check("who may run them is unchanged", () => {
      assert.deepEqual(executeGrants(json, [CLAIM, DUE, QUEUE]), grants);
      assert.deepEqual(grants, { [CLAIM]: SERVICE_ONLY, [DUE]: NO_API_ROLE, [QUEUE]: NO_API_ROLE });
      assert.equal(
        q(`select relrowsecurity and not has_table_privilege('service_role','private.lost_email_alerts','select')
          from pg_class where oid='private.lost_email_alerts'::regclass;`),
        "t"
      );
    });

    await check("the rollback keeps queued emails and alerts, and drops the count", () => {
      const applied = kit.fingerprint();
      queued(member("eaf-rollback"), { kind: "payment_completed" });
      const unsent = claimAlert();
      assert.equal(unsent.payments, 1);
      const alerts = q("select count(*) from private.lost_email_alerts;");
      const emails = q("select count(*) from private.outbox_events;");
      applySteps(database, [{ label: `${LABEL} rollback`, sql: kit.rollbackSql }]);
      bodies(REVIEWED);
      assert.equal(q("select count(*) from private.lost_email_alerts;"), alerts);
      assert.equal(q("select count(*) from private.outbox_events;"), emails);
      // The earlier claim offers the unsent alert again, without a count.
      q(`update private.lost_email_alerts set claimed_until=now() where id='${unsent.claim}';`);
      const again = claimAlert();
      assert.equal(again.claim, unsent.claim);
      assert.equal(again.payments, undefined);
      applySteps(database, [kit.step]);
      assert.equal(kit.fingerprint(), applied, "re-applying gives the same schema");
      completeAlert(unsent.claim, true);
    });

    const later = steps.slice(index + 1);
    if (later.length) {
      applySteps(database, later);
      await check("later updates keep the follow-ups", () => {
        newDay();
        filler("staff_report");
        assert.deepEqual(
          staffEmails(privacyRequest(member("eaf-later"))),
          owners(admin, admin2, governor)
        );
        alertsAged();
        queued(member("eaf-later-lost"), { kind: "payment_completed" });
        assert.equal(claimAlert().payments, 1);
      });
    }
  }
);
