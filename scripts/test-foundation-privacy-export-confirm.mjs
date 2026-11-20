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
// exported while in progress or completed in the last 30 days and not
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
    assert.match(fails(step.sql, "55000"), /7 of 8 objects exist/);
    q(
      `alter table private.privacy_request_events add constraint privacy_request_events_export_check ${checkDef};`
    );
    assert.equal(fingerprint(), after);
    // A changed function the update relies on is refused too.
    const notify = "internal.notify_account(uuid,text,uuid,uuid,uuid)";
    const live = q(`select pg_get_functiondef('${notify}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${notify}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    assert.match(fails(step.sql, "55000"), /relies on is not the reviewed body/);
    assert.ok(preflight().some((r) => r[1].startsWith(`${notify} is not the reviewed body`)));
    q(`${live};`);
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
  await check("exports only while in progress or completed in the last 30 days", () => {
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
      `update private.privacy_requests set completed_at=now()-interval '31 days' where id='${id}';`
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
  await check("the old command notifies on every export and is limited per hour", () => {
    const requester = user("old-command");
    const id = approved(requester);
    const old = () =>
      staff(admin, `select api.export_frontend_privacy_request('${id}',${privacy(id).revision});`);
    const first = json(old());
    assert.equal(first.request_id, id);
    assert.equal("export_id" in first, false);
    json(old());
    assert.equal(events(id), "exported,exported");
    assert.equal(exportedJobs(id), 1);
    assert.equal(notices(requester), 2);
    q(`insert into private.privacy_request_events(request_id,actor_id,action,represented_revision)
      select '${id}','${admin.id}','exported',${privacy(id).revision} from generate_series(1,8);`);
    fails(old(), "PT429", /export limit reached/);
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
