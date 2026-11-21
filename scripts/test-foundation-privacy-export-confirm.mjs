#!/usr/bin/env node
// Behaviour checks for 20261120191500_privacy_export_confirm.sql: a data
// (access) export leaves the database only together with a notice to the
// member. Preparing an export answers the dataset names only (no personal
// data, digest or counts; the digest stays in the event row) and tells the
// member nothing; only the confirmation returns the data, after rebuilding it
// and matching the digest, in the same transaction that records the
// 'exported' event, queues the requester's email (once per request) and adds
// a bell notice (every export). A changed or too large export is answered as
// refused, recorded and spent; a second confirmation, even a parallel one, is
// refused; only the preparing staff member (never the requester or subject)
// can confirm, at the same revision, within 15 minutes; requests can be
// exported while open, or completed less than 696 hours ago and not
// minimised; builds are limited to 10 an hour per staff member and request
// (refused builds included) and confirmed exports to 5 a request; retention
// clears unconfirmed digests a day after expiry. The old export command keeps
// its signature, with a notice on every export and an hourly limit. The
// update's re-run guard and preflight compare definitions; the rollback
// clears a partial state but refuses after a later change.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Privacy requests are recorded through the production service command
// and handled through the production staff commands, as staff with synthetic
// AAL2 sessions and a verified authenticator app. The script runs the update's
// read-only preflight, checks its refusals, applies it, proves apply ->
// rollback -> apply returns the same fingerprints, then checks the rules. Any
// later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-privacy-export-confirm.mjs
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
import { psqlSessions } from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261120191500_privacy_export_confirm.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const OLD_EXPORT = "internal.export_frontend_privacy_request(uuid,integer)";
const SIGNATURES = [
  "internal.prepare_frontend_privacy_export(uuid,integer)",
  "api.prepare_frontend_privacy_export(uuid,integer)",
  "internal.confirm_frontend_privacy_export(uuid,integer,uuid)",
  "api.confirm_frontend_privacy_export(uuid,integer,uuid)",
];
const RECENT = /recent second-factor verification required/;

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
  const count = (sql) => Number(q(`select count(*) from ${sql};`));
  const stale = () => Math.floor(Date.now() / 1000) - 20 * 60;
  // Separate psql sessions, for the concurrency check.
  const { session, sessionAfter: delayed } = psqlSessions(database);

  // ------------------------------------------------------- synthetic world
  const { user, staffUser } = installStaffPaymentWorld(q, json);
  const admin = staffUser("admin", "admin");
  const governor = staffUser("governor", "governor");
  const moderator = staffUser("moderator", "moderator");
  const privacy = (id) =>
    json(`select to_jsonb(r) from private.privacy_requests r where r.id='${id}';`);
  /** A verified, approved access request of `who`, ready to export. */
  const approved = (who) => {
    const id = json(
      service(
        `select api.record_frontend_privacy_request('${who.id}','${who.session}','access','Fixture Member','0123','Synthetic access request ${crypto.randomUUID()}');`
      )
    ).id;
    q(
      staff(
        admin,
        `select api.process_frontend_privacy_request('${id}',${privacy(id).revision},'verify_identity');`
      )
    );
    q(
      staff(
        admin,
        `select api.process_frontend_privacy_request('${id}',${privacy(id).revision},'approve');`
      )
    );
    return id;
  };
  const prepare = (who, id, totpAt) =>
    staff(
      who,
      `select api.prepare_frontend_privacy_export('${id}',${privacy(id).revision});`,
      totpAt
    );
  const confirm = (who, id, exportId, totpAt, revision = privacy(id).revision) =>
    staff(
      who,
      `select api.confirm_frontend_privacy_export('${id}',${revision},'${exportId}');`,
      totpAt
    );
  const events = (id) =>
    q(
      `select coalesce(string_agg(action,',' order by occurred_at,action),'') from private.privacy_request_events
        where request_id='${id}' and action in('export_prepared','export_refused','exported');`
    );
  const exportedJobs = (id) =>
    count(`private.privacy_notice_jobs where request_id='${id}' and kind='exported'`);
  const notices = (who) =>
    count(`private.notifications where account_id='${who.id}' and kind='privacy_export_made'`);

  // ------------------------------------------------------------ before
  await check("before the update: only the old export command exists", () => {
    assert.equal(bodyMd5(OLD_EXPORT), "939737e433fcf800d5e98a3dd1569e5d");
    for (const signature of SIGNATURES) assert.equal(bodyMd5(signature), "missing", signature);
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
      "privacy export confirm: update not applied; exports recorded: 0; export emails waiting: 0"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(`select pg_get_functiondef('${OLD_EXPORT}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${OLD_EXPORT}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[0][1], /unexpected state/);
    assert.ok(rows[1][1].startsWith(`${OLD_EXPORT} is not the reviewed body`), rows[1][1]);
    assert.match(fails(step.sql, "55000"), /privacy export confirm drift/);
    q(`${live};`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  const before = fingerprint();
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "privacy export confirm",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^privacy export confirm: already applied; exports recorded: 0; export emails waiting: 0; prepared: 0; confirmed: 0$/,
  });
  const after = fingerprint();
  await check("the new commands are staff commands only", () => {
    const grants = executeGrants(json, SIGNATURES);
    for (const signature of SIGNATURES)
      assert.deepEqual(
        grants[signature],
        { anon: false, authenticated: true, service_role: false },
        signature
      );
  });
  await check("re-running the update compares definitions, not only names", () => {
    const refusedRerun = (problem) => {
      assert.match(fails(step.sql, "55000"), /not the reviewed definition/);
      const rows = preflight();
      assert.ok(
        rows.some((r) => r[0] === "problem" && r[1].startsWith(problem)),
        JSON.stringify(rows)
      );
    };
    // A non-unique index of the same name.
    q(`drop index private.privacy_events_export_idx;
      create index privacy_events_export_idx on private.privacy_request_events (export_id, action) where export_id is not null;`);
    refusedRerun("index privacy_events_export_idx");
    q(`drop index private.privacy_events_export_idx;
      create unique index privacy_events_export_idx on private.privacy_request_events (export_id, action) where export_id is not null;`);
    // A changed check.
    const checkDef = q(
      `select pg_get_constraintdef(oid) from pg_constraint where conname='privacy_request_events_export_check';`
    );
    q(`alter table private.privacy_request_events drop constraint privacy_request_events_export_check,
      add constraint privacy_request_events_export_check check (true);`);
    refusedRerun("check privacy_request_events_export_check");
    q(`alter table private.privacy_request_events drop constraint privacy_request_events_export_check,
      add constraint privacy_request_events_export_check ${checkDef};`);
    // A new command made security invoker, or executable by the service role.
    q(
      `alter function internal.confirm_frontend_privacy_export(uuid,integer,uuid) security invoker;`
    );
    refusedRerun("settings internal.confirm_frontend_privacy_export");
    q(
      `alter function internal.confirm_frontend_privacy_export(uuid,integer,uuid) security definer;`
    );
    q(
      `grant execute on function api.prepare_frontend_privacy_export(uuid,integer) to service_role;`
    );
    refusedRerun("settings api.prepare_frontend_privacy_export");
    q(
      `revoke execute on function api.prepare_frontend_privacy_export(uuid,integer) from service_role;`
    );
    // Without the check: a partial state.
    q(
      `alter table private.privacy_request_events drop constraint privacy_request_events_export_check;`
    );
    assert.match(fails(step.sql, "55000"), /8 of 9 objects exist/);
    q(
      `alter table private.privacy_request_events add constraint privacy_request_events_export_check ${checkDef};`
    );
    assert.equal(fingerprint(), after);
    // A changed function the update relies on is refused too.
    const signal = "internal.signal_owner_inbox(uuid)";
    const live = q(`select pg_get_functiondef('${signal}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${signal}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    assert.match(fails(step.sql, "55000"), /relies on is not the reviewed body/);
    assert.ok(preflight().some((r) => r[1].startsWith(`${signal} is not the reviewed body`)));
    q(`${live};`);
    // A changed completion of the email job (the re-arm relies on it).
    const complete = "internal.complete_frontend_privacy_notice(uuid,uuid,boolean)";
    const liveComplete = q(`select pg_get_functiondef('${complete}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${complete}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    assert.match(fails(step.sql, "55000"), /relies on is not the reviewed body/);
    assert.ok(preflight().some((r) => r[1].startsWith(`${complete} is not the reviewed body`)));
    q(`${liveComplete};`);
    // Any trigger or rule on the email jobs.
    q(`create function vmtest.keep_job() returns trigger language plpgsql as $$begin return new; end$$;
      create trigger keep_job before update on private.privacy_notice_jobs for each row execute function vmtest.keep_job();`);
    assert.match(fails(step.sql, "55000"), /privacy_notice_jobs has a trigger or rule/);
    assert.ok(
      preflight().some((r) => /privacy_notice_jobs has a trigger or rule/.test(r[1])),
      JSON.stringify(preflight())
    );
    q(`drop trigger keep_job on private.privacy_notice_jobs; drop function vmtest.keep_job();`);
    // Any trigger or rule on private.notifications but its update guard.
    const unreviewed = /unreviewed trigger or rule/;
    q(`create function vmtest.keep_notice() returns trigger language plpgsql as $$begin return new; end$$;
      create trigger keep_notice before insert on private.notifications for each row execute function vmtest.keep_notice();`);
    assert.match(fails(step.sql, "55000"), unreviewed);
    assert.ok(
      preflight().some((r) => unreviewed.test(r[1])),
      JSON.stringify(preflight())
    );
    q(`drop trigger keep_notice on private.notifications;
      create rule keep_notice as on insert to private.notifications do also notify vm_test_notice;`);
    assert.match(fails(step.sql, "55000"), unreviewed);
    q(`drop rule keep_notice on private.notifications;
      alter table private.notifications disable trigger notification_guard;`);
    assert.match(fails(step.sql, "55000"), unreviewed);
    q(`alter table private.notifications enable trigger notification_guard;
      drop function vmtest.keep_notice();`);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after);
  });
  await check("the rollback clears a partial state and refuses after a later change", () => {
    const confirmFn = "internal.confirm_frontend_privacy_export(uuid,integer,uuid)";
    const retention = "internal.retention_privacy_requests(integer)";
    for (const signature of [confirmFn, OLD_EXPORT, retention]) {
      const live = q(`select pg_get_functiondef('${signature}'::regprocedure);`);
      q(
        `do $$begin execute replace(pg_get_functiondef('${signature}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
      );
      assert.match(fails(ROLLBACK, "55000"), /rollback precondition/, signature);
      q(`${live};`);
    }
    assert.equal(fingerprint(), after);
    // Half removed: the rollback still clears the rest.
    q(`drop function api.confirm_frontend_privacy_export(uuid,integer,uuid);
      drop index private.privacy_events_export_idx;`);
    assert.ok(
      preflight().some((r) => r[1] === "only part of the update is present"),
      JSON.stringify(preflight())
    );
    applySteps(database, [{ label: "rollback from a partial state", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before);
    assert.equal(bodyMd5(OLD_EXPORT), "939737e433fcf800d5e98a3dd1569e5d");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after);
  });

  // -------------------------------------------------------------- rules
  /** The requester's own values that must never be in a prepare answer. */
  const personal = (who) => [
    who.id,
    q(`select email from auth.users where id='${who.id}';`),
    q(`select display_name from private.profiles where account_id='${who.id}';`),
  ];
  const digestOf = (exportId) =>
    q(
      `select coalesce(export_digest,'none') from private.privacy_request_events where export_id='${exportId}' and action='export_prepared';`
    );
  /** `n` notifications for `who`, enough to make the export too large. */
  const flood = (who, n = 2600) =>
    q(`insert into private.notifications(account_id,kind,subject_id)
      select '${who.id}','trial_started',gen_random_uuid() from generate_series(1,${n});`);
  const unflood = (who) =>
    q(`delete from private.notifications where account_id='${who.id}' and kind='trial_started';`);

  await check("prepare answers dataset names only: no personal data, digest or counts", () => {
    const requester = user("names-only");
    const id = approved(requester);
    const plan = json(prepare(admin, id));
    assert.deepEqual(Object.keys(plan).sort(), [
      "account_found",
      "datasets",
      "due_by",
      "export_id",
      "received_at",
      "reference",
      "request_id",
      "request_type",
    ]);
    assert.equal(plan.request_id, id);
    assert.match(plan.export_id, /^[0-9a-f-]{36}$/);
    assert.equal(plan.account_found, true);
    assert.ok(Array.isArray(plan.datasets));
    assert.equal(plan.datasets.length, 42);
    assert.ok(plan.datasets.every((name) => typeof name === "string"));
    const text = JSON.stringify(plan);
    for (const value of personal(requester)) assert.ok(!text.includes(value), value);
    // The digest stays in the database.
    const digest = digestOf(plan.export_id);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.ok(!text.includes(digest));
    // The website refuses it and never confirms: only the staff audit exists.
    assert.equal(events(id), "export_prepared");
    assert.equal(exportedJobs(id), 0);
    assert.equal(notices(requester), 0);
  });
  await check("the data comes only with the confirmation, which tells the member", () => {
    const requester = user("confirmed");
    const id = approved(requester);
    const plan = json(prepare(admin, id));
    const delivered = json(confirm(admin, id, plan.export_id));
    assert.equal(delivered.request_id, id);
    assert.equal(delivered.export_id, plan.export_id);
    assert.equal(delivered.account_found, true);
    assert.deepEqual(Object.keys(delivered.datasets).sort(), [...plan.datasets].sort());
    assert.equal(delivered.datasets.profile[0].account_id, requester.id);
    assert.equal(delivered.datasets.account[0].email, personal(requester)[1]);
    assert.equal(events(id), "export_prepared,exported");
    assert.equal(exportedJobs(id), 1);
    assert.equal(notices(requester), 1);
    const bell = json(member(requester, "select api.list_my_frontend_notices(50,false,null);"));
    assert.ok(
      bell.items.some((n) => n.kind === "privacy_export_made"),
      JSON.stringify(bell.items.map((n) => n.kind))
    );
    // Confirming the same export again is refused and changes nothing.
    fails(confirm(admin, id, plan.export_id), "PT409", /export already confirmed/);
    assert.equal(events(id), "export_prepared,exported");
    assert.equal(notices(requester), 1);
    // Every confirmed export adds a notice; the email stays once per request.
    const second = json(prepare(governor, id)).export_id;
    json(confirm(governor, id, second));
    assert.equal(events(id), "export_prepared,exported,export_prepared,exported");
    assert.equal(exportedJobs(id), 1);
    assert.equal(notices(requester), 2);
  });
  await check("a changed or too large export is refused, recorded and spent", () => {
    const requester = user("changed");
    const id = approved(requester);
    const plan = json(prepare(admin, id));
    q(
      `update private.profiles set bio='Changed after the export was prepared' where account_id='${requester.id}';`
    );
    assert.deepEqual(json(confirm(admin, id, plan.export_id)), {
      request_id: id,
      export_id: plan.export_id,
      refused: "changed",
    });
    assert.equal(events(id), "export_prepared,export_refused");
    assert.equal(exportedJobs(id), 0);
    assert.equal(notices(requester), 0);
    // That export id cannot be confirmed any more.
    fails(confirm(admin, id, plan.export_id), "PT409", /prepared export refused/);
    // Too large when confirmed.
    const large = json(prepare(admin, id));
    flood(requester);
    assert.equal(json(confirm(admin, id, large.export_id)).refused, "too_large");
    // Too large when prepared: answered, not raised, and recorded.
    const refusedPrepare = json(prepare(admin, id));
    assert.deepEqual(Object.keys(refusedPrepare).sort(), ["export_id", "refused", "request_id"]);
    assert.equal(refusedPrepare.refused, "too_large");
    assert.equal(
      events(id),
      "export_prepared,export_refused,export_prepared,export_refused,export_refused"
    );
    unflood(requester);
    assert.equal(notices(requester), 0);
    // Prepared again, it is delivered with the change.
    const again = json(prepare(admin, id));
    const delivered = json(confirm(admin, id, again.export_id));
    assert.equal(delivered.datasets.profile[0].bio, "Changed after the export was prepared");
    assert.equal(notices(requester), 1);
  });
  await check("parallel confirmations of one export deliver it once and notify once", async () => {
    const requester = user("parallel");
    const id = approved(requester);
    const exportId = json(prepare(admin, id)).export_id;
    const revision = privacy(id).revision;
    const call = `select api.confirm_frontend_privacy_export('${id}',${revision},'${exportId}')`;
    // The first holds its transaction open; the second starts meanwhile and
    // waits for it.
    const [first, second] = await Promise.all([
      session(staff(admin, `begin;\n${call};\nselect pg_sleep(2);\ncommit;`)),
      delayed(500, staff(admin, `${call};`)),
    ]);
    const outcomes = [first, second].map((r) => (r.status === 0 ? "delivered" : "refused"));
    assert.deepEqual(outcomes.sort(), ["delivered", "refused"], first.stderr + second.stderr);
    const refused = first.status === 0 ? second : first;
    assert.match(refused.stderr, /PT409: export already confirmed/);
    assert.equal(events(id), "export_prepared,exported");
    assert.equal(exportedJobs(id), 1);
    assert.equal(notices(requester), 1);
  });
  await check("only the preparing staff member, same revision, within 15 minutes", () => {
    const requester = user("rules");
    const id = approved(requester);
    const { export_id: exportId } = json(prepare(admin, id));
    const revision = privacy(id).revision;
    fails(confirm(governor, id, exportId), "PT409", /prepared export required/);
    fails(confirm(admin, id, crypto.randomUUID()), "PT409", /prepared export required/);
    fails(confirm(admin, id, exportId, undefined, revision + 1), "PT409");
    fails(confirm(moderator, id, exportId), "42501", /capability not granted/);
    fails(confirm(admin, id, exportId, stale()), "42501", RECENT);
    fails(
      member(
        requester,
        `select api.confirm_frontend_privacy_export('${id}',${revision},'${exportId}');`
      ),
      "42501"
    );
    fails(
      service(`select api.confirm_frontend_privacy_export('${id}',${revision},'${exportId}');`),
      "42501"
    );
    fails(
      member(requester, `select api.prepare_frontend_privacy_export('${id}',${revision});`),
      "42501"
    );
    // The export of another request cannot confirm this one.
    const other = approved(user("other"));
    const otherExport = json(prepare(admin, other)).export_id;
    fails(confirm(admin, id, otherExport), "PT409", /prepared export required/);
    // Too late: prepared more than 15 minutes ago.
    q(`update private.privacy_request_events set occurred_at=occurred_at-interval '16 minutes'
      where export_id='${exportId}';`);
    fails(confirm(admin, id, exportId), "PT409", /prepared export expired/);
    assert.equal(events(id), "export_prepared");
    assert.equal(exportedJobs(id), 0);
    assert.equal(notices(requester), 0);
  });
  await check("confirm repeats the self-export rule", () => {
    const own = json(
      service(
        `select api.record_frontend_privacy_request('${governor.id}','${governor.session}','access','Fixture Staff','0123','Own access request');`
      )
    ).id;
    for (const action of ["verify_identity", "approve"])
      q(
        staff(
          admin,
          `select api.process_frontend_privacy_request('${own}',${privacy(own).revision},'${action}');`
        )
      );
    fails(prepare(governor, own), "42501", /another staff member/);
    // A preparation in the governor's name (as if the rule had changed in
    // between) still cannot be confirmed by them.
    const exportId = crypto.randomUUID();
    q(`insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id,export_digest)
      values('${own}','${governor.id}','export_prepared',${privacy(own).revision},'${exportId}','${"c".repeat(64)}');`);
    fails(confirm(governor, own, exportId), "42501", /another staff member/);
    assert.equal(
      count(`private.privacy_request_events where request_id='${own}' and action='exported'`),
      0
    );
  });
  await check("exports only while open, or shortly after completion (696 hours)", () => {
    const requester = user("window");
    const id = approved(requester);
    json(confirm(admin, id, json(prepare(admin, id)).export_id));
    q(
      staff(
        admin,
        `select api.process_frontend_privacy_request('${id}',${privacy(id).revision},'complete');`
      )
    );
    assert.equal(privacy(id).status, "completed");
    // Completed recently: still exportable.
    const recent = json(prepare(admin, id)).export_id;
    // Completed 31 days ago, or minimised: not any more, nor confirmable.
    q(
      `update private.privacy_requests set completed_at=now()-interval '721 hours' where id='${id}';`
    );
    fails(prepare(admin, id), "PT409", /represented verified access request required/);
    fails(confirm(admin, id, recent), "PT409", /represented verified access request required/);
    q(
      `update private.privacy_requests set completed_at=now(), minimised_at=now() where id='${id}';`
    );
    fails(prepare(admin, id), "PT409", /represented verified access request required/);
    assert.equal(notices(requester), 1);
  });
  await check("limits: 10 builds an hour per staff member, 5 confirmed exports a request", () => {
    const requester = user("limits");
    const id = approved(requester);
    fails(prepare(admin, id, stale()), "42501", RECENT);
    fails(prepare(moderator, id), "42501", /capability not granted/);
    fails(
      staff(
        admin,
        `select api.prepare_frontend_privacy_export('${id}',${privacy(id).revision + 1});`
      ),
      "PT409",
      /represented verified access request required/
    );
    assert.equal(events(id), "");
    // Refused builds count: 2 too large, 8 prepared.
    flood(requester);
    for (let i = 0; i < 2; i += 1) assert.equal(json(prepare(admin, id)).refused, "too_large");
    unflood(requester);
    for (let i = 0; i < 8; i += 1) json(prepare(admin, id));
    fails(prepare(admin, id), "PT429", /export preparation limit reached/);
    // Another staff member is not limited by it; an hour later neither is
    // the first.
    json(prepare(governor, id));
    q(`update private.privacy_request_events set occurred_at=occurred_at-interval '61 minutes'
      where request_id='${id}' and actor_id='${admin.id}';`);
    json(prepare(admin, id));
    // At most 5 confirmed exports of one request, the old command's included.
    q(staff(admin, `select api.export_frontend_privacy_request('${id}',${privacy(id).revision});`));
    for (let i = 0; i < 4; i += 1) json(confirm(admin, id, json(prepare(admin, id)).export_id));
    assert.equal(
      count(`private.privacy_request_events where request_id='${id}' and action='exported'`),
      5
    );
    fails(prepare(governor, id), "PT429", /export limit for this request reached/);
    assert.equal(notices(requester), 5);
  });
  /** An export of request `id` by `who` through the old command. */
  const oldExport = (who, id) =>
    staff(who, `select api.export_frontend_privacy_request('${id}',${privacy(id).revision});`);
  await check("the old command: same requests, limits and notices as the new path", () => {
    const requester = user("old-command");
    const id = approved(requester);
    const first = json(oldExport(admin, id));
    assert.equal(first.request_id, id);
    assert.equal("export_id" in first, false);
    json(oldExport(admin, id));
    assert.equal(events(id), "exported,exported");
    assert.equal(exportedJobs(id), 1);
    assert.equal(notices(requester), 2);
    // 5 exports per request, counted with the new path.
    for (let i = 0; i < 3; i += 1) json(confirm(admin, id, json(prepare(admin, id)).export_id));
    fails(oldExport(governor, id), "PT429", /export limit for this request reached/);
    assert.equal(notices(requester), 5);
    // 10 an hour per staff member and request (checked before the 5).
    const hourly = approved(user("old-hourly"));
    q(`insert into private.privacy_request_events(request_id,actor_id,action,represented_revision)
      select '${hourly}','${admin.id}','exported',${privacy(hourly).revision} from generate_series(1,10);`);
    fails(oldExport(admin, hourly), "PT429", /export limit reached/);
    // Not after the request is closed out.
    const closed = approved(user("old-closed"));
    q(
      staff(
        admin,
        `select api.process_frontend_privacy_request('${closed}',${privacy(closed).revision},'complete');`
      )
    );
    q(
      `update private.privacy_requests set completed_at=now()-interval '721 hours' where id='${closed}';`
    );
    fails(oldExport(admin, closed), "PT409", /represented verified access request required/);
  });
  await check("an export whose bell notice is dropped is aborted as a whole", () => {
    const requester = user("dropped-notice");
    const id = approved(requester);
    q(`create function vmtest.drop_notice() returns trigger language plpgsql as $$begin return null; end$$;
      create trigger drop_notice before insert on private.notifications for each row execute function vmtest.drop_notice();`);
    try {
      const exportId = json(prepare(admin, id)).export_id;
      fails(confirm(admin, id, exportId), "55000", /export notice could not be recorded/);
      fails(oldExport(admin, id), "55000", /export notice could not be recorded/);
      assert.equal(events(id), "export_prepared");
      assert.equal(exportedJobs(id), 0);
    } finally {
      q(`drop trigger drop_notice on private.notifications; drop function vmtest.drop_notice();`);
    }
  });
  await check("members who cannot sign in are emailed on every export", () => {
    const job = (id) =>
      json(`select jsonb_build_object('delivered',delivered_at is not null,'attempts',attempts)
        from private.privacy_notice_jobs where request_id='${id}' and kind='exported';`);
    const deliver = (id) =>
      q(
        `update private.privacy_notice_jobs set delivered_at=now(),attempts=1 where request_id='${id}' and kind='exported';`
      );
    // Signed in: one email per request, a bell notice for each export.
    const active = user("email-active");
    const activeId = approved(active);
    json(confirm(admin, activeId, json(prepare(admin, activeId)).export_id));
    deliver(activeId);
    json(confirm(admin, activeId, json(prepare(admin, activeId)).export_id));
    assert.deepEqual(job(activeId), { delivered: true, attempts: 1 });
    assert.equal(notices(active), 2);
    // Banned (no sign-in): every export arms the email again.
    const banned = user("email-banned");
    const bannedId = approved(banned);
    q(`update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
    json(confirm(admin, bannedId, json(prepare(admin, bannedId)).export_id));
    assert.deepEqual(job(bannedId), { delivered: false, attempts: 0 });
    deliver(bannedId);
    json(oldExport(admin, bannedId));
    assert.deepEqual(job(bannedId), { delivered: false, attempts: 0 });
    // An email still waiting covers the next export; an abandoned one is armed.
    json(confirm(admin, bannedId, json(prepare(admin, bannedId)).export_id));
    assert.deepEqual(job(bannedId), { delivered: false, attempts: 0 });
    q(
      `update private.privacy_notice_jobs set attempts=8 where request_id='${bannedId}' and kind='exported';`
    );
    json(confirm(admin, bannedId, json(prepare(admin, bannedId)).export_id));
    assert.deepEqual(job(bannedId), { delivered: false, attempts: 0 });
    assert.equal(exportedJobs(bannedId), 1);
    assert.equal(notices(banned), 4);
    // No account: the email is the only notice, on every export.
    const intake = json(
      staff(
        admin,
        "select api.record_frontend_privacy_intake('access','nobody-'||gen_random_uuid()||'@example.invalid',null,'Emailed access request','Recorded from the privacy mailbox');"
      )
    ).id;
    for (const action of ["verify_identity", "approve"])
      q(
        staff(
          admin,
          `select api.process_frontend_privacy_request('${intake}',${privacy(intake).revision},'${action}');`
        )
      );
    const plan = json(prepare(admin, intake));
    assert.equal(plan.account_found, false);
    assert.deepEqual(plan.datasets, []);
    assert.deepEqual(json(confirm(admin, intake, plan.export_id)).datasets, {});
    deliver(intake);
    json(confirm(admin, intake, json(prepare(admin, intake)).export_id));
    assert.deepEqual(job(intake), { delivered: false, attempts: 0 });
    assert.equal(count(`private.notifications where subject_id='${intake}'`), 0);
  });
  const NOT_NOTIFIABLE = /The member can't be notified right now, so nothing was exported/;
  /** Refused because the member cannot be told; checks the detail too. */
  const unreachable = (sql) => {
    const stderr = fails(sql, "55000", NOT_NOTIFIABLE);
    assert.match(stderr, /DETAIL:\s+member_not_notifiable/, stderr);
  };
  await check("a member without the bell whose email cannot be delivered is not exported", () => {
    // Banned, and the account's email no longer the request's address.
    const changed = user("email-changed");
    const changedId = approved(changed);
    const early = json(prepare(admin, changedId)).export_id;
    q(`update auth.users set banned_until=now()+interval '1 day',email='moved-'||id||'@example.invalid'
      where id='${changed.id}';`);
    unreachable(prepare(admin, changedId));
    unreachable(confirm(admin, changedId, early));
    unreachable(oldExport(admin, changedId));
    // A soft-deleted account.
    const deleted = user("email-deleted");
    const deletedId = approved(deleted);
    q(`update auth.users set deleted_at=now() where id='${deleted.id}';`);
    unreachable(prepare(admin, deletedId));
    unreachable(oldExport(admin, deletedId));
    for (const [who, id] of [
      [changed, changedId],
      [deleted, deletedId],
    ]) {
      assert.equal(
        count(`private.privacy_request_events where request_id='${id}' and action='exported'`),
        0
      );
      assert.equal(exportedJobs(id), 0);
      assert.equal(notices(who), 0);
    }
    // The same rule as the email job's claim: the banned member with the
    // request's address can be exported (and is emailed).
    assert.equal(
      q(
        `select internal.privacy_notice_deliverable(r) from private.privacy_requests r where r.id='${changedId}';`
      ),
      "f"
    );
    q(`update auth.users set email=(select requester_email from private.privacy_requests where id='${changedId}')
      where id='${changed.id}';`);
    json(confirm(admin, changedId, json(prepare(admin, changedId)).export_id));
    assert.equal(exportedJobs(changedId), 1);
  });

  /** A completed request of a new member, every email so far delivered. */
  const completedRequest = (label, hoursAgo) => {
    const who = user(label);
    const id = approved(who);
    q(
      staff(
        admin,
        `select api.process_frontend_privacy_request('${id}',${privacy(id).revision},'complete');`
      )
    );
    q(`update private.privacy_requests set completed_at=now()-make_interval(hours=>${hoursAgo}) where id='${id}';
      update private.privacy_notice_jobs set delivered_at=now(),attempts=1 where request_id='${id}';`);
    return [who, id];
  };
  const retention = () => json(`select internal.retention_privacy_requests(100);`);
  const minimised = (id) =>
    q(`select minimised_at is not null from private.privacy_requests where id='${id}';`) === "t";
  await check("an export at the end of the window is still emailed before retention", () => {
    // Without an export, retention closes out a completed request at once.
    const [, quiet] = completedRequest("window-quiet", 1);
    retention();
    assert.equal(minimised(quiet), true);
    // The window ends 696 hours after completion, a day before retention's 30 days.
    const [, late] = completedRequest("window-late", 697);
    fails(prepare(admin, late), "PT409", /represented verified access request required/);
    // At 695 hours: a banned member is emailed, and retention keeps the
    // request (and its address) until that email is delivered.
    const [banned, edge] = completedRequest("window-edge", 695);
    q(`update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
    json(confirm(admin, edge, json(prepare(admin, edge)).export_id));
    retention();
    assert.equal(minimised(edge), false);
    assert.equal(
      q(
        `select internal.privacy_notice_deliverable(r) from private.privacy_requests r where r.id='${edge}';`
      ),
      "t"
    );
    // Delivered, but exported less than 24 hours ago: still kept.
    q(
      `update private.privacy_notice_jobs set delivered_at=now(),attempts=1 where request_id='${edge}';`
    );
    retention();
    assert.equal(minimised(edge), false);
    q(`update private.privacy_request_events set occurred_at=occurred_at-interval '25 hours'
      where request_id='${edge}' and action='exported';`);
    retention();
    assert.equal(minimised(edge), true);
    // An email abandoned after 8 attempts no longer holds the request.
    const [abandonedWho, abandoned] = completedRequest("window-abandoned", 1);
    q(`update auth.users set banned_until=now()+interval '1 day' where id='${abandonedWho.id}';`);
    json(confirm(admin, abandoned, json(prepare(admin, abandoned)).export_id));
    q(`update private.privacy_notice_jobs set attempts=8 where request_id='${abandoned}' and kind='exported';
      update private.privacy_request_events set occurred_at=occurred_at-interval '25 hours'
        where request_id='${abandoned}' and action='exported';`);
    q(
      `update private.privacy_requests set completed_at=now()-interval '31 days' where id='${abandoned}';`
    );
    retention();
    assert.equal(minimised(abandoned), true);
  });
  await check("retention and a confirmation never race past each other", async () => {
    // Retention while a confirmation holds the request: left for later.
    const [member1, held] = completedRequest("race-confirm-first", 1);
    const heldExport = json(prepare(admin, held)).export_id;
    const call = `select api.confirm_frontend_privacy_export('${held}',${privacy(held).revision},'${heldExport}')`;
    const [confirmed, swept] = await Promise.all([
      session(staff(admin, `begin;\n${call};\nselect pg_sleep(2);\ncommit;`)),
      delayed(500, `select internal.retention_privacy_requests(100);`),
    ]);
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.equal(swept.status, 0, swept.stderr);
    assert.equal(minimised(held), false);
    retention();
    assert.equal(minimised(held), false, "the export is less than a day old");
    assert.equal(notices(member1), 1);
    // A confirmation while retention holds the request: it then finds the
    // request closed out and refuses; nothing was exported.
    const [member2, closing] = completedRequest("race-retention-first", 1);
    const closingExport = json(prepare(admin, closing)).export_id;
    const [sweeping, refused] = await Promise.all([
      session(
        `begin;\nselect internal.retention_privacy_requests(100);\nselect pg_sleep(2);\ncommit;`
      ),
      delayed(
        500,
        staff(
          admin,
          `select api.confirm_frontend_privacy_export('${closing}',${privacy(closing).revision},'${closingExport}');`
        )
      ),
    ]);
    assert.equal(sweeping.status, 0, sweeping.stderr);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /PT409: represented verified access request required/);
    assert.equal(minimised(closing), true);
    assert.equal(exportedJobs(closing), 0);
    assert.equal(notices(member2), 0);
  });
  await check("an undeliverable export email never holds a request for ever", () => {
    /** Exported now; then made undeliverable by `breakIt`; finally aged past
     * the 24-hour export hold only (well inside the 7-day cap), 31 days
     * after completion: only the delivery rule lets it go. */
    const scenario = (label, setup, breakIt) => {
      const [who, id] = completedRequest(label, 1);
      setup?.(who);
      json(confirm(admin, id, json(prepare(admin, id)).export_id));
      assert.equal(exportedJobs(id), 1, label);
      breakIt(who, id);
      retention();
      assert.equal(minimised(id), false, `${label}: the 24-hour export hold`);
      q(`update private.privacy_request_events set occurred_at=occurred_at-interval '25 hours'
          where request_id='${id}' and action='exported';
        update private.privacy_requests set completed_at=now()-interval '31 days' where id='${id}';`);
      assert.equal(exportedJobs(id), 1, `${label}: its email still waits`);
      retention();
      assert.equal(minimised(id), true, label);
    };
    const moveEmail = (who) =>
      q(`update auth.users set email='moved-'||id||'@example.invalid' where id='${who.id}';`);
    const ban = (who) =>
      q(`update auth.users set banned_until=now()+interval '1 day' where id='${who.id}';`);
    // B1: the email changes while the account can still sign in.
    scenario("undeliverable-b1", null, (who) => moveEmail(who));
    // B2: the account is soft-deleted after the export.
    scenario("undeliverable-b2", null, (who) =>
      q(`update auth.users set deleted_at=now() where id='${who.id}';`)
    );
    // B3: banned, and the email changes after the export.
    scenario("undeliverable-b3", ban, (who) => moveEmail(who));
    // B4: the Auth user is removed, so the request names no account.
    scenario("undeliverable-b4", null, (who, id) => {
      q(`delete from auth.users where id='${who.id}';`);
      assert.equal(privacy(id).subject_user_id, null);
    });
    // A deliverable email that keeps failing holds the request at most 7 days.
    const [, failing] = completedRequest("undeliverable-cap", 1);
    json(confirm(admin, failing, json(prepare(admin, failing)).export_id));
    q(`update private.privacy_notice_jobs set attempts=3 where request_id='${failing}' and kind='exported';
      update private.privacy_request_events set occurred_at=occurred_at-interval '6 days'
        where request_id='${failing}' and action='exported';
      update private.privacy_requests set completed_at=now()-interval '31 days' where id='${failing}';`);
    retention();
    assert.equal(minimised(failing), false, "inside the 7 days");
    q(`update private.privacy_request_events set occurred_at=occurred_at-interval '2 days'
      where request_id='${failing}' and action='exported';`);
    retention();
    assert.equal(minimised(failing), true, "past the 7 days");
  });
  await check("no email job is created that could never run", () => {
    // The account can see its bell, but its email is no longer the request's
    // address: the bell tells it, and no email job is armed.
    const requester = user("bell-no-email");
    const id = approved(requester);
    q(`update auth.users set email='moved-'||id||'@example.invalid' where id='${requester.id}';`);
    json(confirm(admin, id, json(prepare(admin, id)).export_id));
    json(oldExport(admin, id));
    assert.equal(exportedJobs(id), 0);
    assert.equal(notices(requester), 2);
  });
  await check("an email the worker already claimed is sent again for a later export", () => {
    const banned = user("in-flight");
    const id = approved(banned);
    q(`update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
    json(confirm(admin, id, json(prepare(admin, id)).export_id));
    // The worker claims export 1's email ...
    const claimed = json(`update private.privacy_notice_jobs set claim_token=gen_random_uuid(),
        locked_until=now()+interval '90 seconds',attempts=attempts+1
      where request_id='${id}' and kind='exported' returning jsonb_build_object('id',id,'claim',claim_token);`);
    // ... staff confirm export 2 ...
    json(confirm(admin, id, json(prepare(admin, id)).export_id));
    // ... and the worker's completion of the old claim no longer counts.
    assert.equal(
      q(
        service(
          `select api.complete_frontend_privacy_notice('${claimed.id}','${claimed.claim}',true);`
        )
      ),
      "f"
    );
    assert.equal(
      q(`select delivered_at is null and claim_token is null and attempts=0 from private.privacy_notice_jobs
        where id='${claimed.id}';`),
      "t"
    );
    assert.equal(notices(banned), 2);
  });
  await check("a later export re-arms a part-tried email with all its tries", () => {
    const banned = user("part-tried");
    const id = approved(banned);
    q(`update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
    json(confirm(admin, id, json(prepare(admin, id)).export_id));
    // Seven tries used, the next one due in an hour.
    q(`update private.privacy_notice_jobs set attempts=7,next_attempt_at=now()+interval '1 hour'
      where request_id='${id}' and kind='exported';`);
    const due = q(
      `select next_attempt_at from private.privacy_notice_jobs where request_id='${id}' and kind='exported';`
    );
    json(confirm(admin, id, json(prepare(admin, id)).export_id));
    assert.deepEqual(
      json(`select jsonb_build_object('attempts',attempts,'delivered',delivered_at is not null,
          'same_time',next_attempt_at='${due}'::timestamptz)
        from private.privacy_notice_jobs where request_id='${id}' and kind='exported';`),
      { attempts: 0, delivered: false, same_time: true }
    );
    assert.equal(exportedJobs(id), 1);
  });
  await check("no email job is created for an address that cannot be emailed", () => {
    // The Auth user removed before the export: the request names no account
    // and its address is not deliverable; the export (no personal data) goes
    // ahead with no email job and no notice.
    const gone = user("auth-removed");
    const goneId = approved(gone);
    q(`delete from auth.users where id='${gone.id}';`);
    assert.equal(privacy(goneId).subject_user_id, null);
    const plan = json(prepare(admin, goneId));
    assert.equal(plan.account_found, false);
    assert.deepEqual(json(confirm(admin, goneId, plan.export_id)).datasets, {});
    assert.equal(exportedJobs(goneId), 0);
    assert.equal(count(`private.notifications where subject_id='${goneId}'`), 0);
    // A request with no account and a reviewed address is still emailed.
    const intake = json(
      staff(
        admin,
        "select api.record_frontend_privacy_intake('access','nobody-'||gen_random_uuid()||'@example.invalid',null,'Emailed access request','Recorded from the privacy mailbox');"
      )
    ).id;
    for (const action of ["verify_identity", "approve"])
      q(
        staff(
          admin,
          `select api.process_frontend_privacy_request('${intake}',${privacy(intake).revision},'${action}');`
        )
      );
    json(confirm(admin, intake, json(prepare(admin, intake)).export_id));
    assert.equal(exportedJobs(intake), 1);
  });
  await check(
    "a confirmation committed in the middle of a sweep is seen before minimising",
    async () => {
      // Deterministic. For this check only, retention runs as a role without
      // row-security bypass, and a row-security policy makes that role wait,
      // while the sweep reads the target request, on an advisory lock the
      // test holds. The confirmation starts only once pg_locks shows the
      // sweep waiting for that lock (its statement snapshot already taken),
      // and commits; only then is the lock released.
      const [requester, target] = completedRequest("race-mid-sweep", 695);
      const exportId = json(prepare(admin, target)).export_id;
      const RETENTION = "internal.retention_privacy_requests(integer)";
      const TABLES = [
        "private.privacy_request_events",
        "private.privacy_notice_jobs",
        "private.account_erasure_requests",
        "private.account_erasures",
      ];
      q(`create role vm_sweeper nologin nobypassrls;
        grant usage on schema private, internal, auth, vmtest to vm_sweeper;
        grant select, insert, update, delete on all tables in schema private to vm_sweeper;
        grant select on auth.users to vm_sweeper;
        grant execute on function internal.privacy_notice_deliverable(private.privacy_requests) to vm_sweeper;
        create table vmtest.sweep_gate_target(id uuid primary key);
        insert into vmtest.sweep_gate_target values('${target}');
        grant select on vmtest.sweep_gate_target to vm_sweeper;
        create function vmtest.sweep_gate(p_id uuid) returns boolean language plpgsql volatile as $$
        begin
          if exists(select 1 from vmtest.sweep_gate_target t where t.id=p_id) then
            perform pg_advisory_xact_lock_shared(424242);
          end if;
          return true;
        end$$;
        grant execute on function vmtest.sweep_gate(uuid) to vm_sweeper;
        create policy vm_sweep_gate on private.privacy_requests for all to vm_sweeper
          using (vmtest.sweep_gate(id)) with check (true);
        ${TABLES.map((t) => `create policy vm_sweeper_all on ${t} for all to vm_sweeper using (true) with check (true);`).join("\n")}
        alter function ${RETENTION} owner to vm_sweeper;`);
      const call = `select api.confirm_frontend_privacy_export('${target}',${privacy(target).revision},'${exportId}')`;
      const epoch = "select extract(epoch from clock_timestamp());";
      /** Advisory lock 424242 holders: "granted" or "waiting". */
      const gateLocks = (granted) =>
        Number(
          q(`select count(*) from pg_locks where locktype='advisory' and classid=0 and objid=424242
            and objsubid=1 and granted=${granted};`)
        );
      const until = async (label, test) => {
        for (let i = 0; i < 300; i += 1) {
          if (test()) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`timed out waiting: ${label}`);
      };
      q(`create table vmtest.sweep_gate_release(released boolean);`);
      try {
        // The gate holds the lock until the test writes the release row.
        const gate = session(`select pg_advisory_lock(424242);
          do $$begin
            for i in 1..600 loop
              exit when exists(select 1 from vmtest.sweep_gate_release);
              perform pg_sleep(0.05);
            end loop;
          end$$;
          ${epoch}
          select pg_advisory_unlock(424242);`);
        await until("the gate holds the lock", () => gateLocks(true) === 1);
        // The sweep starts, takes its snapshot and waits at the gate.
        const sweep = session(`${epoch}\nselect internal.retention_privacy_requests(100);`);
        await until("the sweep waits at the gate", () => gateLocks(false) === 1);
        // Only now the confirmation runs and commits.
        const confirmed = await session(staff(admin, `begin;\n${call};\n${epoch}\ncommit;`));
        assert.equal(confirmed.status, 0, confirmed.stderr);
        assert.equal(gateLocks(false), 1, "the sweep still waits");
        q(`insert into vmtest.sweep_gate_release values(true);`);
        const [gateDone, swept] = await Promise.all([gate, sweep]);
        assert.equal(gateDone.status, 0, gateDone.stderr);
        assert.equal(swept.status, 0, swept.stderr);
        const released = Number(gateDone.stdout.trim().split("\n").filter(Boolean).at(-2));
        const started = Number(swept.stdout.trim().split("\n")[0]);
        const committed = Number(confirmed.stdout.trim().split("\n").at(-1));
        assert.ok(
          started < committed && committed < released,
          JSON.stringify({ started, committed, released })
        );
        // Statement 2 sees the export: the request is kept.
        assert.equal(minimised(target), false);
        assert.equal(exportedJobs(target), 1);
        assert.equal(notices(requester), 1);
      } finally {
        q(`alter function ${RETENTION} owner to postgres;
          drop policy vm_sweep_gate on private.privacy_requests;
          ${TABLES.map((t) => `drop policy vm_sweeper_all on ${t};`).join("\n")}
          drop function vmtest.sweep_gate(uuid);
          drop table vmtest.sweep_gate_target;
          drop table vmtest.sweep_gate_release;
          drop owned by vm_sweeper;
          drop role vm_sweeper;`);
      }
    }
  );
  await check("retention refuses to run without READ COMMITTED", () => {
    fails(
      `begin isolation level repeatable read;\nselect internal.retention_privacy_requests(1);\nrollback;`,
      "25001",
      /privacy retention needs read committed isolation/
    );
  });
  await check("retention clears the digest of unconfirmed exports a day after expiry", () => {
    const requester = user("retention");
    const id = approved(requester);
    const kept = json(prepare(admin, id)).export_id;
    const confirmedId = json(prepare(admin, id)).export_id;
    json(confirm(admin, id, confirmedId));
    const expired = json(prepare(admin, id)).export_id;
    q(`update private.privacy_request_events set occurred_at=occurred_at-interval '1 day 16 minutes'
      where export_id in ('${expired}','${confirmedId}');`);
    const result = json(`select internal.retention_privacy_requests(100);`);
    assert.ok(result.export_digests_cleared >= 1, JSON.stringify(result));
    assert.equal(digestOf(expired), "none");
    assert.match(digestOf(kept), /^[0-9a-f]{64}$/);
    assert.match(digestOf(confirmedId), /^[0-9a-f]{64}$/);
    fails(confirm(admin, id, expired), "PT409", /prepared export expired/);
  });
  await check("the event log keeps export ids and digests to the export actions", () => {
    const id = approved(user("constraints"));
    const exportId = json(prepare(admin, id)).export_id;
    const insert = (action, exportValue, digestValue = "null") =>
      `insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id,export_digest)
        values('${id}','${admin.id}','${action}',1,${exportValue},${digestValue});`;
    const digest = `'${"b".repeat(64)}'`;
    fails(insert("export_prepared", "null", digest), "23514");
    fails(insert("export_prepared", `'${crypto.randomUUID()}'`, "'not-a-digest'"), "23514");
    fails(insert("export_refused", "null"), "23514");
    fails(insert("export_refused", `'${crypto.randomUUID()}'`, digest), "23514");
    fails(insert("exported", `'${crypto.randomUUID()}'`, digest), "23514");
    fails(insert("submitted", `'${crypto.randomUUID()}'`), "23514");
    fails(insert("submitted", "null", digest), "23514");
    fails(insert("export_prepared", `'${exportId}'`, digest), "23505");
    json(confirm(admin, id, exportId));
    fails(insert("exported", `'${exportId}'`), "23505");
  });
  await check("preflight after the checks counts what happened", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^privacy export confirm: already applied; exports recorded: \d+; export emails waiting: \d+; prepared: [1-9]\d*; confirmed: [1-9]\d*$/
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep prepare and confirm", () => {
      const requester = user("later");
      const id = approved(requester);
      const exportId = json(prepare(admin, id)).export_id;
      assert.equal(notices(requester), 0);
      assert.equal(json(confirm(admin, id, exportId)).datasets.profile.length, 1);
      fails(confirm(admin, id, exportId), "PT409", /export already confirmed/);
      assert.equal(notices(requester), 1);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Privacy export confirm checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
