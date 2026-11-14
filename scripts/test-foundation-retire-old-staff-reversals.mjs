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
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  completeSlotOrder,
  installStaffPaymentWorld,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const RETIRED = [
  "api.record_frontend_staff_payment_reversal(uuid,text,text)",
  "api.record_staff_slot_reversal(uuid,text,text)",
  "api.get_frontend_staff_payments(integer,text)",
];
// The internal functions behind them, closed to the API roles.
const CLOSED = RETIRED.map((sig) => sig.replace(/^api\./, "internal."));
const ROLES = ["anon", "authenticated", "service_role"];
// Plan versions on sale since 20261113002421_individual_slots_r69.sql.
const PLANS = {
  days30: { id: "d6ca48e5-43be-40df-8d8c-72c98a6fda96", cents: 6900 },
  days180: { id: "ce4ef578-344a-4816-ab6a-6961bec46621", cents: 41400 },
};
const UPDATE = "20261113085340_retire_old_staff_reversal_commands.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);

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
  preflightRows: preflight,
} = await openUpdateCheck(PREFLIGHT);
try {
  // Every update before this one, as production has them.
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const present = (sig) => q(`select to_regprocedure('${sig}') is not null;`) === "t";
  const callers = (sig) =>
    ROLES.filter(
      (role) => q(`select has_function_privilege('${role}','${sig}','execute');`) === "t"
    );

  // ------------------------------------------------------- synthetic world
  const { user, staffUser, verify } = installStaffPaymentWorld(q, json);
  const admin = staffUser("retire-admin", "admin");
  const admin2 = staffUser("retire-admin2", "admin");
  verify(admin, admin2, "retire-admin");
  verify(admin2, admin, "retire-admin2");
  const verified = (label) => {
    const m = user(label);
    verify(m, admin, label);
    return m;
  };

  const buy = (owner, plan, slots) =>
    completeSlotOrder({ q, json, member, service }, owner, plan, slots).id;
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
  const order = buy(buyer, PLANS.days30, 2);
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
  await check("apply, roll back and apply again are clean", () =>
    applyWithRollbackCheck(database, {
      step,
      rollback: ROLLBACK,
      label: "retire old staff reversals",
      fingerprint,
      preflightRows: preflight,
      appliedSummary:
        /^retire old staff reversal commands: already applied; refunds waiting for approval: 0$/,
      repeatRollback: true,
    })
  );

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
    const big = buy(verified("retire-big"), PLANS.days180, 3);
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
