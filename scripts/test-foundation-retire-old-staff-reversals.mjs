#!/usr/bin/env node
// Behaviour checks for 20261113085340_retire_old_staff_reversal_commands.sql,
// the contract step of 20261113021223_staff_payment_fixes.sql: the earlier
// staff payment commands (api.record_frontend_staff_payment_reversal,
// api.record_staff_slot_reversal, api.get_frontend_staff_payments) are
// removed and the internal functions behind them closed to the API roles.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff call the production API commands as `authenticated` with
// synthetic claims, a live AAL2 session and a verified authenticator app;
// payments are completed through the service commands as the notice handler
// does. The script runs the update's read-only preflight, checks the update's
// refusals, applies it, checks that the three commands and the internal
// functions are closed while the replacement slot refund and the approval of a
// waiting refund still reverse one slot through the retained internal step,
// and proves apply -> rollback -> apply returns the same fingerprints. Any
// later updates are applied at the end. Nothing contacts Ozow.
//
//   node --import tsx scripts/test-foundation-retire-old-staff-reversals.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  createChecks,
  sqlHelpers,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261113085340_retire_old_staff_reversal_commands.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const P30 = { id: "d6ca48e5-43be-40df-8d8c-72c98a6fda96", cents: 6900 };
const P180 = { id: "ce4ef578-344a-4816-ab6a-6961bec46621", cents: 41400 };
const RETIRED = [
  "api.record_frontend_staff_payment_reversal(uuid,text,text)",
  "api.record_staff_slot_reversal(uuid,text,text)",
  "api.get_frontend_staff_payments(integer,text)",
];
const CLOSED = [
  "internal.record_frontend_staff_payment_reversal(uuid,text,text)",
  "internal.get_frontend_staff_payments(integer,text)",
  "internal.record_staff_slot_reversal(uuid,text,text)",
];
const ROLES = ["anon", "authenticated", "service_role"];
const sha = (text) => createHash("sha256").update(text).digest("hex");
const fingerprintOf = (label) =>
  `${createHash("sha256").update(`person-${label}`).digest("base64url").slice(0, 42)}A`;

const { check, current, passed: checks } = createChecks();

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const { q, json, fails, member, staff, service } = sqlHelpers(database, current);
  const fingerprint = () => q(`set search_path to pg_catalog;\n${FINGERPRINT}`);
  const preflight = () =>
    q(PREFLIGHT)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));
  const present = (sig) => q(`select to_regprocedure('${sig}') is not null;`) === "t";
  const callers = (sig) =>
    ROLES.filter(
      (role) => q(`select has_function_privilege('${role}','${sig}','execute');`) === "t"
    );

  // ------------------------------------------------------- synthetic world
  q(`create schema vmtest;
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid);
    end$$;
    create function vmtest.staff(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role);
      return m;
    end$$;
    create function vmtest.verified(p_owner uuid,p_staff uuid,p_fp text) returns void language plpgsql as $$
    begin
      perform set_config('session_replication_role','replica',true);
      insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by)
        values(p_owner,gen_random_uuid(),p_fp,p_staff);
      insert into private.verification_phone_proofs(owner_id,challenge_id,phone)
        values(p_owner,gen_random_uuid(),'+2782'||lpad((abs(hashtext(p_owner::text))%10000000)::text,7,'0'));
      insert into private.verification_localities(owner_id,province_id,city_id) values(p_owner,'gp','gp_johannesburg');
      perform set_config('session_replication_role','origin',true);
    end$$;
    create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path to 'pg_catalog' as $fn$
      select f.identity_hmac from private.accepted_identity_facts f where f.owner_id=p_owner and f.revoked_at is null
        and exists(select 1 from private.current_account_access a where a.id=p_owner) $fn$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const staffUser = (label, role) => json(`select vmtest.staff('${label}','${role}');`);
  const admin = staffUser("retire-admin", "admin");
  const admin2 = staffUser("retire-admin2", "admin");
  q(`select vmtest.verified('${admin.id}','${admin2.id}','${fingerprintOf("retire-admin")}');`);
  q(`select vmtest.verified('${admin2.id}','${admin.id}','${fingerprintOf("retire-admin2")}');`);
  const verified = (label) => {
    const m = user(label);
    q(`select vmtest.verified('${m.id}','${admin.id}','${fingerprintOf(label)}');`);
    return m;
  };

  const buy = (owner, plan, slots) => {
    const quoted = json(
      member(
        owner,
        `select api.start_slot_checkout('${plan.id}',${slots},${plan.cents * slots},true);`
      )
    );
    const paymentId = quoted.payment_id;
    const lease = json(service(`select api.claim_checkout_request('${paymentId}','${owner.id}');`));
    if (!lease.checkout_url)
      q(
        service(
          `select api.complete_checkout_request('${paymentId}','${owner.id}','${lease.claim_token}','req-${paymentId}','https://one.ozow.com/checkout/req-${paymentId}');`
        )
      );
    const row = json(
      `select jsonb_build_object('ref',merchant_reference,'amount',amount_cents) from private.payments where id='${paymentId}';`
    );
    const event = {
      payload_sha256: sha(`event-${paymentId}-complete`),
      merchant_reference: row.ref,
      provider_request_id: `req-${paymentId}`,
      provider_transaction_id: `tx-${paymentId}`,
      status: "complete",
      amount_cents: Number(row.amount),
      currency: "ZAR",
    };
    const settled = json(
      service(`select api.apply_provider_event($e$${JSON.stringify(event)}$e$::jsonb);`)
    );
    assert.equal(settled.outcome, "completed");
    return paymentId;
  };
  const lines = (paymentId) =>
    json(
      `select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'status',l.status) order by l.line_number),'[]')
       from private.payment_lines l where l.payment_id='${paymentId}';`
    );
  const slotRefund = (who, lineId, ref) =>
    staff(
      who,
      `select api.record_staff_slot_refund('${lineId}','refunded','s14_cancellation','Cancelled within 14 days','${ref}');`
    );
  const oldCalls = (who, paymentId, lineId) => [
    staff(
      who,
      `select api.record_frontend_staff_payment_reversal('${paymentId}','refunded','Old screen refund');`
    ),
    staff(who, `select api.record_staff_slot_reversal('${lineId}','refunded','Old slot refund');`),
    staff(who, "select api.get_frontend_staff_payments(1);"),
  ];
  const internalCalls = (who, paymentId, lineId) => [
    staff(
      who,
      `select internal.record_frontend_staff_payment_reversal('${paymentId}','refunded','Direct refund');`
    ),
    staff(
      who,
      `select internal.record_staff_slot_reversal('${lineId}','refunded','Direct slot refund');`
    ),
    staff(who, "select internal.get_frontend_staff_payments(1);"),
  ];

  // ------------------------------------------------------------ before
  const buyer = verified("retire-buyer");
  const order = buy(buyer, P30, 2);
  await check(
    "before the update: preflight reads 'not applied', staff may call the commands",
    () => {
      assertReadOnlyPreflight(database, PREFLIGHT);
      const rows = preflight();
      assert.deepEqual(
        rows.map((r) => r[0]),
        ["summary"],
        JSON.stringify(rows)
      );
      assert.equal(
        rows[0][1],
        "retire old staff reversal commands: update not applied; refunds waiting for approval: 0"
      );
      for (const sig of [...RETIRED, ...CLOSED])
        assert.deepEqual(callers(sig), ["authenticated"], sig);
      assert.equal(
        typeof json(staff(admin, "select api.get_frontend_staff_payments(1);")).total,
        "number"
      );
    }
  );

  await check("the update refuses without the replacement bodies or with a changed wrapper", () => {
    const before = fingerprint();
    const original = q(
      "select pg_get_functiondef('api.record_staff_slot_refund(uuid,text,text,text,text)'::regprocedure);"
    );
    q(`create or replace function api.record_staff_slot_refund(p_line_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
      returns jsonb language sql set search_path to 'pg_catalog' as $fn$ select null::jsonb $fn$;`);
    assert.match(
      fails(step.sql, "55000"),
      /20261113021223_staff_payment_fixes\.sql is not applied/
    );
    assert.match(
      preflight()[1][1],
      /api\.record_staff_slot_refund\(uuid,text,text,text,text\) is not the reviewed body/
    );
    q(original);
    const wrapper = q(
      "select pg_get_functiondef('api.get_frontend_staff_payments(integer,text)'::regprocedure);"
    );
    q(`create or replace function api.get_frontend_staff_payments(p_page integer, p_status text default null)
      returns jsonb language sql set search_path to 'pg_catalog' as $fn$ select null::jsonb $fn$;`);
    assert.match(fails(step.sql, "55000"), /not its reviewed wrapper/);
    assert.match(
      preflight()[1][1],
      /api\.get_frontend_staff_payments\(integer,text\) is not the reviewed wrapper/
    );
    q(wrapper);
    for (const sig of RETIRED) assert.ok(present(sig), sig);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  const before = fingerprint();
  applySteps(database, [step]);
  const after = fingerprint();

  await check("apply, roll back and apply again are clean", () => {
    assert.notEqual(after, before);
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "retire old staff reversal commands: already applied; refunds waiting for approval: 0"
    );
    applySteps(database, [{ label: "retire old staff reversals rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    assert.match(preflight()[0][1], /: update not applied;/);
    applySteps(database, [{ label: "retire old staff reversals rollback again", sql: ROLLBACK }]);
    assert.equal(fingerprint(), before, "a repeated rollback changes nothing");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
  });

  await check(
    "the earlier commands are gone and the internal steps closed to every API role",
    () => {
      for (const sig of RETIRED) assert.equal(present(sig), false, sig);
      for (const sig of CLOSED) {
        assert.ok(present(sig), sig);
        assert.deepEqual(callers(sig), [], sig);
      }
      const line = lines(order)[0].id;
      for (const sql of oldCalls(admin, order, line)) fails(sql, "42883");
      for (const sql of internalCalls(admin, order, line)) fails(sql, "42501");
      assert.deepEqual(
        lines(order).map((l) => l.status),
        ["open", "open"],
        "nothing was reversed"
      );
      assert.equal(q(`select status from private.payments where id='${order}';`), "complete");
    }
  );

  await check("the replacement slot refund still reverses one slot", () => {
    const [first, second] = lines(order);
    const result = json(slotRefund(admin, first.id, "OZ-RETIRE-1"));
    assert.equal(result.status, "applied");
    assert.deepEqual(
      lines(order).map((l) => l.status),
      ["reversed", "open"]
    );
    assert.ok(second.id);
    assert.equal(
      typeof json(staff(admin, "select api.get_staff_payment_list(1);")).total,
      "number"
    );
  });

  await check("an approved refund still reverses the slot it waited for", () => {
    const big = buy(verified("retire-big"), P180, 3);
    const [a, b, c] = lines(big);
    assert.equal(json(slotRefund(admin, a.id, "OZ-RETIRE-A")).status, "applied");
    assert.equal(json(slotRefund(admin, b.id, "OZ-RETIRE-B")).status, "applied");
    const waiting = json(slotRefund(admin, c.id, "OZ-RETIRE-C"));
    assert.equal(waiting.status, "awaiting_approval");
    assert.match(preflight()[0][1], /refunds waiting for approval: 1$/);
    const approved = json(
      staff(admin2, `select api.approve_staff_payment_refund('${waiting.request_id}');`)
    );
    assert.equal(approved.status, "applied");
    assert.deepEqual(
      lines(big).map((l) => l.status),
      ["reversed", "reversed", "reversed"]
    );
    assert.equal(q(`select status from private.payments where id='${big}';`), "refunded");
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the earlier commands retired", () => {
      for (const sig of RETIRED) assert.equal(present(sig), false, sig);
      for (const sig of CLOSED) assert.deepEqual(callers(sig), [], sig);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Retired staff reversal checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
