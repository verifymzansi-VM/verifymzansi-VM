#!/usr/bin/env node
// Behaviour checks for 20261120191500_privacy_export_confirm.sql: a data
// (access) export is prepared without telling the member anything, and only
// its confirmation, after the website has checked and handed it over, records
// the 'exported' event, queues the requester's email and adds the bell notice,
// once. A prepared export that is never confirmed (the website refused it)
// leaves no 'exported' event, email or notice; confirming the same export
// twice gives one of each; only the staff member who prepared it can confirm
// it, at the same revision, within 15 minutes. The old export command keeps
// working unchanged (expand step).
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
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "privacy export confirm",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^privacy export confirm: already applied; exports recorded: 0; export emails waiting: 0; prepared: 0; confirmed: 0$/,
  });
  await check("the new commands are staff commands only", () => {
    const grants = executeGrants(json, SIGNATURES);
    for (const signature of SIGNATURES)
      assert.deepEqual(
        grants[signature],
        { anon: false, authenticated: true, service_role: false },
        signature
      );
  });

  // -------------------------------------------------------------- rules
  await check("a prepared export that is never confirmed tells the member nothing", () => {
    const requester = user("refused");
    const id = approved(requester);
    const exported = json(prepare(admin, id));
    assert.equal(exported.request_id, id);
    assert.match(exported.export_id, /^[0-9a-f-]{36}$/);
    assert.equal(exported.account_found, true);
    assert.equal(Object.keys(exported.datasets).length, 42);
    // The website refuses it (for example a dataset it does not know) and
    // never confirms: only the staff audit of the preparation exists.
    assert.equal(events(id), "export_prepared");
    assert.equal(
      count(
        `private.privacy_request_events where request_id='${id}' and action='export_prepared'
          and actor_id='${admin.id}' and export_id='${exported.export_id}'`
      ),
      1
    );
    assert.equal(exportedJobs(id), 0);
    assert.equal(notices(requester), 0);
    // A retried, again refused, export adds nothing for the member either.
    json(prepare(admin, id));
    assert.equal(events(id), "export_prepared,export_prepared");
    assert.equal(exportedJobs(id), 0);
    assert.equal(notices(requester), 0);
  });
  await check("confirming the same export twice gives one event, one email, one notice", () => {
    const requester = user("confirmed");
    const id = approved(requester);
    const { export_id: exportId } = json(prepare(admin, id));
    const first = json(confirm(admin, id, exportId));
    assert.equal(first.request_id, id);
    assert.equal(first.export_id, exportId);
    const again = json(confirm(admin, id, exportId));
    assert.deepEqual(again, first);
    assert.equal(events(id), "export_prepared,exported");
    assert.equal(
      count(
        `private.privacy_request_events where request_id='${id}' and action='exported' and export_id='${exportId}'`
      ),
      1
    );
    assert.equal(exportedJobs(id), 1);
    assert.equal(notices(requester), 1);
    const bell = json(member(requester, "select api.list_my_frontend_notices(50,false,null);"));
    assert.ok(
      bell.items.some((n) => n.kind === "privacy_export_made"),
      JSON.stringify(bell.items.map((n) => n.kind))
    );
    // A later, separate export is recorded too, but the member is told once.
    const later = json(prepare(governor, id)).export_id;
    json(confirm(governor, id, later));
    assert.equal(events(id), "export_prepared,exported,export_prepared,exported");
    assert.equal(exportedJobs(id), 1);
    assert.equal(notices(requester), 1);
    // A confirmed export answers the same even after the 15 minutes.
    q(`update private.privacy_request_events set occurred_at=occurred_at-interval '1 hour'
      where export_id='${exportId}';`);
    assert.equal(json(confirm(admin, id, exportId)).export_id, exportId);
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
  await check("prepare keeps the old command's rules", () => {
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
    assert.equal(events(id), "");
    assert.equal(events(own), "");
  });
  await check("the event log keeps export ids to the two export actions, once each", () => {
    const id = approved(user("constraints"));
    const exportId = json(prepare(admin, id)).export_id;
    const insert = (action, value) =>
      `insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
        values('${id}','${admin.id}','${action}',1,${value});`;
    fails(insert("export_prepared", "null"), "23514");
    fails(insert("submitted", `'${crypto.randomUUID()}'`), "23514");
    fails(insert("export_prepared", `'${exportId}'`), "23505");
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
      json(confirm(admin, id, exportId));
      json(confirm(admin, id, exportId));
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
