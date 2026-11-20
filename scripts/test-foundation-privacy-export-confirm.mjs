#!/usr/bin/env node
// Behaviour checks for 20261120191500_privacy_export_confirm.sql: a data
// (access) export leaves the database only together with the member's notice.
// Preparing an export returns dataset names, row counts and a digest, never
// personal data, and tells the member nothing; only the confirmation returns
// the data, after rebuilding it and matching the prepared digest, in the same
// transaction that records the 'exported' event, queues the requester's email
// and adds the bell notice, once. A refused (never confirmed) export leaves no
// 'exported' event, email or notice; a changed export is refused; a second
// confirmation, even a parallel one, is refused and notifies nobody; only the
// preparing staff member can confirm, at the same revision, within 15 minutes;
// preparations are limited per staff member and request per hour. The old
// export command keeps working unchanged (expand step), and the rollback
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
        where request_id='${id}' and action in('export_prepared','exported');`
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
    q(`drop index private.privacy_events_export_idx;
      create index privacy_events_export_idx on private.privacy_request_events (export_id, action) where export_id is not null;`);
    assert.match(fails(step.sql, "55000"), /not the reviewed definition/);
    const rows = preflight();
    assert.ok(
      rows.some((r) => r[0] === "problem" && r[1].startsWith("index privacy_events_export_idx")),
      JSON.stringify(rows)
    );
    q(`drop index private.privacy_events_export_idx;
      create unique index privacy_events_export_idx on private.privacy_request_events (export_id, action) where export_id is not null;`);
    q(`alter table private.privacy_request_events drop constraint privacy_request_events_export_check,
      add constraint privacy_request_events_export_check check (true);`);
    assert.match(fails(step.sql, "55000"), /not the reviewed definition/);
    assert.ok(
      preflight().some((r) => r[1].startsWith("check privacy_request_events_export_check")),
      "preflight names the changed check"
    );
    q(
      `alter table private.privacy_request_events drop constraint privacy_request_events_export_check;`
    );
    assert.match(fails(step.sql, "55000"), /7 of 8 objects exist/);
    q(`alter table private.privacy_request_events add constraint privacy_request_events_export_check check (case action
      when 'export_prepared' then export_id is not null and export_digest is not null and export_digest ~ '^[0-9a-f]{64}$'
      when 'exported' then export_digest is null
      else export_id is null and export_digest is null end);`);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after);
  });
  await check("the rollback clears a partial state and refuses after a later change", () => {
    // A later change of a new command, or of the old command, is refused.
    const confirmFn = "internal.confirm_frontend_privacy_export(uuid,integer,uuid)";
    for (const signature of [confirmFn, OLD_EXPORT]) {
      const live = q(`select pg_get_functiondef('${signature}'::regprocedure);`);
      q(
        `do $$begin execute replace(pg_get_functiondef('${signature}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
      );
      assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
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
  await check("prepare returns names, counts and a digest, never personal data", () => {
    const requester = user("names-only");
    const id = approved(requester);
    const plan = json(prepare(admin, id));
    assert.deepEqual(Object.keys(plan).sort(), [
      "account_found",
      "datasets",
      "digest",
      "due_by",
      "export_id",
      "received_at",
      "reference",
      "request_id",
      "request_type",
    ]);
    assert.equal(plan.request_id, id);
    assert.match(plan.export_id, /^[0-9a-f-]{36}$/);
    assert.match(plan.digest, /^[0-9a-f]{64}$/);
    assert.equal(plan.account_found, true);
    assert.equal(Object.keys(plan.datasets).length, 42);
    for (const [name, rows] of Object.entries(plan.datasets))
      assert.ok(Number.isInteger(rows) && rows >= 0, `${name}: ${rows}`);
    assert.equal(plan.datasets.profile, 1);
    assert.equal(plan.datasets.account, 1);
    const text = JSON.stringify(plan);
    for (const value of personal(requester)) assert.ok(!text.includes(value), value);
    // The website refuses it and never confirms: only the staff audit exists.
    assert.equal(events(id), "export_prepared");
    assert.equal(
      q(
        `select export_digest from private.privacy_request_events where export_id='${plan.export_id}';`
      ),
      plan.digest
    );
    assert.equal(exportedJobs(id), 0);
    assert.equal(notices(requester), 0);
    json(prepare(admin, id));
    assert.equal(events(id), "export_prepared,export_prepared");
    assert.equal(exportedJobs(id), 0);
    assert.equal(notices(requester), 0);
  });
  await check("the data comes only with the confirmation, which tells the member once", () => {
    const requester = user("confirmed");
    const id = approved(requester);
    const plan = json(prepare(admin, id));
    const delivered = json(confirm(admin, id, plan.export_id));
    assert.equal(delivered.request_id, id);
    assert.equal(delivered.export_id, plan.export_id);
    assert.equal(delivered.account_found, true);
    assert.deepEqual(Object.keys(delivered.datasets).sort(), Object.keys(plan.datasets).sort());
    for (const [name, rows] of Object.entries(delivered.datasets))
      assert.equal(rows.length, plan.datasets[name], name);
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
    assert.equal(exportedJobs(id), 1);
    assert.equal(notices(requester), 1);
    // A later, separate export is recorded too, but the member is told once.
    const second = json(prepare(governor, id)).export_id;
    json(confirm(governor, id, second));
    assert.equal(events(id), "export_prepared,exported,export_prepared,exported");
    assert.equal(exportedJobs(id), 1);
    assert.equal(notices(requester), 1);
  });
  await check("an export that changed after it was prepared is refused", () => {
    const requester = user("changed");
    const id = approved(requester);
    const plan = json(prepare(admin, id));
    q(
      `update private.profiles set bio='Changed after the export was prepared' where account_id='${requester.id}';`
    );
    fails(confirm(admin, id, plan.export_id), "PT409", /export changed since it was prepared/);
    assert.equal(events(id), "export_prepared");
    assert.equal(exportedJobs(id), 0);
    assert.equal(notices(requester), 0);
    // Prepared again, it is delivered with the change.
    const again = json(prepare(admin, id));
    assert.notEqual(again.digest, plan.digest);
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
    // waits on the first's row.
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
  await check("prepare keeps the old command's rules and limits repeated builds", () => {
    const requester = user("prepare-rules");
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
    // At most 10 preparations per staff member and request per hour.
    for (let i = 0; i < 10; i += 1) json(prepare(admin, id));
    fails(prepare(admin, id), "PT429", /export preparation limit reached/);
    assert.equal(
      count(`private.privacy_request_events where request_id='${id}' and action='export_prepared'`),
      10
    );
    json(prepare(governor, id));
    q(`update private.privacy_request_events set occurred_at=occurred_at-interval '61 minutes'
      where request_id='${id}' and actor_id='${admin.id}';`);
    json(prepare(admin, id));
    // Staff never export a request of their own.
    const own = json(
      service(
        `select api.record_frontend_privacy_request('${governor.id}','${governor.session}','access','Fixture Staff','0123','Own access request');`
      )
    ).id;
    q(
      staff(
        admin,
        `select api.process_frontend_privacy_request('${own}',${privacy(own).revision},'verify_identity');`
      )
    );
    q(
      staff(
        admin,
        `select api.process_frontend_privacy_request('${own}',${privacy(own).revision},'approve');`
      )
    );
    fails(prepare(governor, own), "42501", /another staff member/);
    assert.equal(events(own), "");
  });
  await check("the event log keeps export ids and digests to the two export actions", () => {
    const id = approved(user("constraints"));
    const exportId = json(prepare(admin, id)).export_id;
    const insert = (action, exportValue, digestValue = "null") =>
      `insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id,export_digest)
        values('${id}','${admin.id}','${action}',1,${exportValue},${digestValue});`;
    const digest = `'${"b".repeat(64)}'`;
    fails(insert("export_prepared", "null", digest), "23514");
    fails(insert("export_prepared", `'${crypto.randomUUID()}'`), "23514");
    fails(insert("export_prepared", `'${crypto.randomUUID()}'`, "'not-a-digest'"), "23514");
    fails(insert("exported", `'${crypto.randomUUID()}'`, digest), "23514");
    fails(insert("submitted", `'${crypto.randomUUID()}'`), "23514");
    fails(insert("submitted", "null", digest), "23514");
    fails(insert("export_prepared", `'${exportId}'`, digest), "23505");
    json(confirm(admin, id, exportId));
    fails(insert("exported", `'${exportId}'`), "23505");
  });
  await check("the old export command still works as before (expand step)", () => {
    const requester = user("old-command");
    const id = approved(requester);
    const old = json(
      staff(admin, `select api.export_frontend_privacy_request('${id}',${privacy(id).revision});`)
    );
    assert.equal(old.request_id, id);
    assert.equal("export_id" in old, false);
    assert.equal(events(id), "exported");
    assert.equal(exportedJobs(id), 1);
    assert.equal(notices(requester), 1);
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
