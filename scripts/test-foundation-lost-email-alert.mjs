#!/usr/bin/env node
// Behaviour checks for 20261125105322_lost_email_alert_staff_deadlines.sql:
// the lost-email alert kept in the database and the staff deadline emails
// (launch checklist item 28).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members and staff have synthetic sessions; privacy requests go through
// the production commands (a member's request as `service_role`, a staff
// intake as staff); appeals, reports and lost queue rows are written as the
// database owner, as if their own flows had run. The email job claims through
// api.claim_supported_notification_outbox and api.claim_lost_email_alert as
// `service_role`. No email is sent.
//
// It checks the read-only preflight and the update's refusals, applies the
// update, proves apply -> rollback -> apply returns the same fingerprints,
// then:
// - LIM-F-claim_lost_email_alert-2: a queued email or privacy notice unsent
//   after its 8th attempt, with its lease ended, is lost; one alert lists the
//   oldest and counts them all; an alert given back is offered again
//   unchanged; once sent, the rows are never reported again; no new alert
//   within 15 minutes of one sent; an alert being sent blocks a second one;
// - a new privacy request, appeal and public report queue one email per staff
//   member holding dsar:manage, appeal:decide or report:resolve with a
//   confirmed address, never to whoever submitted it, never for a staff
//   duplicate-event report; LIM-F-queue_staff_deadline_emails: at most 20
//   report emails a staff member an hour;
// - the claim hands each out with its type, severity, received time and
//   deadline (2 or 3 business days, weekends skipped; a privacy request's
//   effective due date), and skips it once the staff member lost the
//   capability or the item was closed;
// - the claim takes 26 kinds; who may run each command.
// Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-lost-email-alert.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assertClaimKinds,
  checkNoticeUpdate,
  CLAIM,
} from "./lib/foundation-outbox-notice-checks.mjs";
import { executeGrants } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import { runTwoAdminUpdateCheck } from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261125105322_lost_email_alert_staff_deadlines.sql";
const NEW_FUNCTIONS = {
  "internal.staff_email_capability(text)": "dcb7b5e6846f24efe17eb7800184dd59",
  "internal.staff_due_after(timestamp with time zone,integer)": "b755ae0538f37eaf91c6d6818584db91",
  "internal.staff_email_due(text,uuid,uuid)": "535f20babfd9b03ea13cd852c0270ab8",
  "internal.queue_staff_deadline_emails()": "78c72d9e0075a00cb7fa9a94ccf0b0f1",
  "internal.claim_lost_email_alert(integer)": "25fee44314e2556ef9bea1f44e05c9bc",
  "api.claim_lost_email_alert(integer)": "70303c452ab6cda4848c333b1247efd3",
  "internal.complete_lost_email_alert(uuid,boolean)": "5575975a22aab2cf647d7bccafe2c8a2",
  "api.complete_lost_email_alert(uuid,boolean)": "636b85615798a2f3f923f9dc25d4934a",
};
const REVIEWED = {
  [CLAIM]: "f659e9ebf7dcf269e4759879537a10f0",
  ...Object.fromEntries(Object.keys(NEW_FUNCTIONS).map((s) => [s, "missing"])),
};
const UPDATED = { [CLAIM]: "368f515805291682c74f28b163c50687", ...NEW_FUNCTIONS };
const LABEL = "lost email alert";
// The preflight summary: one lost email before the update, no open item yet.
const NOT_APPLIED =
  /^lost email alert: update not applied; lost emails: 1; open privacy requests: 0; open appeals: 0; open reports: 0; staff emails queued: 0$/;
const ALREADY_APPLIED =
  /^lost email alert: already applied; lost emails: 1; open privacy requests: 0; open appeals: 0; open reports: 0; staff emails queued: 0$/;
const SERVICE_ONLY = { anon: false, authenticated: false, service_role: true };
const NO_API_ROLE = { anon: false, authenticated: false, service_role: false };

await runTwoAdminUpdateCheck(
  { update: UPDATE, label: "lost", title: "Lost-email alert and staff deadline emails" },
  async ({ database, check, kit, world, admin, admin2 }) => {
    const { q, json, fails, staff, service, steps, index } = kit;
    const replica = (sql) =>
      q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
    const member = (label) => world.user(label);

    /** A queued email (owner `owner`) as the email job left it. */
    const queued = (
      owner,
      { attempts = 8, lease = null, processed = false, error = "delivery_failed" } = {}
    ) =>
      q(`insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key,delivery_attempts,delivery_until,
          processed_at,delivery_error)
        values('enquiry_received',gen_random_uuid(),'${owner.id}','vmtest:'||gen_random_uuid(),${attempts},
          ${lease ? `now()+interval '${lease}'` : "null"},${processed ? "now()" : "null"},
          ${processed ? "null" : `'${error}'`}) returning id;`);
    /** A member's privacy request through the production command; its id. */
    const privacyRequest = (person, type = "access") =>
      json(
        service(`select api.record_frontend_privacy_request('${person.id}','${person.session}','${type}',
          'Thandi Member',null,null);`)
      ).id;
    /** An appeal by `person`, as the appeal flow writes it; its id. */
    const appeal = (person, kind = "suspension") =>
      q(`insert into private.frontend_appeals(action_id,appellant_id,kind,reason)
        values(gen_random_uuid(),'${person.id}','${kind}','A synthetic appeal reason that is long enough.')
        returning id;`);
    /** A public report about `subject`'s post, as the report flow writes it; its id. */
    const report = (subject, { reporter = null, severity = "standard", at = null } = {}) =>
      q(`insert into private.reports(post_id,subject_account_id,category,severity,description,reporter_id,
          reporter_ip_hmac,frontend_reason${at ? ",created_at" : ""})
        values(null,'${subject.id}','scam','${severity}','A synthetic report description.',
          ${reporter ? `'${reporter.id}'` : "null"},'${"A".repeat(42)}${(Math.random() * 10) | 0}',
          'fake_listing'${at ? `,'${at}'` : ""}) returning id;`);
    /** Staff email rows queued about `item`: { kind, owner } sorted by owner. */
    const staffEmails = (item) =>
      json(`select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'owner',owner_id,'key',dedupe_key)
          order by owner_id),'[]') from private.outbox_events
        where subject_id='${item}' and kind like 'staff\\_%';`);
    const owners = (...people) => people.map((p) => p.id).sort();
    const claimStaff = () =>
      json(
        service(
          `select api.claim_supported_notification_outbox(array['staff_privacy_request','staff_appeal','staff_report'],50);`
        )
      );
    const claimAlert = (limit = 50) =>
      json(service(`select api.claim_lost_email_alert(${limit});`));
    const completeAlert = (token, sent) =>
      q(service(`select api.complete_lost_email_alert('${token}',${sent});`));
    const sast = (iso) =>
      q(
        `select to_char(('${iso}'::timestamptz) at time zone 'Africa/Johannesburg','Dy YYYY-MM-DD HH24:MI');`
      );
    const dueAfter = (local, days) =>
      sast(
        q(
          `select internal.staff_due_after(('${local}'::timestamp at time zone 'Africa/Johannesburg'),${days});`
        )
      );

    // ------------------------------------------------------------ before
    const early = member("lost-early");
    const earlyLost = queued(early);
    await checkNoticeUpdate(
      { kit, database, check },
      {
        label: LABEL,
        reviewed: REVIEWED,
        updated: UPDATED,
        notApplied: NOT_APPLIED,
        applied: ALREADY_APPLIED,
        drift: [CLAIM],
        before: () => {
          assert.equal(
            q("select to_regprocedure('api.claim_lost_email_alert(integer)') is null;"),
            "t"
          );
        },
      }
    );

    // The staff: two admins (from the world), a governor and a moderator.
    const governor = world.staffUser("lost-governor", "governor");
    const moderator = world.staffUser("lost-moderator", "moderator");

    // ------------------------------------------------------------ staff emails
    await check(
      "a member's privacy request emails each staff member with dsar:manage, not the member",
      () => {
        const thandi = member("lost-thandi");
        const request = privacyRequest(thandi);
        const rows = staffEmails(request);
        assert.deepEqual(
          rows.map((r) => r.owner),
          owners(admin, admin2, governor)
        );
        for (const row of rows) {
          assert.equal(row.kind, "staff_privacy_request");
          assert.equal(row.key, `staff_privacy_request:${request}:${row.owner}`);
        }
      }
    );

    await check(
      "a request recorded by staff emails the other staff, not the one who recorded it",
      () => {
        const recorded = json(
          staff(
            admin,
            `select api.record_frontend_privacy_intake('access','caller@example.invalid',null,
            'A request received by telephone.','Recorded from a synthetic call.',null);`
          )
        ).id;
        assert.deepEqual(
          staffEmails(recorded).map((r) => r.owner),
          owners(admin2, governor)
        );
      }
    );

    await check("an appeal emails each staff member with appeal:decide, not the appellant", () => {
      const sipho = member("lost-sipho");
      const item = appeal(sipho);
      const rows = staffEmails(item);
      assert.deepEqual(
        rows.map((r) => r.owner),
        owners(admin, admin2, governor)
      );
      assert.ok(rows.every((r) => r.kind === "staff_appeal"));
    });

    await check(
      "a public report emails each staff member with report:resolve, not its reporter",
      () => {
        const seller = member("lost-seller");
        const item = report(seller, { reporter: admin2 });
        const rows = staffEmails(item);
        assert.deepEqual(
          rows.map((r) => r.owner),
          owners(admin, governor, moderator)
        );
        assert.ok(rows.every((r) => r.kind === "staff_report"));
      }
    );

    await check("a staff duplicate-event report emails nobody", () => {
      const a = randomUUID();
      const b = randomUUID();
      const [low, high] = [a, b].sort();
      const owner = member("lost-duplicate");
      const item =
        q(`insert into private.reports(subject_account_id,category,description,report_origin,
          duplicate_post_a,duplicate_post_b,duplicate_revision_a,duplicate_revision_b,duplicate_owner_b,duplicate_created_by)
        values('${owner.id}','duplicate_event','Two events look the same.','staff','${low}','${high}',1,1,
          '${owner.id}','${admin.id}') returning id;`);
      assert.deepEqual(staffEmails(item), []);
    });

    await check("staff without a confirmed address or with a revoked role are not emailed", () => {
      const unconfirmed = world.staffUser("lost-unconfirmed", "governor");
      q(`update auth.users set email_confirmed_at=null where id='${unconfirmed.id}';`);
      const revoked = world.staffUser("lost-revoked", "governor");
      q(
        `update private.staff_roles set revoked_at=now(),revoked_by='${admin.id}' where user_id='${revoked.id}';`
      );
      const item = appeal(member("lost-zola"));
      const got = staffEmails(item).map((r) => r.owner);
      assert.ok(!got.includes(unconfirmed.id));
      assert.ok(!got.includes(revoked.id));
      assert.deepEqual(got, owners(admin, admin2, governor));
    });

    await check(
      "LIM-F-queue_staff_deadline_emails: at most 20 report emails a staff member an hour",
      () => {
        const before = Number(
          q(`select count(*) from private.outbox_events where owner_id='${moderator.id}' and kind='staff_report'
          and created_at>now()-interval '1 hour';`)
        );
        const seller = member("lost-flood");
        const items = Array.from({ length: 21 - before }, () => report(seller));
        const mine = (item) => staffEmails(item).some((r) => r.owner === moderator.id);
        // The first 20 in the hour reach the moderator; the 21st does not.
        assert.ok(items.slice(0, 20 - before).every(mine));
        assert.equal(mine(items.at(-1)), false);
        // Reports an hour old no longer count (for any staff member).
        replica(`update private.outbox_events set created_at=created_at-interval '61 minutes'
        where kind='staff_report';`);
        assert.equal(mine(report(seller)), true);
      }
    );

    // ------------------------------------------------------------ the claim
    await check("business days: weekends are skipped, the time of day is kept", () => {
      // 27 November 2026 is a Friday.
      assert.equal(dueAfter("2026-11-27 15:00", 2), "Tue 2026-12-01 15:00");
      assert.equal(dueAfter("2026-11-28 10:00", 2), "Tue 2026-12-01 10:00");
      assert.equal(dueAfter("2026-11-25 09:30", 2), "Fri 2026-11-27 09:30");
      assert.equal(dueAfter("2026-11-26 08:00", 3), "Tue 2026-12-01 08:00");
      assert.equal(dueAfter("2026-11-29 23:59", 3), "Wed 2026-12-02 23:59");
    });

    // A fresh world for the claim: earlier rows are sent.
    q(
      `update private.outbox_events set processed_at=now() where kind like 'staff\\_%' and processed_at is null;`
    );
    const naledi = member("lost-naledi");
    const request = privacyRequest(naledi, "deletion");
    const appealItem = appeal(naledi, "content_hidden");
    // Received on a Friday afternoon (South African time).
    report(member("lost-shop"), {
      severity: "high",
      at: "2026-11-27 13:00:00+00",
    });
    await check(
      "the claim hands each staff email out with its type, severity, received time and deadline",
      () => {
        const jobs = claimStaff();
        // 3 for the request, 3 for the appeal, 4 for the report.
        assert.equal(jobs.length, 10, JSON.stringify(jobs));
        const by = (kind, owner) => jobs.find((j) => j.kind === kind && j.owner_id === owner.id);
        const p = by("staff_privacy_request", admin);
        assert.equal(p.recipient, admin.email);
        assert.equal(p.subject_id, request);
        assert.equal(p.staff_item_type, "deletion");
        assert.equal(p.staff_severity, null);
        const due = q(
          `select to_jsonb(effective_due_at) from private.privacy_requests where id='${request}';`
        );
        assert.equal(JSON.stringify(p.staff_due_at), due);
        const a = by("staff_appeal", governor);
        assert.equal(a.recipient, governor.email);
        assert.equal(a.staff_item_type, "content_hidden");
        const received = q(
          `select to_jsonb(created_at) from private.frontend_appeals where id='${appealItem}';`
        );
        assert.equal(JSON.stringify(a.staff_received_at), received);
        assert.equal(
          JSON.stringify(a.staff_due_at),
          q(
            `select to_jsonb(internal.staff_due_after(created_at,3)) from private.frontend_appeals where id='${appealItem}';`
          )
        );
        const r = by("staff_report", moderator);
        assert.equal(r.recipient, moderator.email);
        assert.equal(r.staff_item_type, "fake_listing");
        assert.equal(r.staff_severity, "high");
        assert.equal(sast(r.staff_received_at), "Fri 2026-11-27 15:00");
        assert.equal(sast(r.staff_due_at), "Tue 2026-12-01 15:00");
        // Nothing else about the member or the item.
        for (const job of jobs) {
          assert.equal(job.post_title, null);
          assert.ok(!JSON.stringify(job).includes(naledi.email));
          assert.ok(!JSON.stringify(job).includes("Thandi Member"));
        }
        for (const job of jobs)
          q(
            service(
              `select api.complete_notification_outbox('${job.id}','${job.claim_token}',true,null);`
            )
          );
      }
    );

    await check(
      "a staff email is skipped once the item is closed or the staff member lost the capability",
      () => {
        const fresh = appeal(member("lost-closed"));
        const other = privacyRequest(member("lost-other"));
        replica(`update private.frontend_appeals set status='dismissed',resolved_at=now(),
          reviewer_rationale='A synthetic rationale.',reviewer_id='${admin.id}' where id='${fresh}';`);
        q(
          `update private.staff_roles set role='moderator' where user_id='${governor.id}' and revoked_at is null;`
        );
        const jobs = claimStaff();
        const appealJobs = jobs.filter((j) => j.subject_id === fresh);
        assert.equal(appealJobs.length, 3);
        assert.ok(appealJobs.every((j) => j.recipient === null));
        const requestJobs = jobs.filter((j) => j.subject_id === other);
        assert.equal(requestJobs.find((j) => j.owner_id === governor.id).recipient, null);
        assert.equal(requestJobs.find((j) => j.owner_id === admin.id).recipient, admin.email);
        for (const job of jobs)
          q(
            service(
              `select api.complete_notification_outbox('${job.id}','${job.claim_token}',true,'skipped');`
            )
          );
        q(
          `update private.staff_roles set role='governor' where user_id='${governor.id}' and revoked_at is null;`
        );
      }
    );

    await check("the claim takes 26 kinds, each once", () => assertClaimKinds(kit, 26));

    // ------------------------------------------------------------ lost emails
    // Every earlier row is finished; only the rows below are lost.
    q(`update private.outbox_events set processed_at=now() where processed_at is null and id<>'${earlyLost}';
      update private.privacy_notice_jobs set delivered_at=now() where delivered_at is null;`);
    const bongi = member("lost-bongi");
    const lostOutbox = queued(bongi, { error: "outcome_unknown" });
    queued(bongi, { attempts: 7 });
    queued(bongi, { lease: "1 minute" });
    queued(bongi, { processed: true });
    const notice = privacyRequest(bongi, "objection");
    const lostNotice = q(
      `update private.privacy_notice_jobs set attempts=8 where request_id='${notice}' returning id;`
    );
    let first;
    await check(
      "LIM-F-claim_lost_email_alert-2: one alert lists the lost rows, oldest first, without addresses",
      () => {
        first = claimAlert();
        assert.match(first.claim, /^[0-9a-f-]{36}$/);
        assert.equal(first.total, 3);
        assert.deepEqual(
          first.items.map((i) => [i.source, i.id, i.kind, i.attempts, i.last_error]),
          [
            ["outbox", earlyLost, "enquiry_received", 8, "delivery_failed"],
            ["outbox", lostOutbox, "enquiry_received", 8, "outcome_unknown"],
            ["privacy_notice", lostNotice, "privacy_notice_submitted", 8, null],
          ]
        );
        assert.ok(!JSON.stringify(first).includes("@"));
        // While it is being sent, no second alert is made.
        assert.deepEqual(claimAlert(), { claim: null, total: 0, items: [] });
      }
    );

    await check("an alert given back is offered again unchanged; a sent one never again", () => {
      assert.equal(completeAlert(first.claim, false), "t");
      assert.deepEqual(claimAlert(), first);
      assert.equal(completeAlert(first.claim, true), "t");
      assert.equal(completeAlert(first.claim, true), "f");
      assert.equal(completeAlert(first.claim, false), "f");
      assert.deepEqual(claimAlert(), { claim: null, total: 0, items: [] });
    });

    await check("at most one alert every 15 minutes, listing only rows not reported yet", () => {
      const later = queued(bongi);
      assert.deepEqual(claimAlert(), { claim: null, total: 0, items: [] });
      q(`update private.lost_email_alerts set sent_at=sent_at-interval '16 minutes';`);
      const next = claimAlert();
      assert.notEqual(next.claim, first.claim);
      assert.equal(next.total, 1);
      assert.deepEqual(
        next.items.map((i) => i.id),
        [later]
      );
      completeAlert(next.claim, true);
    });

    await check("an alert lists at most p_limit rows but counts them all", () => {
      q(`update private.lost_email_alerts set sent_at=sent_at-interval '16 minutes';`);
      for (let i = 0; i < 3; i++) queued(bongi);
      const alert = claimAlert(2);
      assert.equal(alert.total, 3);
      assert.equal(alert.items.length, 2);
      completeAlert(alert.claim, true);
      q(`update private.lost_email_alerts set sent_at=sent_at-interval '16 minutes';`);
      assert.deepEqual(claimAlert(), { claim: null, total: 0, items: [] });
      fails(
        service("select api.claim_lost_email_alert(0);"),
        "22023",
        /invalid lost email alert limit/
      );
      fails(
        service("select api.complete_lost_email_alert(null,true);"),
        "22023",
        /invalid lost email alert claim/
      );
    });

    await check("who may run what: the alert commands are the service role's only", () => {
      assert.deepEqual(
        executeGrants(json, [
          CLAIM,
          "api.claim_supported_notification_outbox(text[],integer)",
          "internal.claim_lost_email_alert(integer)",
          "api.claim_lost_email_alert(integer)",
          "internal.complete_lost_email_alert(uuid,boolean)",
          "api.complete_lost_email_alert(uuid,boolean)",
        ]),
        Object.fromEntries(
          [
            CLAIM,
            "api.claim_supported_notification_outbox(text[],integer)",
            "internal.claim_lost_email_alert(integer)",
            "api.claim_lost_email_alert(integer)",
            "internal.complete_lost_email_alert(uuid,boolean)",
            "api.complete_lost_email_alert(uuid,boolean)",
          ].map((s) => [s, SERVICE_ONLY])
        )
      );
      const helpers = [
        "internal.staff_email_capability(text)",
        "internal.staff_due_after(timestamp with time zone,integer)",
        "internal.staff_email_due(text,uuid,uuid)",
        "internal.queue_staff_deadline_emails()",
      ];
      assert.deepEqual(
        executeGrants(json, helpers),
        Object.fromEntries(helpers.map((s) => [s, NO_API_ROLE]))
      );
      for (const signature of [...Object.keys(NEW_FUNCTIONS)]) {
        const meta =
          json(`select jsonb_build_object('owner',proowner::regrole::text,'config',proconfig)
          from pg_proc where oid='${signature}'::regprocedure;`);
        assert.deepEqual(
          meta,
          { owner: "postgres", config: ["search_path=pg_catalog"] },
          signature
        );
      }
      assert.equal(
        q(`select relrowsecurity and not has_table_privilege('service_role','private.lost_email_alerts','select')
            and not has_table_privilege('authenticated','private.lost_email_alerts','select')
          from pg_class where oid='private.lost_email_alerts'::regclass;`),
        "t"
      );
      // A member can claim nothing.
      fails(kit.member(bongi, "select api.claim_lost_email_alert(10);"), "42501");
    });

    const later = steps.slice(index + 1);
    if (later.length) {
      applySteps(database, later);
      await check("later updates keep the staff emails and the alert", () => {
        const item = appeal(member("lost-later"));
        assert.equal(staffEmails(item).length, 3);
        assert.equal(claimAlert().claim, null);
      });
    }
  }
);
