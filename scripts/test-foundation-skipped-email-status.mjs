#!/usr/bin/env node
// Behaviour checks for 20261117123240_skipped_email_status.sql: a queued email
// the email job finishes without sending (no address, or a receipt no longer
// due) is stored with the reason 'skipped' and left out of the member's email
// history, instead of being listed as "sent".
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Messages are claimed and finished through the production service
// commands (api.claim_supported_notification_outbox,
// api.complete_notification_outbox) as the email job does, and the history is
// read through api.list_my_email_history as a signed-in member. No email is
// sent. The script shows the problem before the update (and that the website
// passing 'skipped' is safe there), runs the read-only preflight, checks its
// refusals, applies it, checks the skipped, sent and failed paths, and proves
// apply -> rollback -> apply returns the same fingerprints. Any later updates
// are applied at the end.
//
//   node --import tsx scripts/test-foundation-skipped-email-status.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  executeGrants,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261117123240_skipped_email_status.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const COMPLETE = "internal.complete_notification_outbox(uuid,uuid,boolean,text)";
const HISTORY = "internal.list_my_email_history(integer)";
const SIGNATURES = [
  COMPLETE,
  "api.complete_notification_outbox(uuid,uuid,boolean,text)",
  HISTORY,
  "api.list_my_email_history(integer)",
];
const REVIEWED = {
  [COMPLETE]: "a87eff16c79b115b0bb2f385b7e41fa9",
  [HISTORY]: "bae293aa4451ea71502c27863c1cf5e6",
};
const UPDATED = {
  [COMPLETE]: "d0ac8636fcde58e25ca51bef842ea434",
  [HISTORY]: "af3d191eb50ae6e67a6417269ef39876",
};

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
  service,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  // ------------------------------------------------------- synthetic world
  const KIND = "post_deleted";
  /** Queues one email for `user` and claims it as the email job does. */
  const claimed = (user) => {
    const id = q(`insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
        values('${KIND}',gen_random_uuid(),'${user.id}','vmtest:'||gen_random_uuid()) returning id;`);
    const rows = json(
      service(`select api.claim_supported_notification_outbox(array['${KIND}'],50);`)
    );
    const job = rows.find((row) => row.id === id);
    assert.ok(job, `claimed ${id}: ${JSON.stringify(rows)}`);
    return job;
  };
  const completeSql = (job, ok, error) =>
    service(
      `select api.complete_notification_outbox('${job.id}','${job.claim_token}',${ok},${
        error === null ? "null" : `'${error}'`
      });`
    );
  const complete = (job, ok, error) => q(completeSql(job, ok, error));
  const row = (job) =>
    json(`select jsonb_build_object('processed',processed_at is not null,'error',delivery_error,
        'claimed',delivery_claim is not null) from private.outbox_events where id='${job.id}';`);
  const history = (user, limit = 20) =>
    json(member(user, `select api.list_my_email_history(${limit});`)).items;
  const listed = (user, limit) => history(user, limit).map((item) => [item.id, item.status]);

  const early = syntheticMember("skipped-early");
  const before = {};

  // ------------------------------------------------------------ before
  await check("before the update: a skipped email is listed as sent", () => {
    for (const [signature, md5] of Object.entries(REVIEWED))
      assert.equal(bodyMd5(signature), md5, signature);
    // The website from this pull request passes 'skipped': accepted, and the
    // reason is cleared, so nothing breaks before the update.
    before.skipped = claimed(early);
    assert.equal(complete(before.skipped, true, "skipped"), "t");
    assert.deepEqual(row(before.skipped), { processed: true, error: null, claimed: false });
    assert.deepEqual(listed(early), [[before.skipped.id, "sent"]]);
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
      "skipped email status: update not applied; finished emails: 1; marked skipped: 0"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const fingerprintBefore = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), fingerprintBefore);
    for (const signature of [COMPLETE, HISTORY]) {
      const live = q(`select pg_get_functiondef('${signature}'::regprocedure);`);
      // The same function with one more space at the start of its body.
      q(
        `do $$begin execute replace(pg_get_functiondef('${signature}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
      );
      const rows = preflight();
      assert.equal(rows.length, 2, JSON.stringify(rows));
      assert.match(rows[0][1], /^skipped email status: unexpected state;/);
      assert.ok(rows[1][1].startsWith(`${signature} is neither the reviewed body`), rows[1][1]);
      assert.match(fails(step.sql, "55000"), /skipped email status precondition/);
      q(`${live};`);
    }
    assert.equal(fingerprint(), fingerprintBefore);
  });

  // ------------------------------------------------------------- apply
  const grants = executeGrants(json, SIGNATURES);
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "skipped email status",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^skipped email status: already applied; finished emails: 1; marked skipped: 0$/,
  });

  const user = syntheticMember("skipped-member");
  await check("after the update: the bodies are the update's", () => {
    for (const [signature, md5] of Object.entries(UPDATED))
      assert.equal(bodyMd5(signature), md5, signature);
  });
  await check("a skipped email keeps its reason and leaves the history", () => {
    const sent = claimed(user);
    assert.equal(complete(sent, true, null), "t");
    const skipped = claimed(user);
    assert.equal(complete(skipped, true, "skipped"), "t");
    assert.deepEqual(row(skipped), { processed: true, error: "skipped", claimed: false });
    assert.deepEqual(row(sent), { processed: true, error: null, claimed: false });
    assert.deepEqual(listed(user), [[sent.id, "sent"]]);
    // The newest message is skipped: a limit of one still lists the sent one.
    assert.deepEqual(listed(user, 1), [[sent.id, "sent"]]);
    // A finished message is never claimed again.
    assert.deepEqual(
      json(service(`select api.claim_supported_notification_outbox(array['${KIND}'],50);`)),
      []
    );
    assert.match(
      preflight()[0][1],
      /^skipped email status: already applied; finished emails: 3; marked skipped: 1$/
    );
  });
  await check("an email skipped before the update stays listed as sent", () => {
    assert.deepEqual(listed(early), [[before.skipped.id, "sent"]]);
  });
  await check("a skipped email stays hidden whatever its attempts", () => {
    const skipped = claimed(user);
    complete(skipped, true, "skipped");
    q(`update private.outbox_events set delivery_attempts=8 where id='${skipped.id}';`);
    assert.equal(
      listed(user).some(([id]) => id === skipped.id),
      false
    );
  });
  await check("failed attempts are recorded and listed as before", () => {
    const other = syntheticMember("skipped-failures");
    const failing = claimed(other);
    assert.equal(complete(failing, false, "delivery_failed"), "t");
    assert.deepEqual(row(failing), { processed: false, error: "delivery_failed", claimed: false });
    assert.deepEqual(listed(other), [], "not final yet");
    // The last attempt failed and its lease ran out: listed as failed.
    q(`update private.outbox_events set delivery_attempts=8 where id='${failing.id}';`);
    assert.deepEqual(listed(other), [[failing.id, "failed"]]);
    const unknown = claimed(other);
    assert.equal(complete(unknown, false, "outcome_unknown"), "t");
    q(`update private.outbox_events set delivery_attempts=8 where id='${unknown.id}';`);
    assert.deepEqual(listed(other), [[failing.id, "failed"]], "outcome unknown is not listed");
    const given = claimed(other);
    assert.equal(complete(given, false, null), "t");
    assert.equal(row(given).error, "delivery_failed");
  });
  await check("a reason that does not match the outcome is refused, changing nothing", () => {
    const job = claimed(user);
    for (const [ok, error] of [
      [true, "delivery_failed"],
      [true, "outcome_unknown"],
      [false, "skipped"],
      [true, "Skipped"],
      [null, "skipped"],
    ])
      fails(completeSql(job, ok, error), "22023", /invalid outcome/);
    assert.deepEqual(row(job), { processed: false, error: null, claimed: true });
    // A stale lease still acknowledges nothing.
    assert.equal(
      complete({ ...job, claim_token: q("select gen_random_uuid();") }, true, "skipped"),
      "f"
    );
    assert.equal(complete(job, true, "skipped"), "t");
  });
  await check("who may run them is unchanged", () => {
    assert.deepEqual(executeGrants(json, SIGNATURES), grants);
    assert.deepEqual(grants["api.complete_notification_outbox(uuid,uuid,boolean,text)"], {
      anon: false,
      authenticated: false,
      service_role: true,
    });
    assert.deepEqual(grants["api.list_my_email_history(integer)"], {
      anon: false,
      authenticated: true,
      service_role: false,
    });
    for (const signature of [COMPLETE, HISTORY]) {
      const meta =
        json(`select jsonb_build_object('definer',prosecdef,'owner',proowner::regrole::text,'config',proconfig)
          from pg_proc where oid='${signature}'::regprocedure;`);
      assert.deepEqual(meta, {
        definer: true,
        owner: "postgres",
        config: ["search_path=pg_catalog"],
      });
    }
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep skipped emails out of the history", () => {
      const keeper = syntheticMember("skipped-later");
      const skipped = claimed(keeper);
      complete(skipped, true, "skipped");
      const sent = claimed(keeper);
      complete(sent, true, null);
      assert.deepEqual(listed(keeper), [[sent.id, "sent"]]);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Skipped email status checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
