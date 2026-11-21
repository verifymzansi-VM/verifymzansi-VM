#!/usr/bin/env node
// Behaviour checks for 20261120074411_sms_daily_limit.sql: a site-wide limit
// on SMS codes per South African day. At the limit no challenge is stored (so
// the website sends no SMS) and the member's open code keeps working; refused
// requests use no place; concurrent requests never pass the limit; staff get
// a cost alarm at 70% and at the limit; the setting is one cost allowance row
// (without it the 500 fallback still holds, with no alarm).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Codes are asked for through the production service command
// (api.create_verification_phone_challenge) as the website's server does; no
// SMS is sent and no SMS provider is involved. The setting and the day's count
// are changed directly as the database owner, as the owner would in the SQL
// editor. The script runs the update's read-only preflight, checks its
// refusals, applies it, checks the rules, and proves apply -> rollback ->
// apply returns the same fingerprints. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-sms-daily-limit.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { phoneChecks } from "./lib/foundation-phone-checks.mjs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  executeGrants,
  openUpdateCheck,
  sqlLiteral,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261120074411_sms_daily_limit.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const CREATE = "internal.create_verification_phone_challenge(uuid,text,text)";
const API_CREATE = "api.create_verification_phone_challenge(uuid,text,text)";
const LIMIT_FN = "internal.sms_daily_limit()";
const TODAY = "(statement_timestamp() at time zone 'Africa/Johannesburg')::date";
/** Numbers for synthetic members: +2772100NNNN. */
const number = (n) => `+2772100${String(n).padStart(4, "0")}`;

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  fails,
  service,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const { createSql, create, prove, refusedWith, challengeCount } = phoneChecks({
    q,
    json,
    fails,
    service,
  });
  /** Running `sql` is refused at the daily limit; returns stderr. */
  const overLimit = (sql) => {
    const stderr = fails(sql, "PT429", /daily SMS code limit reached/);
    assert.equal(/^DETAIL:\s+(\S+)/m.exec(stderr)?.[1], "sms_daily_limit", stderr);
    return stderr;
  };
  const counted = () =>
    Number(q(`select coalesce((select sent from private.sms_code_days where day=${TODAY}),0);`));
  const setLimit = (value) =>
    q(`update private.cost_allowances set free_quantity=${value} where metric='sms_codes_day';`);
  /** Today's count set to `sent` and today's alarms of the limit cleared. */
  const resetDay = (sent = 0) =>
    q(`update private.sms_code_days set sent=${sent} where day=${TODAY};
      delete from private.cost_alarms where metric='sms_codes_day';`);
  const alarms = () =>
    json(`select coalesce(jsonb_agg(jsonb_build_object('level',level,'used',used::integer,
        'limit',free_quantity::integer,'today',period=to_char(${TODAY},'YYYY-MM-DD')) order by raised_at,level),'[]')
      from private.cost_alarms where metric='sms_codes_day';`);
  let next = 1;
  /** A fresh member asking for a code to a fresh number. */
  const fresh = (label) => [syntheticMember(`sms-${label}`), number(next++)];

  // ------------------------------------------------------------ before
  const early = syntheticMember("sms-early");
  await check("before the update: codes are stored without a daily count", () => {
    assert.equal(bodyMd5(CREATE), "3661274c4f3c00f87490dd4be0809820");
    for (let i = 0; i < 3; i += 1) assert.ok(create(early, number(9000 + i)).challenge_id);
    assert.equal(q(`select to_regclass('private.sms_code_days') is null;`), "t");
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(rows[0][1], "sms daily limit: update not applied; codes today: 3");
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(`select pg_get_functiondef('${CREATE}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${CREATE}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[0][1], /unexpected state/);
    assert.ok(rows[1][1].startsWith(`${CREATE} is not the reviewed body`), rows[1][1]);
    assert.match(fails(step.sql, "55000"), /sms daily limit drift/);
    q(`${live};`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  const grants = executeGrants(json, [CREATE, API_CREATE]);
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "sms daily limit",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^sms daily limit: already applied; codes today: 3; counted today: 3; limit: 500$/,
  });

  // LIM-SQL-sms-daily (docs/testing/limits-register.json)
  await check("the codes already sent today count, and the limit is 500", () => {
    assert.equal(counted(), 3);
    assert.equal(Number(q(`select ${LIMIT_FN};`)), 500);
    assert.deepEqual(
      json(`select jsonb_build_object('unit',unit,'period',period,'measurement',measurement,
          'free_quantity',free_quantity::integer) from private.cost_allowances where metric='sms_codes_day';`),
      { unit: "count", period: "day", measurement: "estimate", free_quantity: 500 }
    );
    // Not read by the provider-allowance alarm check (it raises its own).
    assert.equal(q(`select internal.check_cost_alarms();`), "0");
  });
  await check("each stored code counts once", () => {
    const [member, phone] = fresh("count");
    const before = counted();
    assert.ok(create(member, phone).challenge_id);
    assert.equal(counted(), before + 1);
  });
  await check("at the limit no code is stored and the open code keeps working", () => {
    resetDay(0);
    setLimit(2);
    const [member, phone] = fresh("limit");
    create(member, phone);
    const second = create(member, phone);
    assert.equal(counted(), 2);
    const stored = challengeCount(member);
    const open = q(
      `select expires_at from private.verification_phone_challenges where id='${second.challenge_id}';`
    );
    overLimit(createSql(member, phone));
    const [other, otherPhone] = fresh("limit-other");
    overLimit(createSql(other, otherPhone));
    assert.equal(counted(), 2, "a refused request uses no place");
    assert.equal(challengeCount(member), stored, "no challenge row");
    assert.equal(challengeCount(other), 0, "no challenge row");
    assert.equal(
      q(
        `select expires_at from private.verification_phone_challenges where id='${second.challenge_id}';`
      ),
      open,
      "the member's open code is not expired"
    );
    // That code can still be used.
    q(
      service(`select api.claim_verification_phone_attempt('${member.id}','${second.challenge_id}');
        select api.finalize_verification_phone('${member.id}','${second.challenge_id}','${second.digest}');`)
    );
  });
  await check("raising the setting allows more codes at once", () => {
    setLimit(3);
    const [member, phone] = fresh("raised");
    assert.ok(create(member, phone).challenge_id);
    assert.equal(counted(), 3);
    overLimit(createSql(member, phone));
    setLimit(500);
  });
  await check("refusals come first and use no place", () => {
    resetDay(0);
    const [holder, held] = fresh("holder");
    prove(holder, held);
    // At the limit, a request refused for another reason still gets that
    // reason, and none of them is counted.
    const before = counted();
    setLimit(before);
    const [other] = fresh("in-use");
    refusedWith(createSql(other, held), "phone_in_use");
    refusedWith(createSql(holder, held), "phone_already_verified");
    const stranger = { id: "00000000-0000-4000-8000-0000000000aa" };
    fails(createSql(stranger, number(8000)), "42501", /active subject required/);
    fails(createSql(other, "+2772"), "22023", /valid phone challenge required/);
    assert.equal(counted(), before);
    setLimit(500);
  });
  await check(
    "staff get a warning alarm at 70% and a critical one at the limit, once a day",
    () => {
      resetDay(0);
      setLimit(10);
      const members = Array.from({ length: 6 }, (_, i) => fresh(`alarm-${i}`));
      for (const [member, phone] of members) create(member, phone);
      assert.deepEqual(alarms(), []);
      const [seventh, phone7] = fresh("alarm-7");
      create(seventh, phone7);
      assert.deepEqual(alarms(), [{ level: "warning", used: 7, limit: 10, today: true }]);
      for (let i = 0; i < 3; i += 1) create(seventh, phone7);
      assert.equal(counted(), 10);
      assert.deepEqual(alarms(), [
        { level: "warning", used: 7, limit: 10, today: true },
        { level: "critical", used: 10, limit: 10, today: true },
      ]);
      overLimit(createSql(seventh, phone7));
      // Raised and reached again the same day: no second alarm.
      setLimit(11);
      create(seventh, phone7);
      assert.equal(alarms().length, 2);
      // The staff cost page lists them as open alarms.
      assert.equal(
        q(
          `select count(*) from private.cost_alarms where metric='sms_codes_day' and acknowledged_at is null;`
        ),
        "2"
      );
    }
  );
  await check("concurrent requests never pass the limit", () => {
    resetDay(0);
    setLimit(5);
    const people = Array.from({ length: 20 }, (_, i) => fresh(`race-${i}`));
    const before = Number(q(`select count(*) from private.verification_phone_challenges;`));
    // One session holds the day's row for 2 seconds; the 20 requests start
    // while it is held, wait on that row lock together and are then counted
    // one at a time, each re-checking the limit on the newest row.
    const call = ([member, phone], i) =>
      `psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres -c "set role service_role; select api.create_verification_phone_challenge('${member.id}','${phone}','race-digest-${String(i).padStart(4, "0")}-padding');" >/tmp/race-$i.out 2>&1; echo "$i $?" >>/tmp/race.status`;
    const script = [
      "rm -f /tmp/race*",
      `psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "begin; update private.sms_code_days set sent=sent where day=${TODAY}; select pg_sleep(2); commit;" >/tmp/race-holder.out 2>&1 &`,
      "sleep 0.5",
      ...people.map((person, i) => `(${call(person, i).replaceAll("$i", String(i))}) &`),
      "wait",
      "cat /tmp/race.status",
      "grep -h 'ERROR' /tmp/race-*.out || true",
    ].join("\n");
    const run = spawnSync("docker", ["exec", "-i", database.name, "bash", "-s"], {
      input: script,
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: true,
    });
    assert.equal(run.status, 0, run.stderr);
    const statuses = run.stdout
      .split("\n")
      .filter((line) => /^\d+ \d+$/.test(line))
      .map((line) => Number(line.split(" ")[1]));
    assert.equal(statuses.length, 20, run.stdout);
    assert.equal(statuses.filter((s) => s === 0).length, 5, run.stdout);
    const errors = run.stdout.split("\n").filter((line) => line.includes("ERROR"));
    assert.equal(errors.length, 15, run.stdout);
    for (const line of errors) assert.match(line, /daily SMS code limit reached/);
    assert.equal(counted(), 5);
    assert.equal(
      Number(q(`select count(*) from private.verification_phone_challenges;`)),
      before + 5
    );
  });
  await check("a new South African day starts at zero", () => {
    setLimit(5);
    // Today's row becomes yesterday's, as at midnight.
    q(`update private.sms_code_days set day=day-1 where day=${TODAY};`);
    const [member, phone] = fresh("new-day");
    assert.ok(create(member, phone).challenge_id);
    assert.equal(counted(), 1);
    assert.equal(
      q(`select sent from private.sms_code_days where day=${TODAY}-1;`),
      "5",
      "yesterday's count is kept"
    );
    setLimit(500);
  });
  await check("the setting: 500 when empty, whole numbers, at most 1,000,000", () => {
    q(`update private.cost_allowances set free_quantity=null where metric='sms_codes_day';`);
    assert.equal(q(`select ${LIMIT_FN};`), "500");
    setLimit(12.9);
    assert.equal(q(`select ${LIMIT_FN};`), "12");
    setLimit(5000000000);
    assert.equal(q(`select ${LIMIT_FN};`), "1000000");
    setLimit(500);
  });
  await check("without the setting row the 500 fallback holds, with no alarm", () => {
    const row = q(
      `select row_to_json(a)::text from private.cost_allowances a where metric='sms_codes_day';`
    );
    // A cost alarm needs its allowance row, so its alarms go first.
    q(`delete from private.cost_alarms where metric='sms_codes_day';
      delete from private.cost_allowances where metric='sms_codes_day';`);
    assert.equal(q(`select ${LIMIT_FN};`), "500");
    // The 350th code (70% of 500) and the 500th are stored; the 501st is
    // refused with the member's message, not a failure.
    resetDay(349);
    const [member, phone] = fresh("no-row");
    assert.ok(create(member, phone).challenge_id);
    assert.equal(counted(), 350);
    resetDay(499);
    assert.ok(create(member, phone).challenge_id);
    assert.equal(counted(), 500);
    overLimit(createSql(member, phone));
    const [other, otherPhone] = fresh("no-row-other");
    overLimit(createSql(other, otherPhone));
    assert.equal(counted(), 500);
    assert.deepEqual(alarms(), []);
    q(`insert into private.cost_allowances select * from json_populate_record(null::private.cost_allowances,
      ${sqlLiteral(row)}::json);`);
    assert.equal(q(`select ${LIMIT_FN};`), "500");
  });
  await check("no API role can read the counts or run the helper", () => {
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        q(
          `select has_table_privilege('${role}','private.sms_code_days','select,insert,update,delete');`
        ),
        "f",
        role
      );
    const none = { anon: false, authenticated: false, service_role: false };
    assert.deepEqual(executeGrants(json, [LIMIT_FN]), { [LIMIT_FN]: none });
    assert.deepEqual(executeGrants(json, [CREATE, API_CREATE]), grants);
    assert.equal(
      q(`select relrowsecurity from pg_class where oid='private.sms_code_days'::regclass;`),
      "t"
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the daily limit", () => {
      resetDay(0);
      setLimit(1);
      const [member, phone] = fresh("later");
      assert.ok(create(member, phone).challenge_id);
      overLimit(createSql(member, phone));
      setLimit(500);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `SMS daily limit checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
