#!/usr/bin/env node
// Behaviour checks for 20261121053224_privacy_export_simple.sql: staff export
// an access request only while it is in progress, identity verified and at
// the stated revision; never their own request; at most 5 times per request,
// also when two exports run at once (LIM-F-export_frontend_privacy_request);
// every export adds a bell notice and the first queues the one email; a too
// large export records nothing; completing the request waits for a running
// export; the rollback restores the previous body exactly.
//
// Replays database/foundation into the throwaway, network-less Postgres 17
// container of the SQL lint gate. Requests are recorded through the production
// service command and handled through the production staff commands, as staff
// with synthetic AAL2 sessions and a verified authenticator app. Any later
// updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-privacy-export-simple.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertDriftRefused,
  assertReadOnlyPreflight,
  executeGrants,
  installStaffPaymentWorld,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import { psqlSessions } from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261121053224_privacy_export_simple.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const EXPORT = "internal.export_frontend_privacy_request(uuid,integer)";
const API_EXPORT = "api.export_frontend_privacy_request(uuid,integer)";
const [MAIN_MD5, NEW_MD5] = [
  "939737e433fcf800d5e98a3dd1569e5d",
  "87d2eed178e199afc407b4236ffed816",
];
const NOT_IN_PROGRESS = /DETAIL:\s+privacy_export_not_in_progress/;
const REPRESENTED = /represented verified access request required/;

const ctx = await openUpdateCheck(PREFLIGHT);
const { started, database, check, current, passed: checks, q, json, fails, member, staff } = ctx;
const { service, fingerprint, bodyMd5, preflightRows: preflight } = ctx;
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const { session, sessionAfter: delayed } = psqlSessions(database);
  const { user, staffUser } = installStaffPaymentWorld(q, json);
  const admin = staffUser("admin", "admin");
  const governor = staffUser("governor", "governor");
  const moderator = staffUser("moderator", "moderator");
  const revision = (id) =>
    json(`select to_jsonb(r) from private.privacy_requests r where r.id='${id}';`).revision;
  const record = (who, type = "access") =>
    json(
      service(
        `select api.record_frontend_privacy_request('${who.id}','${who.session}','${type}','Fixture Member','0123','Synthetic request ${crypto.randomUUID()}');`
      )
    ).id;
  const processSql = (id, action) =>
    `select api.process_frontend_privacy_request('${id}',${revision(id)},'${action}');`;
  const process = (id, ...actions) =>
    actions.forEach((action) => q(staff(admin, processSql(id, action))));
  /** A verified access request of `who`, in progress. */
  const approved = (who) => {
    const id = record(who);
    process(id, "verify_identity", "approve");
    return id;
  };
  const exportSql = (who, id, rev = revision(id), totpAt = undefined) =>
    staff(who, `select api.export_frontend_privacy_request('${id}',${rev});`, totpAt);
  const count = (sql) => Number(q(`select count(*) from ${sql};`));
  const exportsOf = (id) =>
    count(`private.privacy_request_events where request_id='${id}' and action='exported'`);
  const emailsOf = (id) =>
    count(`private.privacy_notice_jobs where request_id='${id}' and kind='exported'`);
  const noticesOf = (who) =>
    count(`private.notifications where account_id='${who.id}' and kind='privacy_export_made'`);
  const nothingRecorded = (id, who) =>
    assert.deepEqual([exportsOf(id), emailsOf(id), noticesOf(who)], [0, 0, 0]);

  // ------------------------------------------------------------ before
  await check("preflight before the update: read only, summary only", () => {
    assert.equal(bodyMd5(EXPORT), MAIN_MD5);
    assert.deepEqual(preflight(), [
      ["summary", "privacy export simple: update not applied; exports recorded: 0"],
    ]);
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () =>
    assertDriftRefused(ctx, {
      rollback: ROLLBACK,
      updateSql: step.sql,
      signatures: [EXPORT],
      drift: /privacy export simple drift/,
    })
  );

  // ------------------------------------------------------------- apply
  const mainDefinition = q(`select pg_get_functiondef('${EXPORT}'::regprocedure);`);
  const grants = executeGrants(json, [EXPORT, API_EXPORT]);
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "privacy export simple",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: /^privacy export simple: already applied; exports recorded: 0$/,
  });
  await check("the rollback restores the previous body exactly; grants unchanged", () => {
    assert.equal(bodyMd5(EXPORT), NEW_MD5);
    assert.deepEqual(executeGrants(json, [EXPORT, API_EXPORT]), grants);
    applySteps(database, [{ label: "rollback", sql: ROLLBACK }]);
    assert.equal(q(`select pg_get_functiondef('${EXPORT}'::regprocedure);`), mainDefinition);
    assert.deepEqual(executeGrants(json, [EXPORT, API_EXPORT]), grants);
    applySteps(database, [step]);
  });

  // ------------------------------------------------------------- rules
  await check("only an in-progress, verified access request at its revision", () => {
    const who = user("states");
    const submitted = record(who);
    process(submitted, "verify_identity");
    fails(exportSql(admin, submitted), "PT409", NOT_IN_PROGRESS);
    const unverified = record(who);
    process(unverified, "approve");
    fails(exportSql(admin, unverified), "PT409", REPRESENTED);
    const rejected = record(who);
    process(rejected, "verify_identity", "reject");
    fails(exportSql(admin, rejected), "PT409", NOT_IN_PROGRESS);
    const deletion = record(who, "deletion");
    process(deletion, "verify_identity", "approve");
    fails(exportSql(admin, deletion), "PT409", REPRESENTED);
    // At most 5 requests an hour per account: the open one is another member's.
    const open = user("states-open");
    const id = approved(open);
    fails(exportSql(admin, id, revision(id) - 1), "PT409", REPRESENTED);
    for (const other of [submitted, unverified, rejected, deletion, id])
      assert.equal(exportsOf(other), 0);
    assert.equal(noticesOf(who) + noticesOf(open), 0);
    assert.equal(json(exportSql(admin, id)).request_id, id);
    process(id, "complete");
    fails(exportSql(admin, id), "PT409", NOT_IN_PROGRESS);
    assert.equal(exportsOf(id), 1);
  });
  await check("staff and second-factor checks as before; never your own request", () => {
    const who = user("staff-checks");
    const id = approved(who);
    fails(exportSql(moderator, id), "42501", /capability not granted/);
    fails(
      exportSql(admin, id, revision(id), Math.floor(Date.now() / 1000) - 20 * 60),
      "42501",
      /recent second-factor/
    );
    fails(
      member(who, `select api.export_frontend_privacy_request('${id}',${revision(id)});`),
      "42501"
    );
    const own = approved(governor);
    fails(exportSql(governor, own), "42501", /another staff member must export your request/);
    nothingRecorded(id, who);
    assert.equal(exportsOf(own), 0);
  });
  await check("5 exports per request, a bell notice for each, one email", () => {
    const who = user("cap");
    const id = approved(who);
    for (let i = 1; i <= 5; i += 1) {
      json(exportSql(i % 2 ? admin : governor, id));
      assert.deepEqual([exportsOf(id), emailsOf(id), noticesOf(who)], [i, 1, i]);
    }
    fails(exportSql(admin, id), "PT429", /DETAIL:\s+privacy_export_limit/);
    assert.deepEqual([exportsOf(id), emailsOf(id), noticesOf(who)], [5, 1, 5]);
  });
  await check("two parallel exports at 4: one succeeds, the cap holds", async () => {
    const who = user("parallel");
    const id = approved(who);
    for (let i = 0; i < 4; i += 1) json(exportSql(admin, id));
    const call = `select api.export_frontend_privacy_request('${id}',${revision(id)})`;
    const [first, second] = await Promise.all([
      session(staff(admin, `begin;\n${call};\nselect pg_sleep(2);\ncommit;`)),
      delayed(500, staff(governor, `${call};`)),
    ]);
    assert.equal(first.status, 0, first.stderr);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /PT429: export limit reached for this request/);
    assert.deepEqual([exportsOf(id), emailsOf(id), noticesOf(who)], [5, 1, 5]);
  });
  await check("a too large export (PT413) records nothing", () => {
    const who = user("large");
    const id = approved(who);
    q(`insert into private.notifications(account_id,kind,subject_id)
      select '${who.id}','trial_started',gen_random_uuid() from generate_series(1,2600);`);
    fails(exportSql(admin, id), "PT413");
    nothingRecorded(id, who);
    q(`delete from private.notifications where account_id='${who.id}' and kind='trial_started';`);
    json(exportSql(admin, id));
    assert.deepEqual([exportsOf(id), emailsOf(id), noticesOf(who)], [1, 1, 1]);
  });
  await check("completing waits for a running export; an export waits for completion", async () => {
    const who = user("completion");
    const id = approved(who);
    const exportCall = `select api.export_frontend_privacy_request('${id}',${revision(id)})`;
    const [exported, completed] = await Promise.all([
      session(staff(admin, `begin;\n${exportCall};\nselect pg_sleep(2);\ncommit;`)),
      delayed(500, staff(governor, processSql(id, "complete"))),
    ]);
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(completed.status, 0, completed.stderr);
    assert.equal(
      q(`select r.completed_at>=e.occurred_at+interval '1 second' from private.privacy_requests r
        join private.privacy_request_events e on e.request_id=r.id and e.action='exported' where r.id='${id}';`),
      "t"
    );
    const next = approved(who);
    const [done, refused] = await Promise.all([
      session(
        staff(admin, `begin;\n${processSql(next, "complete")}\nselect pg_sleep(2);\ncommit;`)
      ),
      delayed(500, exportSql(governor, next)),
    ]);
    assert.equal(done.status, 0, done.stderr);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, NOT_IN_PROGRESS);
    assert.equal(exportsOf(next), 0);
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the export rules", () => {
      const who = user("later");
      const id = approved(who);
      json(exportSql(admin, id));
      assert.deepEqual([exportsOf(id), emailsOf(id), noticesOf(who)], [1, 1, 1]);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Privacy export simple checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
