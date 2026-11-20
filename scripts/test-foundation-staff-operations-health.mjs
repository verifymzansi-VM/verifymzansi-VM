#!/usr/bin/env node
// Behaviour checks for 20261120163500_staff_operations_health.sql: every
// scheduled job command records when it last ran (only when it succeeds, at
// most once every 20 seconds, its result unchanged), and the staff read
// api.get_staff_operations_health() shows late jobs, stuck emails and
// notices, payment problems, blocked deletions and open cost alarms to staff
// with audit:view only, without account ids or contact data.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. The job commands run as service_role, as the website's timed jobs call
// them; staff and members are Auth rows written as the database owner (staff
// with a verified authenticator app and an AAL2 session). The stuck work the
// read lists is written directly as the database owner (synthetic rows, with
// triggers off). The script runs the update's read-only preflight, checks its
// refusals, applies it, checks the rules, and proves apply -> rollback ->
// apply returns the same fingerprints. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-staff-operations-health.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  executeGrants,
  installStaffPaymentWorld,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261120163500_staff_operations_health.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const READ = "api.get_staff_operations_health()";
const RECORD = "api.record_scheduled_job_run(text)";
const HELPERS = [
  "internal.get_staff_operations_health()",
  "internal.note_scheduled_job_run(text,anyelement)",
  "internal.record_scheduled_job_run(text)",
  "internal.scheduled_job_catalogue()",
];
const ALL_KINDS = [
  "payment_completed",
  "payment_reversed",
  "payment_reconciliation_required",
  "trial_started",
  "post_expired",
  "post_expiry_reminder",
  "draft_deletion_warning",
  "post_deleted",
  "verification_phone_confirmed",
  "identity_accepted",
  "enquiry_received",
  "account_warning",
  "content_hidden",
  "account_suspended",
  "account_banned",
  "appeal_decided",
  "business_check_update",
  "post_sold",
  "post_kept",
  "verification_returned",
  "slot_renewal_reminder",
];
const KINDS_SQL = `array[${ALL_KINDS.map((k) => `'${k}'`).join(",")}]`;
/** Each job command, its call as the timed jobs make it, and its job name. */
const JOBS = [
  ["api.run_slot_renewals(integer)", "select api.run_slot_renewals(100);", "slot_renewals"],
  ["api.run_post_lifecycle(integer)", "select api.run_post_lifecycle(100);", "post_lifecycle"],
  ["api.sweep_sponsorships(integer)", "select api.sweep_sponsorships(100);", "sponsorships"],
  ["api.purge_expired_inbox(integer)", "select api.purge_expired_inbox(100);", "inbox_purge"],
  ["api.reconcile_intro_trials(integer)", "select api.reconcile_intro_trials(20);", "intro_trials"],
  [
    "api.approve_due_commissions(integer)",
    "select api.approve_due_commissions(20);",
    "commissions",
  ],
  [
    "api.expire_waiting_bank_transfers(integer)",
    "select api.expire_waiting_bank_transfers(50);",
    "bank_transfer_expiry",
  ],
  [
    "api.void_ended_package_add_invoices(integer)",
    "select api.void_ended_package_add_invoices(50);",
    "package_add_invoices",
  ],
  [
    "api.claim_supported_notification_outbox(text[],integer)",
    `select api.claim_supported_notification_outbox(${KINDS_SQL},1);`,
    "email_delivery",
  ],
  ["api.claim_payment_alerts(integer)", "select api.claim_payment_alerts(10);", "payment_alerts"],
  [
    "api.claim_frontend_privacy_notice()",
    "select api.claim_frontend_privacy_notice();",
    "privacy_notices",
  ],
  ["api.run_retention(integer)", "select api.run_retention(100);", "retention"],
  [
    "api.purge_frontend_form_drafts(integer)",
    "select api.purge_frontend_form_drafts(500);",
    "form_drafts",
  ],
  [
    "api.claim_evidence_cleanup(integer)",
    "select api.claim_evidence_cleanup(4);",
    "evidence_cleanup",
  ],
  ["api.claim_media_cleanup(integer)", "select api.claim_media_cleanup(100);", "media_cleanup"],
];
const JOB_SIGNATURES = JOBS.map(([signature]) => signature);
/** The two payment jobs: their commands are untouched; the website records a
 * run with api.record_scheduled_job_run only after the whole run succeeded. */
const WEBSITE_JOBS = ["payment_checks", "refund_check"];
const UNTOUCHED = [
  ["api.expire_stale_checkouts(integer)", "select api.expire_stale_checkouts(100);"],
  ["api.reconcile_ozow_refunds(jsonb)", "select api.reconcile_ozow_refunds('[]');"],
];
/** Every job, in catalogue order: the 15 commands, then the 2 website jobs. */
const ALL_JOBS = [...JOBS.map(([, , job]) => job), ...WEBSITE_JOBS];
const recordSql = (job) => `select api.record_scheduled_job_run('${job}');`;
const runEveryJob = (runJob) => {
  for (const [, sql] of JOBS) runJob(sql);
  for (const job of WEBSITE_JOBS) runJob(recordSql(job));
};
const SERVICE_ONLY = { anon: false, authenticated: false, service_role: true };

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  fails,
  member,
  staff,
  service,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const world = installStaffPaymentWorld(q, json);
  const admin = world.staffUser("ops-admin", "admin");
  const governor = world.staffUser("ops-governor", "governor");
  const moderator = world.staffUser("ops-moderator", "moderator");
  const someone = world.user("ops-member");

  const read = (who = admin, totpAt) => json(staff(who, `select ${READ};`, totpAt));
  const runs = () =>
    json(
      `select coalesce(jsonb_object_agg(job,last_run_at),'{}') from private.scheduled_job_runs;`
    );
  const runJob = (sql) => q(service(sql));
  /** Moves a job's recorded run back by `by` (an interval). */
  const age = (job, by) =>
    q(
      `update private.scheduled_job_runs set last_run_at=clock_timestamp()-interval '${by}' where job='${job}';`
    );
  const lateOf = (job) => read().jobs.find((j) => j.job === job).late;

  // ------------------------------------------------------------ before
  const reviewed = Object.fromEntries(JOB_SIGNATURES.map((s) => [s, bodyMd5(s)]));
  const untouched = Object.fromEntries(UNTOUCHED.map(([s]) => [s, bodyMd5(s)]));
  const grants = executeGrants(json, JOB_SIGNATURES);
  await check("before the update: the job commands are service-only and record nothing", () => {
    for (const signature of JOB_SIGNATURES) assert.deepEqual(grants[signature], SERVICE_ONLY);
    assert.equal(q(`select to_regclass('private.scheduled_job_runs') is null;`), "t");
    assert.equal(bodyMd5(READ), "missing");
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(rows[0][1], "staff operations health: update not applied");
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const target = "api.sweep_sponsorships(integer)";
    const live = q(`select pg_get_functiondef('${target}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${target}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[0][1], /unexpected state/);
    assert.ok(rows[1][1].startsWith(`${target} is not the reviewed body`), rows[1][1]);
    assert.match(
      fails(step.sql, "55000"),
      /operations health drift: not the reviewed body: api\.sweep_sponsorships/
    );
    q(`${live};`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "staff operations health",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: /^staff operations health: already applied; jobs with a recorded run: 0 of 17$/,
  });

  await check("rollback restores every job command byte for byte", () => {
    const after = Object.fromEntries(JOB_SIGNATURES.map((s) => [s, bodyMd5(s)]));
    for (const signature of JOB_SIGNATURES) assert.notEqual(after[signature], reviewed[signature]);
    q(ROLLBACK);
    assert.deepEqual(Object.fromEntries(JOB_SIGNATURES.map((s) => [s, bodyMd5(s)])), reviewed);
    assert.deepEqual(executeGrants(json, JOB_SIGNATURES), grants);
    applySteps(database, [step]);
    assert.deepEqual(Object.fromEntries(JOB_SIGNATURES.map((s) => [s, bodyMd5(s)])), after);
    // The two payment job commands are not touched by the update.
    assert.deepEqual(Object.fromEntries(UNTOUCHED.map(([s]) => [s, bodyMd5(s)])), untouched);
  });

  await check("the rollback refuses once a later change touched what it undoes", () => {
    const before = fingerprint();
    const target = "api.sweep_sponsorships(integer)";
    const live = q(`select pg_get_functiondef('${target}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${target}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    assert.match(fails(ROLLBACK, "55000"), /changed since the update: api\.sweep_sponsorships/);
    q(`${live};`);
    // A later function that also records runs would lose its helper.
    q(`create function internal.vmtest_other_job() returns integer language sql
      as $f$ select internal.note_scheduled_job_run('retention', 1) $f$;`);
    assert.match(
      fails(ROLLBACK, "55000"),
      /other functions call internal\.note_scheduled_job_run: internal\.vmtest_other_job\(\)/
    );
    q(`drop function internal.vmtest_other_job();`);
    assert.equal(fingerprint(), before);
  });

  await check("grants: job commands unchanged, the read for signed-in staff only", () => {
    assert.deepEqual(executeGrants(json, JOB_SIGNATURES), grants);
    assert.deepEqual(executeGrants(json, [READ, RECORD]), {
      [READ]: { anon: false, authenticated: true, service_role: false },
      [RECORD]: SERVICE_ONLY,
    });
    assert.deepEqual(executeGrants(json, HELPERS), {
      "internal.get_staff_operations_health()": {
        anon: false,
        authenticated: true,
        service_role: false,
      },
      "internal.note_scheduled_job_run(text,anyelement)": SERVICE_ONLY,
      "internal.record_scheduled_job_run(text)": SERVICE_ONLY,
      "internal.scheduled_job_catalogue()": {
        anon: false,
        authenticated: false,
        service_role: false,
      },
    });
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        q(
          `select has_table_privilege('${role}','private.scheduled_job_runs','select,insert,update,delete,truncate,references,trigger');`
        ),
        "f",
        role
      );
    assert.equal(
      q(`select relrowsecurity from pg_class where oid='private.scheduled_job_runs'::regclass;`),
      "t"
    );
    assert.equal(
      q(`select count(*) from pg_proc where oid='${READ}'::regprocedure and prosecdef;`),
      "0"
    );
  });

  // ------------------------------------------------------- job records
  await check("each job command records its run, with its result unchanged", () => {
    assert.deepEqual(runs(), {});
    for (const [, sql, job] of JOBS) {
      const before = runs();
      runJob(sql);
      const after = runs();
      assert.ok(after[job], `${job} recorded`);
      assert.deepEqual(
        Object.keys(after).filter((name) => name !== job && after[name] !== before[name]),
        [],
        `${job} records only itself`
      );
    }
    assert.equal(Object.keys(runs()).length, 15);
    // The payment job commands record nothing: the website records those runs
    // only after the whole run succeeded.
    for (const [, sql] of UNTOUCHED) runJob(sql);
    assert.equal(Object.keys(runs()).length, 15);
    for (const job of WEBSITE_JOBS) {
      runJob(recordSql(job));
      assert.ok(runs()[job], `${job} recorded by the website`);
    }
    assert.equal(Object.keys(runs()).length, 17);
    assert.equal(runJob("select api.approve_due_commissions(20);"), "0");
    assert.equal(runJob("select api.claim_media_cleanup(100);"), "[]");
    assert.equal(runJob("select api.claim_frontend_privacy_notice() is null;"), "t");
    assert.match(
      preflight()[0][1],
      /^staff operations health: already applied; jobs with a recorded run: 17 of 17$/
    );
  });
  await check("a failed job command records nothing", () => {
    q(`delete from private.scheduled_job_runs;`);
    fails(service("select api.sweep_sponsorships(0);"), "22023", /limit 1 to 1000/);
    fails(service("select api.run_retention(0);"), "22023", /limit 1 to 5000/);
    fails(service(`select api.reconcile_ozow_refunds('{}');`), "22023");
    runJob("select api.reconcile_ozow_refunds('[]');");
    runJob("select api.expire_stale_checkouts(100);");
    assert.deepEqual(runs(), {});
  });
  await check("at most one write a job every 20 seconds; a later run moves the time on", () => {
    runJob("select api.sweep_sponsorships(100);");
    const first = runs().sponsorships;
    runJob("select api.sweep_sponsorships(100);");
    assert.equal(runs().sponsorships, first);
    age("sponsorships", "21 seconds");
    const aged = runs().sponsorships;
    runJob("select api.sweep_sponsorships(100);");
    assert.ok(Date.parse(runs().sponsorships) > Date.parse(aged));
    assert.ok(Date.parse(runs().sponsorships) >= Date.parse(first));
  });
  await check("only catalogued jobs can be recorded", () => {
    fails(
      service("select internal.note_scheduled_job_run('anything_else',1);"),
      "22023",
      /scheduled job required/
    );
    fails(
      service("select internal.note_scheduled_job_run(null::text,1);"),
      "22023",
      /scheduled job required/
    );
    for (const job of ["retention", "sponsorships", "anything_else"])
      fails(service(recordSql(job)), "22023", /scheduled job recorded by the website required/);
    fails(service("select api.record_scheduled_job_run(null);"), "22023");
    for (const sql of [
      "select api.run_retention(100);",
      "select internal.note_scheduled_job_run('retention',1);",
      recordSql("payment_checks"),
    ])
      fails(member(someone, sql), "42501");
    fails(`set role anon;\n${recordSql("refund_check")}`, "42501");
  });
  await check("never a time later than now: a future time shows late, then is pulled back", () => {
    runJob("select api.sweep_sponsorships(100);");
    q(`update private.scheduled_job_runs set last_run_at=clock_timestamp()+interval '1 hour'
      where job='sponsorships';`);
    assert.equal(lateOf("sponsorships"), true);
    runJob("select api.sweep_sponsorships(100);");
    assert.equal(
      q(`select last_run_at<=clock_timestamp() and last_run_at>clock_timestamp()-interval '1 minute'
        from private.scheduled_job_runs where job='sponsorships';`),
      "t"
    );
    assert.equal(lateOf("sponsorships"), false);
    q(`update private.scheduled_job_runs set last_run_at=clock_timestamp()+interval '1 hour'
      where job='refund_check';`);
    runJob(recordSql("refund_check"));
    assert.equal(
      q(
        `select last_run_at<=clock_timestamp() from private.scheduled_job_runs where job='refund_check';`
      ),
      "t"
    );
  });

  // ------------------------------------------------------------- read
  await check("the read: every job in order, late when not run in time", () => {
    q(`delete from private.scheduled_job_runs;`);
    const empty = read();
    assert.deepEqual(
      empty.jobs.map((j) => j.job),
      ALL_JOBS
    );
    assert.ok(empty.jobs.every((j) => j.late === true && j.last_run_at === null));
    assert.deepEqual(
      [...new Set(empty.jobs.map((j) => j.every))],
      ["minute", "5_minutes", "10_minutes", "day"]
    );
    runEveryJob(runJob);
    assert.ok(read().jobs.every((j) => j.late === false && j.last_run_at !== null));
    // A payment run that failed is never recorded, so it turns late.
    q(`delete from private.scheduled_job_runs where job='payment_checks';`);
    runJob("select api.expire_stale_checkouts(100);");
    assert.equal(lateOf("payment_checks"), true);
    runJob(recordSql("payment_checks"));
    for (const [job, fresh, stale] of [
      ["sponsorships", "9 minutes", "11 minutes"],
      ["commissions", "9 minutes", "11 minutes"],
      ["retention", "29 minutes", "31 minutes"],
      ["payment_checks", "39 minutes", "41 minutes"],
      ["refund_check", "25 hours", "27 hours"],
    ]) {
      age(job, fresh);
      assert.equal(lateOf(job), false, `${job} after ${fresh}`);
      age(job, stale);
      assert.equal(lateOf(job), true, `${job} after ${stale}`);
    }
  });

  // Stuck work written as the database owner, triggers (and foreign keys) off.
  const ids = json(`select jsonb_build_object('owner',gen_random_uuid(),'subject',gen_random_uuid(),
    'payment',gen_random_uuid(),'request',gen_random_uuid(),'closed',gen_random_uuid(),
    'held',gen_random_uuid(),'case',gen_random_uuid(),'minimised',gen_random_uuid(),
    'gone',gen_random_uuid());`);
  q(`set session_replication_role=replica;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key,created_at,delivery_attempts,delivery_error,processed_at) values
      ('enquiry_received','${ids.subject}','${ids.owner}','ops-final',now()-interval '3 hours',8,'delivery_failed',null),
      ('post_expired','${ids.subject}','${ids.owner}','ops-old',now()-interval '2 days',1,null,null),
      ('trial_started','${ids.subject}','${ids.owner}','ops-fresh',now()-interval '5 minutes',2,'delivery_failed',null),
      ('post_deleted','${ids.subject}','${ids.owner}','ops-sent',now()-interval '3 days',8,null,now());
    insert into private.privacy_requests(id,type,requester_email,description,identity_check,received_at,due_by,legal_basis,minimised_at,subject_user_id) values
      ('${ids.request}','access','ops-manual@example.invalid','Fixture request','manual',now()-interval '3 days',now()+interval '27 days','POPIA s23',null,null),
      ('${ids.minimised}','access','ops-minimised@example.invalid','Fixture request','manual',now()-interval '3 days',now()+interval '27 days','POPIA s23',now(),null),
      ('${ids.gone}','access','ops-gone@example.invalid','Fixture request','session',now()-interval '3 days',now()+interval '27 days','POPIA s23',null,'${ids.owner}');
    insert into private.privacy_notice_jobs(request_id,kind,created_at,attempts) values
      ('${ids.minimised}','submitted',now()-interval '2 days',3),
      ('${ids.gone}','submitted',now()-interval '2 days',3),
      ('${ids.gone}','approved',now()-interval '1 hour',1),
      ('${ids.request}','submitted',now()-interval '2 days',3),
      ('${ids.request}','approved',now()-interval '1 hour',8),
      ('${ids.request}','completed',now()-interval '1 hour',1);
    insert into private.privacy_notice_jobs(request_id,kind,created_at,attempts,delivered_at) values
      ('${ids.request}','extended',now()-interval '5 days',2,now());
    insert into private.payment_problems(payment_id,reason,source,first_seen_at,last_seen_at,occurrences) values
      ('${ids.payment}','amount_mismatch','notice',now()-interval '2 days',now()-interval '1 day',3),
      (null,'unknown_reference','notice',now()-interval '20 days',now()-interval '10 days',1);
    insert into private.account_erasures(user_id,closed_at,erase_after,closed_by,blocked_at,blocked_reason) values
      ('${ids.closed}',now()-interval '40 days',now()-interval '10 days','member',now()-interval '9 days','refund_open');
    insert into private.account_erasures(user_id,closed_at,erase_after,closed_by) values
      ('${ids.held}',now()-interval '5 days',now()+interval '25 days','staff');
    insert into private.media_objects(owner_id,kind,object_key,declared_bytes,state,state_changed_at) values
      ('${ids.owner}','image','media/'||gen_random_uuid(),100,'cleanup_required',now()-interval '2 days'),
      ('${ids.owner}','image','media/'||gen_random_uuid(),100,'cleanup_required',now()-interval '1 hour');
    insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key,state,sha256,created_at,retain_until) values
      ('${ids.case}','${ids.owner}','selfie','evidence/'||gen_random_uuid()||'/'||gen_random_uuid(),'clean',repeat('a',64),now()-interval '100 days',now()-interval '3 days'),
      ('${ids.case}','${ids.held}','selfie','evidence/'||gen_random_uuid()||'/'||gen_random_uuid(),'clean',repeat('b',64),now()-interval '100 days',now()-interval '3 days'),
      ('${ids.case}','${ids.owner}','id_front','evidence/'||gen_random_uuid()||'/'||gen_random_uuid(),'clean',repeat('c',64),now()-interval '10 days',now()+interval '20 days');
    insert into private.legal_holds(subject_id,reason,placed_by) values
      ('${ids.held}','Fixture: a legal hold','${admin.id}'),('${ids.held}','Fixture: a second hold','${admin.id}');
    insert into private.cost_alarms(metric,level,period,used,free_quantity,raised_at) values
      ('sms_codes_day','warning','2026-11-20',350,500,now()-interval '2 hours'),
      ('sms_codes_day','critical','2026-11-20',500,500,now()-interval '1 hour');
    insert into private.cost_alarms(metric,level,period,used,free_quantity,acknowledged_by,acknowledged_at) values
      ('sms_codes_day','warning','2026-11-19',350,500,'${admin.id}',now());
    set session_replication_role=origin;`);

  await check(
    "the read: stuck emails and notices, payment problems, blocked deletions, alarms",
    () => {
      const health = read();
      assert.deepEqual(health.emails, {
        waiting: 3,
        stuck: 2,
        items: [
          {
            kind: "post_expired",
            attempts: 1,
            queued_at: health.emails.items[0].queued_at,
            last_error: null,
          },
          {
            kind: "enquiry_received",
            attempts: 8,
            queued_at: health.emails.items[1].queued_at,
            last_error: "delivery_failed",
          },
        ],
      });
      assert.deepEqual(
        health.notices.items.map((n) => [n.kind, n.attempts]),
        [
          ["submitted", 3],
          ["approved", 8],
        ]
      );
      assert.equal(health.notices.stuck, 2);
      // The minimised request's notice and the two of a request whose account
      // is gone can never be sent: counted apart, never listed.
      assert.equal(health.notices.undeliverable, 3);
      assert.equal(health.payments.problems, 1);
      assert.equal(health.payments.not_activated, 0);
      assert.deepEqual(
        health.payments.items.map((p) => [
          p.payment_ref,
          p.reason,
          p.source,
          p.occurrences,
          p.alerted,
        ]),
        [[ids.payment.slice(0, 8), "amount_mismatch", "notice", 3, false]]
      );
      const { items, ...counts } = health.deletions;
      assert.deepEqual(counts, {
        accounts_blocked: 1,
        files_stuck: 1,
        files_queued: 2,
        evidence_overdue: 1,
        legal_holds: 1,
      });
      assert.deepEqual(
        items.map((d) => [d.reason, d.closed_by]),
        [["refund_open", "member"]]
      );
      assert.equal(health.incidents.open, 2);
      assert.deepEqual(
        health.incidents.items.map((a) => [a.metric, a.level]),
        [
          ["sms_codes_day", "critical"],
          ["sms_codes_day", "warning"],
        ]
      );
      // No account, subject, request or case ids; no full payment id.
      const text = JSON.stringify(health);
      for (const id of Object.values(ids)) assert.ok(!text.includes(id), id);
      assert.ok(!text.includes(admin.id));
      assert.ok(!/@/.test(text));
    }
  );
  await check("at most 50 rows a list; counts are complete", () => {
    q(`set session_replication_role=replica;
      insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key,created_at,delivery_attempts)
        select 'post_expired',gen_random_uuid(),gen_random_uuid(),'ops-many-'||n,now()-interval '2 days'-n*interval '1 minute',8
        from generate_series(1,60) n;
      set session_replication_role=origin;`);
    const health = read();
    assert.equal(health.emails.stuck, 62);
    assert.equal(health.emails.items.length, 50);
    const times = health.emails.items.map((e) => Date.parse(e.queued_at));
    assert.deepEqual(
      times,
      [...times].sort((a, b) => a - b)
    );
  });

  // ----------------------------------------------------------- access
  await check("only staff with audit:view and a recent authenticator code", () => {
    assert.equal(read(governor).jobs.length, 17);
    fails(staff(moderator, `select ${READ};`), "42501", /capability not granted/);
    fails(member(someone, `select ${READ};`), "42501");
    fails(
      staff(admin, `select ${READ};`, Math.floor(Date.now() / 1000) - 20 * 60),
      "42501",
      /recent second-factor verification required/
    );
    fails(service(`select ${READ};`), "42501");
    fails(`set role anon;\nselect ${READ};`, "42501");
    fails(member(someone, "select * from private.scheduled_job_runs;"), "42501");
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the job records and the read", () => {
      q(`delete from private.scheduled_job_runs;`);
      runEveryJob(runJob);
      assert.equal(Object.keys(runs()).length, 17);
      assert.equal(read().jobs.length, 17);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Staff operations health checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
