#!/usr/bin/env node
// Behaviour checks for 20261112080000_payment_problem_alerts.sql: payment
// problems are kept once per payment and reason, staff alerts are leased and
// recorded once, and the daily summary is handed out once a day (M3.3).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members quote plans with the production checkout command (as
// `authenticated` with synthetic claims and a live session row); the website's
// server records problems, claims alerts and summaries as `service_role`.
// "Later" and "earlier" are simulated by moving stored times. The script runs
// the read-only preflight before and after, applies the update, checks every
// command and its refusals, and proves that apply -> rollback -> apply returns
// the schema fingerprint to the same values each time. Any later updates are
// applied at the end and the commands are checked again.
//
//   node --import tsx scripts/test-foundation-payment-alerts.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Members,
// payments and provider journal rows are written directly as the database
// owner where no production command makes them. Nothing contacts Ozow or sends
// email.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  createChecks,
  sqlHelpers,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261112080000_payment_problem_alerts.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const COMMANDS = [
  "record_payment_problem(uuid,text,text,boolean)",
  "claim_payment_alerts(integer)",
  "complete_payment_alerts(uuid)",
  "claim_payment_digest(integer,integer)",
  "complete_payment_digest(uuid)",
];

const { check, current, passed: checks } = createChecks();

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  // ---------------------------------------------------------------- helpers
  const { q, json, fails, member, service } = sqlHelpers(database, current);
  const as = (role, sql) => `set role ${role};\n${sql}`;
  const fingerprint = () => q(`set search_path to pg_catalog;\n${FINGERPRINT}`);
  const preflight = () =>
    q(PREFLIGHT)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));
  const bodyOf = (sig) =>
    q(
      `select coalesce((select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid=to_regprocedure('${sig}')),'missing');`
    );

  // ------------------------------------------------------- synthetic world
  q(`create schema vmtest;
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid);
    end$$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const plan = q(
    "select id from private.plan_versions where plan_code='market_30d' and retired_at is null and is_public order by version desc limit 1;"
  );
  assert.match(plan, /^[0-9a-f-]{36}$/);
  /** A pending payment with an attached Ozow request, as the website makes one. */
  const payment = (label) => {
    const owner = user(label);
    const quoted = json(member(owner, `select api.start_checkout('${plan}',null);`));
    const id = quoted.payment_id;
    const lease = json(service(`select api.claim_checkout_request('${id}','${owner.id}');`));
    assert.equal(
      q(
        service(
          `select api.complete_checkout_request('${id}','${owner.id}','${lease.claim_token}','req-${id}','https://one.ozow.com/checkout/req-${id}');`
        )
      ),
      "t"
    );
    return id;
  };
  const record = (paymentId, reason, source = "notice", alert = false) =>
    json(
      service(
        `select api.record_payment_problem(${paymentId ? `'${paymentId}'` : "null"},'${reason}','${source}',${alert});`
      )
    );
  const row = (paymentId, reason) =>
    json(
      `select coalesce((select jsonb_build_object('source',source,'needs_alert',needs_alert,'occurrences',occurrences,` +
        `'first',first_seen_at,'last',last_seen_at,'alerted',alerted_at is not null) from private.payment_problems ` +
        `where payment_id ${paymentId ? `='${paymentId}'` : "is null"} and reason='${reason}'),'null'::jsonb);`
    );
  const claimAlerts = (limit = 50) => json(service(`select api.claim_payment_alerts(${limit});`));
  const completeAlerts = (claim) =>
    Number(q(service(`select api.complete_payment_alerts('${claim}');`)));
  const claimDigest = (hour = 0, limit = 50) =>
    json(service(`select coalesce(api.claim_payment_digest(${hour},${limit}),'null'::jsonb);`));
  const completeDigest = (claim) => q(service(`select api.complete_payment_digest('${claim}');`));
  /** Lets the lease of `claim` run out, then claims the day's summary again. */
  const claimDigestAfterLease = (claim, limit) => {
    q(
      `update private.payment_problem_digests set claimed_until=clock_timestamp()-interval '1 second' where claim='${claim}';`
    );
    return claimDigest(0, limit);
  };
  const today = () => q("select (clock_timestamp() at time zone 'Africa/Johannesburg')::date;");
  const sastHour = () =>
    Number(q("select extract(hour from clock_timestamp() at time zone 'Africa/Johannesburg');"));
  /** Every marked problem is emailed: nothing is left for the next claim. */
  const drainAlerts = () => {
    q(
      "update private.payment_problems set alerted_at=clock_timestamp(),alert_claimed_until=null where needs_alert and alerted_at is null;"
    );
  };

  // ------------------------------------------------------------ before
  await check("before the update: no commands, preflight reads not applied", () => {
    for (const command of COMMANDS) assert.equal(bodyOf(`api.${command}`), "missing");
    fails(service("select api.claim_payment_alerts(10);"), "42883");
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "payment problem alerts: update not applied (apply before the website release that uses it is deployed); " +
        "paid but not activated: 0; pending with an Ozow request for over 2 hours: 0"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });

  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    q(
      "create function internal.claim_payment_alerts(p_limit integer) returns jsonb language sql set search_path=pg_catalog as $$ select '{}'::jsonb $$;"
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[0][1], /^payment problem alerts: unexpected state;/);
    assert.match(rows[1][1], /internal\.claim_payment_alerts\(integer\) is not the update's body/);
    q("drop function internal.claim_payment_alerts(integer);");
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  const before = fingerprint();
  applySteps(database, [step]);
  const after = fingerprint();

  await check("after the update: preflight reads already applied, with the counts", () => {
    assert.notEqual(after, before);
    const rows = preflight();
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.match(
      rows[0][1],
      /^payment problem alerts: already applied; paid but not activated: 0;/
    );
    for (const table of ["payment_problems", "payment_problem_digests"])
      assert.equal(
        q(`select relrowsecurity from pg_class where oid='private.${table}'::regclass;`),
        "t"
      );
  });

  /** The recording rules. Returns the payments it used. */
  const recording = (label) => {
    const wrong = payment(`${label}-wrong`);
    const first = record(wrong, "amount_mismatch", "notice", true);
    assert.deepEqual({ new: first.new, alert: first.alert }, { new: true, alert: true });
    const firstRow = row(wrong, "amount_mismatch");
    assert.deepEqual(
      { source: firstRow.source, alert: firstRow.needs_alert, n: firstRow.occurrences },
      { source: "notice", alert: true, n: 1 }
    );
    // A repeat, from the status check and unmarked: counted, never lowered.
    q(
      `update private.payment_problems set first_seen_at=first_seen_at-interval '1 minute',last_seen_at=last_seen_at-interval '1 minute' where payment_id='${wrong}';`
    );
    const again = record(wrong, "amount_mismatch", "status_check", false);
    assert.equal(again.id, first.id);
    assert.deepEqual({ new: again.new, alert: again.alert }, { new: false, alert: true });
    const againRow = row(wrong, "amount_mismatch");
    assert.equal(againRow.source, "notice");
    assert.equal(againRow.occurrences, 2);
    assert.ok(Date.parse(againRow.last) > Date.parse(againRow.first), JSON.stringify(againRow));
    // A second transaction: first a declined one (summary only), then a
    // successful one raises the mark.
    const twice = payment(`${label}-twice`);
    assert.equal(record(twice, "transaction_id_mismatch", "notice", false).alert, false);
    assert.equal(row(twice, "transaction_id_mismatch").needs_alert, false);
    assert.equal(record(twice, "transaction_id_mismatch", "notice", true).alert, true);
    assert.equal(row(twice, "transaction_id_mismatch").needs_alert, true);
    // Another reason on the same payment is its own problem.
    assert.equal(record(twice, "multiple_settlements", "status_check", true).new, true);
    // Notices that name no payment: one row per reason, never marked.
    const unknown = row(null, "unknown_payment");
    const noPayment = record(null, "unknown_payment", "notice", true);
    assert.equal(noPayment.alert, false);
    assert.equal(row(null, "unknown_payment").occurrences, (unknown?.occurrences ?? 0) + 1);
    assert.equal(
      q(
        "select count(*) from private.payment_problems where payment_id is null and reason='unknown_payment';"
      ),
      "1"
    );
    return { wrong, twice };
  };

  await check("a problem is kept once per payment and reason; repeats are counted", () => {
    recording("record");
  });

  await check("record refuses anything outside its closed lists and unknown payments", () => {
    const someone = payment("refusals");
    for (const args of [
      `'${someone}','made_up_reason','notice',true`,
      `'${someone}',null,'notice',true`,
      `'${someone}','amount_mismatch','browser',true`,
      `'${someone}','amount_mismatch',null,true`,
      `'${someone}','amount_mismatch','notice',null`,
      `'${someone}','Amount_Mismatch','notice',true`,
    ])
      fails(
        service(`select api.record_payment_problem(${args});`),
        "22023",
        /invalid payment problem/
      );
    fails(
      service(
        `select api.record_payment_problem('${randomUUID()}','amount_mismatch','notice',true);`
      ),
      "22023",
      /payment problem names no payment/
    );
    assert.equal(
      q(`select count(*) from private.payment_problems where payment_id='${someone}';`),
      "0"
    );
  });

  await check("alerts: leased once, recorded once, retried after the lease", () => {
    drainAlerts();
    assert.deepEqual(claimAlerts(), { claim: null, problems: [] });
    const a = payment("alert-a");
    const b = payment("alert-b");
    const quiet = payment("alert-quiet");
    record(a, "amount_mismatch", "notice", true);
    record(b, "complete_unfulfillable_target", "status_check", true);
    record(quiet, "site_code_mismatch", "notice", false);
    const first = claimAlerts();
    assert.match(first.claim, /^[0-9a-f-]{36}$/);
    assert.deepEqual(
      first.problems.map((p) => [p.payment_id, p.reason, p.source]),
      [
        [a, "amount_mismatch", "notice"],
        [b, "complete_unfulfillable_target", "status_check"],
      ]
    );
    const [shown] = first.problems;
    assert.deepEqual(Object.keys(shown).sort(), [
      "amount_cents",
      "first_seen_at",
      "fulfillment_status",
      "id",
      "merchant_reference",
      "payment_id",
      "product_kind",
      "reason",
      "source",
      "status",
    ]);
    assert.equal(shown.status, "pending");
    assert.equal(shown.product_kind, "plan");
    assert.match(shown.amount_cents, /^[0-9]+$/);
    // Leased: a second run gets nothing.
    assert.deepEqual(claimAlerts(), { claim: null, problems: [] });
    // The send failed; once the lease ends they are offered again.
    q(
      `update private.payment_problems set alert_claimed_until=clock_timestamp()-interval '1 second' where alert_claim='${first.claim}';`
    );
    const second = claimAlerts(1);
    assert.equal(second.problems.length, 1, "the limit holds, oldest first");
    assert.equal(second.problems[0].payment_id, a);
    // A late completion of the first lease records only what is still its own.
    assert.equal(completeAlerts(first.claim), 1);
    assert.equal(completeAlerts(second.claim), 1);
    assert.equal(completeAlerts(second.claim), 0, "a repeated completion changes nothing");
    assert.equal(row(a, "amount_mismatch").alerted, true);
    assert.equal(row(b, "complete_unfulfillable_target").alerted, true);
    assert.equal(row(quiet, "site_code_mismatch").alerted, false);
    assert.deepEqual(claimAlerts(), { claim: null, problems: [] });
    // A repeat of an emailed problem is not emailed again.
    record(a, "amount_mismatch", "status_check", true);
    assert.deepEqual(claimAlerts(), { claim: null, problems: [] });
    // A marked problem first seen over 7 days ago is left to the summary.
    const old = payment("alert-old");
    record(old, "transaction_reused", "notice", true);
    q(
      `update private.payment_problems set first_seen_at=first_seen_at-interval '8 days' where payment_id='${old}';`
    );
    assert.deepEqual(claimAlerts(), { claim: null, problems: [] });
  });

  await check("alert commands refuse bad limits and claims", () => {
    for (const limit of ["0", "51", "null", "-1"])
      fails(
        service(`select api.claim_payment_alerts(${limit});`),
        "22023",
        /invalid payment alert limit/
      );
    fails(
      service("select api.complete_payment_alerts(null);"),
      "22023",
      /invalid payment alert claim/
    );
    assert.equal(completeAlerts(randomUUID()), 0);
  });

  await check("the daily summary: once a day, from the hour, with what waits for staff", () => {
    q("delete from private.payment_problem_digests;");
    for (const [hour, limit] of [
      ["24", "10"],
      ["-1", "10"],
      ["null", "10"],
      ["7", "0"],
      ["7", "51"],
      ["7", "null"],
    ])
      fails(
        service(`select api.claim_payment_digest(${hour},${limit});`),
        "22023",
        /invalid payment summary request/
      );
    fails(
      service("select api.complete_payment_digest(null);"),
      "22023",
      /invalid payment summary claim/
    );
    // Not due before the hour (South African time).
    const hour = sastHour();
    if (hour < 23) assert.equal(claimDigest(hour + 1), null);
    assert.equal(q("select count(*) from private.payment_problem_digests;"), "0");

    // What waits for staff: money received but not activated, and a payment
    // pending with an Ozow request for over 2 hours.
    const unactivated = payment("summary-unactivated");
    q(
      `update private.payments set status='complete',completed_at=clock_timestamp(),provider_transaction_id='tx-${unactivated}',` +
        `fulfillment_status='needs_reconciliation' where id='${unactivated}';`
    );
    const stale = payment("summary-stale");
    q(
      `update private.payments set created_at=clock_timestamp()-interval '3 hours' where id='${stale}';`
    );
    const flagged = payment("summary-flagged");
    record(flagged, "multiple_settlements", "status_check", true);
    q(
      "insert into private.provider_events(provider,payload_sha256,merchant_reference,provider_request_id,reported_status,amount_cents,currency,outcome) values " +
        "('ozow',md5('a')||md5('b'),'ref-a','req-a','complete',100,'ZAR','completed')," +
        "('ozow',md5('c')||md5('d'),'ref-b','req-b','complete',100,'ZAR','completed')," +
        "('ozow',md5('e')||md5('f'),'ref-c','req-c','error',100,'ZAR','not_paid');"
    );
    const preflightRows = preflight();
    assert.match(
      preflightRows[0][1],
      /; paid but not activated: 1; pending with an Ozow request for over 2 hours: 1$/
    );

    const day = today();
    const first = claimDigest(0, 50);
    assert.equal(first.day, day);
    assert.match(first.claim, /^[0-9a-f-]{36}$/);
    const span = (Date.parse(first.window_end) - Date.parse(first.window_start)) / 3_600_000;
    assert.ok(Math.abs(span - 24) < 0.01, `a first summary covers 24 hours, not ${span}`);
    assert.equal(first.not_activated.total, 1);
    assert.deepEqual(first.not_activated.payment_ids, [unactivated]);
    assert.equal(first.stale_pending.total, 1);
    assert.deepEqual(first.stale_pending.payment_ids, [stale]);
    assert.deepEqual(first.outcomes, { completed: 2, not_paid: 1 });
    assert.ok(first.problems.total >= 1);
    const top = first.problems.items[0];
    assert.equal(top.needs_alert, true, "marked problems are listed first");
    const listed = first.problems.items.find((item) => item.payment_id === flagged);
    assert.deepEqual(
      { reason: listed.reason, alerted: listed.alerted, n: listed.occurrences },
      { reason: "multiple_settlements", alerted: false, n: 1 }
    );
    assert.ok(first.unalerted >= 1);
    // The list limit holds; the totals do not change with it.
    const short = claimDigestAfterLease(first.claim, 1);
    assert.equal(short.problems.items.length, 1);
    assert.equal(short.problems.total, first.problems.total);
    assert.ok(short.not_activated.payment_ids.length <= 1);
    // Leased: another run the same day gets nothing; once done, nothing more today.
    assert.equal(claimDigest(), null);
    assert.equal(completeDigest(first.claim), "f", "the earlier lease is no longer this summary's");
    assert.equal(completeDigest(short.claim), "t");
    assert.equal(completeDigest(short.claim), "f");
    assert.equal(claimDigest(), null);
    assert.equal(
      q(
        `select count(*) from private.payment_problem_digests where day='${day}' and done_at is not null;`
      ),
      "1"
    );
  });

  await check("the next summary starts where the last one ended, at most 7 days back", () => {
    const day = today();
    q(`delete from private.payment_problem_digests where day='${day}';`);
    const end = q("select (clock_timestamp()-interval '30 hours')::text;");
    q(
      `insert into private.payment_problem_digests(day,claim,window_end,done_at) values ` +
        `('${day}'::date-1,gen_random_uuid(),'${end}','${end}'),` +
        `('${day}'::date-2,gen_random_uuid(),clock_timestamp()-interval '2 days',null),` +
        `('${day}'::date-401,gen_random_uuid(),clock_timestamp()-interval '401 days',clock_timestamp()-interval '401 days');`
    );
    const next = claimDigest();
    assert.equal(Date.parse(next.window_start), Date.parse(end));
    assert.equal(
      q(`select count(*) from private.payment_problem_digests where day<'${day}'::date-400;`),
      "0",
      "summary records over 400 days old are removed"
    );
    completeDigest(next.claim);
    q(`delete from private.payment_problem_digests where day='${day}';`);
    q(
      `update private.payment_problem_digests set window_end=clock_timestamp()-interval '10 days',done_at=clock_timestamp()-interval '10 days' where day='${day}'::date-1;`
    );
    const capped = claimDigest();
    const days = (Date.parse(capped.window_end) - Date.parse(capped.window_start)) / 86_400_000;
    assert.ok(Math.abs(days - 7) < 0.001, `capped at 7 days, not ${days}`);
    completeDigest(capped.claim);
  });

  await check("only the website's server may run the commands; nobody reads the tables", () => {
    const someone = user("outsider");
    for (const command of COMMANDS) {
      const name = command.replace(/\(.*$/, "");
      const args = {
        record_payment_problem: "null,'unknown_payment','notice',false",
        claim_payment_alerts: "10",
        complete_payment_alerts: `'${randomUUID()}'`,
        claim_payment_digest: "0,10",
        complete_payment_digest: `'${randomUUID()}'`,
      }[name];
      fails(member(someone, `select api.${name}(${args});`), "42501");
      fails(as("anon", `select api.${name}(${args});`), "42501");
    }
    const grants = json(
      "select jsonb_object_agg(r.rolname||' '||f.sig,has_function_privilege(r.rolname,f.sig,'execute')) " +
        "from (values('anon'),('authenticated'),('service_role')) r(rolname), " +
        `(values${COMMANDS.flatMap((c) => [`('api.${c}')`, `('internal.${c}')`]).join(",")}) f(sig);`
    );
    for (const [key, allowed] of Object.entries(grants))
      assert.equal(allowed, key.startsWith("service_role "), key);
    const tables = json(
      "select jsonb_object_agg(r.rolname||' '||t.name,has_table_privilege(r.rolname,t.name,'select,insert,update,delete')) " +
        "from (values('anon'),('authenticated'),('service_role')) r(rolname), " +
        "(values('private.payment_problems'),('private.payment_problem_digests')) t(name);"
    );
    for (const [key, allowed] of Object.entries(tables)) assert.equal(allowed, false, key);
    for (const command of COMMANDS)
      assert.equal(
        q(
          `select prosecdef::text||' '||array_to_string(proconfig,',') from pg_proc where oid=to_regprocedure('internal.${command}');`
        ),
        "true search_path=pg_catalog"
      );
  });

  await check("a payment's problems go with it when it is deleted", () => {
    const gone = payment("cascade");
    record(gone, "amount_mismatch", "notice", true);
    q(`update private.payments set status='expired' where id='${gone}';`);
    q(`delete from private.payments where id='${gone}';`);
    assert.equal(
      q(`select count(*) from private.payment_problems where payment_id='${gone}';`),
      "0"
    );
  });

  await check("apply, roll back and apply again are clean", () => {
    applySteps(database, [{ label: "payment problem alerts rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    for (const command of COMMANDS) assert.equal(bodyOf(`api.${command}`), "missing");
    assert.match(preflight()[0][1], /^payment problem alerts: update not applied/);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
    recording("reapplied");
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the problem record, the alerts and the summary", () => {
      drainAlerts();
      const { wrong } = recording(`later-${randomUUID().slice(0, 8)}`);
      const claimed = claimAlerts();
      assert.ok(claimed.problems.some((p) => p.payment_id === wrong));
      assert.ok(completeAlerts(claimed.claim) >= 1);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Payment problem alert checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
