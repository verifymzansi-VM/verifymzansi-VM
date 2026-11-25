#!/usr/bin/env node
// Behaviour checks for 20261125110216_staff_part_refunds.sql (launch checklist
// item 77): the first-purchase refund within 5 business days, and part
// refunds through Ozow, from the Ozow dashboard or by bank transfer.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff act with a verified authenticator app and an AAL2 session,
// members with synthetic sessions, the website server's Ozow jobs as
// `service_role`. Payments are made through the slot checkout and settled with
// a synthetic Ozow notice; a payment's age and confirmation time are set as
// the database owner with triggers off; nothing else is written directly. The
// script checks the read-only preflight and the update's refusals, applies the
// update, proves apply -> rollback -> apply returns the schema fingerprint to
// the same values, then checks: South African business days (Easter and
// December); the first-purchase reason (first purchase only, in full, asked in
// time, the ask date, an erased account, refused by the earlier commands);
// part refunds that end the paid days and ones that keep the slot running;
// what is left, per payment and per slot, also for the earlier whole-refund
// commands; two staff members above R1 000 in total; repeats; a waiting
// renewal; several part refunds of one payment through Ozow (sent, confirmed)
// and from the dashboard (Ozow's amount must match); a bank transfer after
// Ozow's window; the staff list read; what a payment brought in; the grants;
// and that the rollback refuses once a part refund was recorded.
//
//   node --import tsx scripts/test-foundation-staff-part-refunds.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Members,
// staff and identity facts are written directly as the database owner. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  assertReadOnlyPreflight,
  completeSlotOrder,
  createChecks,
  executeGrants,
  sqlJsonb,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  createPaymentWorld,
  functionBodyMd5,
  P180,
  P30,
  sqlValue,
  twoAdmins,
  updateCheckKit,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261125110216_staff_part_refunds.sql";
const REVIEWED = {
  "internal.payment_refund_request_guard()": "11b86b7a627aad245c84433118601705",
  "internal.payment_net_cents(private.payments)": "28d85be00f5d30c0f2121b120ea55dc9",
  "internal.approve_staff_payment_refund(uuid)": "189b3f24e9b847bf75760eeaae9b2686",
  "internal.apply_ozow_refund_state(uuid,text,timestamp with time zone,timestamp with time zone,text)":
    "431e2541a83cf8e892efd61aa5cacd4d",
  "internal.claim_ozow_refund_send(uuid)": "c16477b6080ff5e7075f63936cd5383b",
};
const ADDED = [
  "internal.za_public_holiday(date)",
  "internal.za_business_day(date)",
  "internal.first_purchase_last_ask_day(timestamp with time zone)",
  "internal.payment_is_first_purchase(uuid)",
  "internal.assert_first_purchase_refund(uuid,date)",
  "internal.refund_left_cents(uuid,uuid)",
  "internal.staff_refund_result(private.payment_refund_requests,boolean)",
  "internal.apply_staff_refund(uuid,uuid)",
];
const COMMANDS = [
  "api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text)",
  "api.get_staff_refunds_left(uuid[])",
  "internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text)",
  "internal.get_staff_refunds_left(uuid[])",
];
const NONE = { anon: false, authenticated: false, service_role: false };
const STAFF = { anon: false, authenticated: true, service_role: false };
const NOT_APPLIED =
  /^staff part refunds: update not applied; waiting for approval: 0; through Ozow not sent: 0; part refunds: 0$/;

const started = Date.now();
const { check, current, passed: checks } = createChecks();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const kit = updateCheckKit(database, UPDATE, current);
  const { fails, fingerprint, json, member, preflight, q, service, staff } = kit;
  const world = createPaymentWorld(kit);
  const { admin, admin2 } = twoAdmins(world, "part");
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
  const verified = (label) => world.verified(label, admin);
  const replica = (sql) =>
    q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);

  /** A completed slot order; `uuidTx` gives Ozow a UUID transaction (refundable through Ozow). */
  const buy = (owner, plan = P30, slots = 1, uuidTx = false) =>
    completeSlotOrder(
      { q, json, member, service },
      owner,
      plan,
      slots,
      uuidTx ? randomUUID() : null
    ).id;
  const lineOf = (paymentId, n = 1) =>
    q(`select id from private.payment_lines where payment_id='${paymentId}' and line_number=${n};`);
  const grantOf = (paymentId, n = 1) =>
    q(`select e.id from private.entitlements e join private.payment_lines l on l.id=e.payment_line_id
       where l.payment_id='${paymentId}' and l.line_number=${n};`);
  const grantStatus = (id) => q(`select status from private.entitlements where id='${id}';`);
  const lineStatus = (id) => q(`select status from private.payment_lines where id='${id}';`);
  const payStatus = (paymentId) =>
    q(`select status from private.payments where id='${paymentId}';`);
  const net = (paymentId) =>
    Number(
      q(`select internal.payment_net_cents(p) from private.payments p where p.id='${paymentId}';`)
    );
  const left = (paymentId, lineId = null) =>
    Number(q(`select internal.refund_left_cents('${paymentId}',${sqlValue(lineId)});`));
  const record = (id) =>
    json(`select to_jsonb(r) from private.payment_refund_requests r where r.id='${id}';`);
  const requests = (paymentId) =>
    Number(
      q(`select count(*) from private.payment_refund_requests where payment_id='${paymentId}';`)
    );
  const today = () => q(`select (now() at time zone 'Africa/Johannesburg')::date;`);
  const dayOffset = (days) =>
    q(`select ((now() at time zone 'Africa/Johannesburg')::date + ${days});`);
  /** The payment was made `interval` ago (the Ozow refund window counts from it). */
  const paidAgo = (paymentId, interval) =>
    replica(
      `update private.payments set created_at=now()-interval '${interval}' where id='${paymentId}';`
    );
  /** The payment was confirmed at `at` (a timestamptz literal). */
  const confirmedAt = (paymentId, at) =>
    replica(`update private.payments set completed_at='${at}' where id='${paymentId}';`);

  const refundSql = (
    who,
    paymentId,
    {
      line = null,
      channel = "reference",
      amount = null,
      code = "s14_cancellation",
      reason = "Cancelled by the member in writing",
      reference = null,
      fact = null,
      askedOn = null,
    } = {}
  ) =>
    staff(
      who,
      `select api.record_staff_refund(${sqlValue(paymentId)}::uuid,${sqlValue(line)}::uuid,${sqlValue(channel)},${amount ?? "null"}::bigint,${sqlValue(code)},${sqlValue(reason)},${sqlValue(reference)},${fact ? sqlJsonb(fact) : "null::jsonb"},${sqlValue(askedOn)});`
    );
  const refund = (who, paymentId, options) => json(refundSql(who, paymentId, options));
  let refNo = 0;
  const ozowRef = (label) => `OZ-${label}-${String(++refNo).padStart(4, "0")}`;
  const approveSql = (who, id) => staff(who, `select api.approve_staff_payment_refund('${id}');`);
  const claim = (id) => json(service(`select api.claim_ozow_refund_send('${id}');`));
  const sendResult = (id, result) =>
    json(service(`select api.record_ozow_refund_send('${id}',${sqlJsonb(result)});`));
  const ozowFact = (claimed, status, refundId = randomUUID()) => ({
    refund_id: refundId,
    transaction_id: claimed.transaction_id,
    amount_cents: claimed.amount_cents,
    status,
    requested_at: new Date().toISOString(),
    completed_at: status === "Complete" ? new Date().toISOString() : null,
  });
  const transactionOf = (paymentId) =>
    q(`select lower(provider_transaction_id) from private.payments where id='${paymentId}';`);

  // ------------------------------------------------------------ before
  const early = verified("part-early");
  const earlyPay = buy(early);

  await check("before the update: the reviewed bodies, no new command", () => {
    for (const [signature, md5] of Object.entries(REVIEWED))
      assert.equal(bodyMd5(signature), md5, signature);
    for (const signature of [...ADDED, ...COMMANDS])
      assert.equal(bodyMd5(signature), "missing", signature);
    fails(
      refundSql(admin, earlyPay, { reference: ozowRef("EARLY") }),
      "42883",
      /record_staff_refund/
    );
  });
  await check("preflight: read only; one summary row reading 'not applied'", () => {
    assertReadOnlyPreflight(database, kit.preflightSql);
    const [summary, ...problems] = preflight();
    assert.deepEqual(problems, []);
    assert.equal(summary[0], "summary");
    assert.match(summary[1], NOT_APPLIED);
  });
  await check("drift and a premature rollback are refused", () => {
    assertDriftRefused(kit, {
      label: "staff part refunds",
      signatures: Object.keys(REVIEWED),
      rows: 2,
    });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "staff part refunds",
    applied:
      /^staff part refunds: already applied; waiting for approval: 0; through Ozow not sent: 0; part refunds: 0$/,
    notApplied: NOT_APPLIED,
  });

  // LIM-SQL-first-purchase-business-days: 5 South African business days.
  await check("business days: Easter, December and Sundays", () => {
    const holiday = (day) => q(`select internal.za_public_holiday('${day}');`);
    for (const day of [
      "2026-01-01",
      "2026-03-21",
      "2026-04-03", // Good Friday 2026
      "2026-04-06", // Family Day 2026
      "2027-03-26", // Good Friday 2027
      "2027-03-29", // Family Day 2027
      "2026-04-27",
      "2026-08-10", // 9 August 2026 is a Sunday
      "2026-12-16",
      "2026-12-25",
      "2026-12-26",
      "2021-12-27", // 26 December 2021 was a Sunday
      "2022-12-27", // Christmas 2022 was a Sunday
    ])
      assert.equal(holiday(day), "t", day);
    for (const day of ["2026-04-02", "2026-04-07", "2026-12-24", "2026-12-28", "2027-04-02"])
      assert.equal(holiday(day), "f", day);
    const lastDay = (at) => q(`select internal.first_purchase_last_ask_day('${at}');`);
    // Wednesday 1 April 2026: Good Friday and Family Day are skipped.
    assert.equal(lastDay("2026-04-01T10:00:00+02:00"), "2026-04-10");
    // Late on 1 April in UTC is 2 April in South Africa.
    assert.equal(lastDay("2026-04-01T23:30:00Z"), "2026-04-13");
    // 16 December is skipped.
    assert.equal(lastDay("2026-12-14T09:00:00+02:00"), "2026-12-22");
    // Christmas Day (Friday) and the weekend; 26 December 2026 is a Saturday.
    assert.equal(lastDay("2026-12-23T09:00:00+02:00"), "2026-12-31");
    // Confirmed on a Saturday: counting starts on Monday.
    assert.equal(lastDay("2026-11-28T12:00:00+02:00"), "2026-12-04");
  });

  // ------------------------------------------------------ first purchase
  const lerato = verified("part-lerato");
  const leratoFirst = buy(lerato, P180);
  const leratoSecond = buy(lerato, P30);
  await check("first purchase: only the first, in full, with the ask date", () => {
    const base = { code: "first_purchase_cancelled", askedOn: today() };
    fails(
      refundSql(admin, leratoSecond, { ...base, reference: ozowRef("LERATO") }),
      "PT409",
      /first_purchase_not_first/
    );
    fails(
      refundSql(admin, leratoFirst, { ...base, amount: 1000, reference: ozowRef("LERATO") }),
      "PT409",
      /first_purchase_whole_payment/
    );
    fails(
      refundSql(admin, leratoFirst, {
        ...base,
        line: lineOf(leratoFirst),
        reference: ozowRef("LERATO"),
      }),
      "PT409",
      /first_purchase_whole_payment/
    );
    fails(
      refundSql(admin, leratoFirst, { ...base, askedOn: null, reference: ozowRef("LERATO") }),
      "22023",
      /first_purchase_asked_on_required/
    );
    for (const askedOn of ["2026-02-30", "25/11/2026"])
      fails(
        refundSql(admin, leratoFirst, { ...base, askedOn, reference: ozowRef("LERATO") }),
        "22023",
        /first_purchase_asked_on_invalid/
      );
    fails(
      refundSql(admin, leratoFirst, {
        ...base,
        askedOn: dayOffset(1),
        reference: ozowRef("LERATO"),
      }),
      "22023",
      /first_purchase_asked_on_invalid/
    );
    fails(
      refundSql(admin, leratoFirst, {
        ...base,
        askedOn: dayOffset(-1),
        reference: ozowRef("LERATO"),
      }),
      "22023",
      /first_purchase_asked_on_invalid/
    );
    // The ask date belongs to the first-purchase reason only.
    fails(
      refundSql(admin, leratoSecond, { askedOn: today(), reference: ozowRef("LERATO") }),
      "22023",
      /refund_asked_on_unexpected/
    );
    // The earlier commands do not accept the reason (they carry no ask date).
    fails(
      staff(
        admin,
        `select api.record_staff_payment_refund('${leratoFirst}','refunded','first_purchase_cancelled','Changed mind','${ozowRef("LERATO")}');`
      ),
      "22023",
      /refund_reason_code_invalid/
    );
    assert.equal(requests(leratoFirst), 0);
    const done = refund(admin, leratoFirst, {
      ...base,
      reason: "First purchase cancelled by email",
      reference: ozowRef("LERATO"),
    });
    assert.deepEqual(
      [done.status, done.payment_status, done.ends_paid_days, done.amount_cents],
      ["applied", "refunded", true, P180.cents]
    );
    assert.equal(grantStatus(grantOf(leratoFirst)), "revoked");
    const row = record(done.request_id);
    assert.deepEqual(
      [row.reason_code, row.customer_asked_on, row.channel],
      ["first_purchase_cancelled", today(), "manual"]
    );
    // Still the first purchase after it was refunded: the second never is.
    fails(
      refundSql(admin, leratoSecond, { ...base, reference: ozowRef("LERATO") }),
      "PT409",
      /first_purchase_not_first/
    );
    assert.equal(net(leratoFirst), 0);
  });

  await check("first purchase: asked in time, recorded later; asked too late", () => {
    const sipho = verified("part-sipho-first");
    const pay = buy(sipho);
    // Confirmed Wednesday 1 April 2026: the last day to ask is Friday 10 April.
    confirmedAt(pay, "2026-04-01T10:00:00+02:00");
    fails(
      refundSql(admin, pay, {
        code: "first_purchase_cancelled",
        askedOn: "2026-04-13",
        reference: ozowRef("SIPHO"),
      }),
      "PT409",
      /first_purchase_too_late/
    );
    fails(
      refundSql(admin, pay, {
        code: "first_purchase_cancelled",
        askedOn: "2026-03-31",
        reference: ozowRef("SIPHO"),
      }),
      "22023",
      /first_purchase_asked_on_invalid/
    );
    paidAgo(pay, "20 days"); // a bank transfer back: Ozow's window has passed
    const done = refund(admin, pay, {
      code: "first_purchase_cancelled",
      askedOn: "2026-04-10",
      reference: "FNB FIRST 0001",
    });
    assert.deepEqual([done.status, done.payment_status], ["applied", "refunded"]);
  });

  await check("first purchase: an erased account cannot be checked", () => {
    const gone = verified("part-gone");
    const pay = buy(gone);
    replica(`update private.payments set owner_id=null where id='${pay}';
      update private.entitlements set owner_id=null where payment_id='${pay}';`);
    fails(
      refundSql(admin, pay, {
        code: "first_purchase_cancelled",
        askedOn: today(),
        reference: ozowRef("GONE"),
      }),
      "PT409",
      /first_purchase_account_erased/
    );
  });

  // ------------------------------------------------------------- part refunds
  const naledi = verified("part-naledi");
  await check("a cancellation credit ends the paid days and keeps the rest", () => {
    const pay = buy(naledi, P180);
    const done = refund(admin, pay, { amount: 20000, reference: ozowRef("NALEDI") });
    assert.deepEqual(
      [done.status, done.payment_status, done.ends_paid_days, done.amount_cents],
      ["applied", "refunded", true, 20000]
    );
    assert.equal(grantStatus(grantOf(pay)), "revoked");
    assert.equal(net(pay), P180.cents - 20000);
    assert.equal(record(done.request_id).recorded_before_cents, 0);
    // The rest stays with us (the fee and the days used): nothing more is refunded.
    fails(
      refundSql(admin, pay, { amount: 100, reference: ozowRef("NALEDI") }),
      "PT409",
      /payment_not_refundable/
    );
  });

  await check("a part refund of our failure keeps the slot running", () => {
    const pay = buy(naledi, P180);
    const one = refund(admin, pay, {
      amount: 5000,
      code: "our_failure_after_fix_offered",
      reason: "Lost days refunded after the fix was offered",
      reference: ozowRef("NALEDI"),
    });
    assert.deepEqual(
      [one.status, one.payment_status, one.ends_paid_days, one.released_activations],
      ["applied", "complete", false, 0]
    );
    assert.equal(grantStatus(grantOf(pay)), "active");
    assert.equal(
      Number(
        q(
          `select count(*) from private.outbox_events where kind='payment_reversed' and dedupe_key='payment_part_refund:${one.request_id}';`
        )
      ),
      1
    );
    const two = refund(admin, pay, {
      amount: 5000,
      code: "billing_error",
      reason: "Charged twice for one day",
      reference: ozowRef("NALEDI"),
    });
    assert.equal(two.ends_paid_days, false);
    assert.equal(left(pay), P180.cents - 10000);
    assert.equal(left(pay, lineOf(pay)), P180.cents - 10000);
    assert.equal(net(pay), P180.cents - 10000);
    fails(
      refundSql(admin, pay, { amount: P180.cents - 9999, reference: ozowRef("NALEDI") }),
      "PT409",
      /refund_more_than_left/
    );
    fails(
      refundSql(admin, pay, {
        amount: 100,
        code: "duplicate",
        reference: ozowRef("NALEDI"),
      }),
      "PT409",
      /refund_whole_only/
    );
    fails(
      refundSql(admin, pay, { amount: 0, reference: ozowRef("NALEDI") }),
      "22023",
      /refund_amount_invalid/
    );
    // The earlier whole-refund commands can no longer pay back more than is left.
    fails(
      staff(
        admin,
        `select api.record_staff_payment_refund('${pay}','refunded','billing_error','Whole refund','${ozowRef("NALEDI")}');`
      ),
      "PT409",
      /refund_more_than_left/
    );
    fails(
      staff(
        admin,
        `select api.record_staff_slot_refund('${lineOf(pay)}','refunded','billing_error','Whole refund','${ozowRef("NALEDI")}');`
      ),
      "PT409",
      /refund_more_than_left/
    );
    assert.equal(grantStatus(grantOf(pay)), "active");
    // Everything left (no amount): the paid days end.
    const rest = refund(admin, pay, { code: "billing_error", reference: ozowRef("NALEDI") });
    assert.deepEqual(
      [rest.amount_cents, rest.ends_paid_days, rest.payment_status],
      [P180.cents - 10000, true, "refunded"]
    );
    assert.equal(grantStatus(grantOf(pay)), "revoked");
    assert.equal(net(pay), 0);
    fails(
      refundSql(admin, pay, { reference: ozowRef("NALEDI") }),
      "PT409",
      /payment_not_refundable/
    );
  });

  await check("one slot of an order: part of it, what is left per slot", () => {
    const pay = buy(naledi, P30, 3);
    const [l1, l2, l3] = [1, 2, 3].map((n) => lineOf(pay, n));
    const ended = refund(admin, pay, { line: l1, amount: 3000, reference: ozowRef("ORDER") });
    assert.deepEqual(
      [ended.status, ended.payment_status, ended.line_id],
      ["applied", "complete", l1]
    );
    assert.deepEqual([lineStatus(l1), grantStatus(grantOf(pay, 1))], ["reversed", "revoked"]);
    fails(
      refundSql(admin, pay, { line: l1, amount: 100, reference: ozowRef("ORDER") }),
      "PT409",
      /payment_not_refundable/
    );
    const kept = refund(admin, pay, {
      line: l2,
      amount: 2000,
      code: "our_failure_after_fix_offered",
      reference: ozowRef("ORDER"),
    });
    assert.equal(kept.ends_paid_days, false);
    assert.deepEqual([lineStatus(l2), grantStatus(grantOf(pay, 2))], ["open", "active"]);
    assert.equal(left(pay, l2), P30.cents - 2000);
    assert.equal(left(pay), 3 * P30.cents - 5000);
    fails(
      refundSql(admin, pay, { line: l2, amount: P30.cents - 1999, reference: ozowRef("ORDER") }),
      "PT409",
      /refund_more_than_left/
    );
    // A slot reversed: the whole order is refunded slot by slot.
    fails(refundSql(admin, pay, { reference: ozowRef("ORDER") }), "PT409", /payment_slot_reversed/);
    assert.equal(net(pay), 3 * P30.cents - 5000);
    assert.equal(lineStatus(l3), "open");
  });

  await check("repeats: the same request returns its state; other input is refused", () => {
    const pay = buy(naledi, P180);
    const reference = ozowRef("REPEAT");
    const input = {
      amount: 4000,
      code: "our_failure_after_fix_offered",
      reference,
    };
    const first = refund(admin, pay, input);
    const again = refund(admin, pay, input);
    assert.deepEqual([again.request_id, again.repeated], [first.request_id, true]);
    assert.equal(requests(pay), 1);
    fails(refundSql(admin, pay, { ...input, amount: 4001 }), "PT409", /ozow_reference_used/);
    fails(refundSql(admin2, pay, input), "PT409", /ozow_reference_used/);
  });

  await check("above R1 000 in total, a second staff member approves", () => {
    const pay = buy(verified("part-big"), P180, 3); // R1 242
    const first = refund(admin, pay, {
      amount: 90000,
      code: "our_failure_after_fix_offered",
      reference: ozowRef("BIG"),
    });
    assert.deepEqual([first.status, first.needs_approval], ["applied", false]);
    // R900 + R200 is above R1 000: splitting does not avoid the second person.
    const second = refund(admin, pay, {
      amount: 20000,
      code: "our_failure_after_fix_offered",
      reference: ozowRef("BIG"),
    });
    assert.deepEqual([second.status, second.needs_approval], ["awaiting_approval", true]);
    fails(
      refundSql(admin2, pay, { amount: 100, reference: ozowRef("BIG") }),
      "PT409",
      /refund_awaiting_approval/
    );
    fails(approveSql(admin, second.request_id), "42501", /refund_approver_same/);
    const approved = json(approveSql(admin2, second.request_id));
    assert.deepEqual([approved.status, approved.payment_status], ["applied", "complete"]);
    assert.equal(record(second.request_id).released_activations, 0);
    for (const n of [1, 2, 3]) assert.equal(grantStatus(grantOf(pay, n)), "active");
    assert.equal(left(pay), 3 * P180.cents - 110000);
    // A waiting cancellation credit ends the paid days once approved.
    const third = refund(admin, pay, {
      line: lineOf(pay, 3),
      amount: 1000,
      reference: ozowRef("BIG"),
    });
    assert.equal(third.status, "awaiting_approval");
    json(approveSql(admin2, third.request_id));
    assert.deepEqual(
      [lineStatus(lineOf(pay, 3)), grantStatus(grantOf(pay, 3))],
      ["reversed", "revoked"]
    );
  });

  await check("staff and members: the staff rules hold", () => {
    const pay = buy(naledi, P30);
    fails(
      member(
        naledi,
        `select api.record_staff_refund('${pay}',null,'reference',100,'billing_error','Mine please',${sqlValue(ozowRef("SELF"))},null,null);`
      ),
      "42501"
    );
    const own = buy(admin, P30);
    fails(refundSql(admin, own, { reference: ozowRef("OWN") }), "42501", /staff_same_identity/);
    fails(
      staff(
        admin,
        `select api.record_staff_refund('${pay}',null,'cash',null,'billing_error','Paid in cash',null,null,null);`
      ),
      "22023",
      /refund channel required/
    );
    // An authenticator code older than 15 minutes.
    fails(
      staff(
        admin,
        `select api.record_staff_refund('${pay}',null,'reference',100,'billing_error','Late code','${ozowRef("OLD")}',null,null);`,
        Math.floor(Date.now() / 1000) - 3600
      ),
      "42501",
      /recent second-factor/
    );
  });

  // A slot with a renewal waiting: only a refund that ends the paid days waits for it.
  await check("a waiting renewal blocks only a refund that ends the paid days", () => {
    const owner = verified("part-renew");
    const pay = buy(owner, P30);
    const grant = grantOf(pay);
    replica(`update private.entitlements set starts_at=now()-interval '20 days',
      ends_at=now()+interval '10 days' where id='${grant}';`);
    const quoted = json(
      member(
        owner,
        `select api.start_slot_renewal_checkout(array['${grant}']::uuid[],'${P30.id}',${P30.cents},true);`
      )
    );
    const renewal = quoted.payment_id;
    const lease = json(service(`select api.claim_checkout_request('${renewal}','${owner.id}');`));
    if (!lease.checkout_url)
      q(
        service(
          `select api.complete_checkout_request('${renewal}','${owner.id}','${lease.claim_token}','req-${renewal}','https://one.ozow.com/checkout/req-${renewal}');`
        )
      );
    const event = {
      payload_sha256: createHash("sha256").update(`event-${renewal}-complete`).digest("hex"),
      merchant_reference: q(
        `select merchant_reference from private.payments where id='${renewal}';`
      ),
      provider_request_id: `req-${renewal}`,
      provider_transaction_id: `tx-${renewal}`,
      status: "complete",
      amount_cents: P30.cents,
      currency: "ZAR",
    };
    json(service(`select api.apply_provider_event($e$${JSON.stringify(event)}$e$::jsonb);`));
    fails(
      refundSql(admin, pay, { amount: 1000, reference: ozowRef("RENEW") }),
      "PT409",
      /renewal_queued/
    );
    const kept = refund(admin, pay, {
      amount: 1000,
      code: "our_failure_after_fix_offered",
      reference: ozowRef("RENEW"),
    });
    assert.deepEqual([kept.status, kept.ends_paid_days], ["applied", false]);
    assert.equal(grantStatus(grant), "active");
  });

  // LIM-F-get_staff_refunds_left: up to 50 payments.
  await check("the staff list read: what is left, the dates, the first purchase", () => {
    const owner = verified("part-list");
    const pay = buy(owner, P180);
    const other = buy(owner, P30, 2);
    refund(admin, pay, { amount: 1500, code: "billing_error", reference: ozowRef("LIST") });
    const rows = json(
      staff(admin, `select api.get_staff_refunds_left(array['${pay}','${other}']::uuid[]);`)
    );
    const byId = Object.fromEntries(rows.map((r) => [r.payment_id, r]));
    assert.deepEqual(
      [byId[pay].refunded_cents, byId[pay].left_cents, byId[pay].first_purchase],
      [1500, P180.cents - 1500, true]
    );
    assert.match(byId[pay].first_purchase_ask_until, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(byId[pay].ozow_refund_until, null); // not a UUID Ozow transaction
    assert.equal(byId[pay].lines.length, 1);
    assert.equal(byId[pay].lines[0].left_cents, P180.cents - 1500);
    assert.ok(byId[pay].lines[0].starts_at && byId[pay].lines[0].ends_at);
    assert.deepEqual(
      [byId[other].first_purchase, byId[other].first_purchase_ask_until, byId[other].lines.length],
      [false, null, 2]
    );
    fails(member(owner, `select api.get_staff_refunds_left(array['${pay}']::uuid[]);`), "42501");
    fails(
      staff(
        admin,
        `select api.get_staff_refunds_left(array(select gen_random_uuid() from generate_series(1,51)));`
      ),
      "22023"
    );
  });

  await check("a bank transfer back after Ozow's window, for part of a payment", () => {
    const pay = buy(verified("part-bank"), P180, 1, true);
    paidAgo(pay, "20 days");
    fails(
      refundSql(admin, pay, { channel: "ozow", amount: 1000 }),
      "PT409",
      /outside_refund_window/
    );
    const done = refund(admin, pay, { amount: 12000, reference: "FNB PART 0001" });
    assert.deepEqual([done.status, done.channel, done.ends_paid_days], ["applied", "manual", true]);
    assert.equal(record(done.request_id).ozow_reference, "FNB PART 0001");
  });

  await check("Ozow dashboard: Ozow's amount must be the part recorded", () => {
    const pay = buy(verified("part-dash"), P180, 1, true);
    const refundId = randomUUID();
    const fact = {
      refund_id: refundId,
      transaction_id: transactionOf(pay),
      amount_cents: 2500,
      status: "Complete",
      requested_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };
    fails(
      refundSql(admin, pay, {
        channel: "dashboard",
        amount: 3000,
        code: "our_failure_after_fix_offered",
        reference: refundId,
        fact,
      }),
      "PT409",
      /ozow_refund_mismatch/
    );
    fails(
      refundSql(admin, buy(verified("part-dash-tx"), P30), {
        channel: "dashboard",
        amount: 100,
        reference: refundId,
      }),
      "PT409",
      /payment_not_ozow/
    );
    const done = refund(admin, pay, {
      channel: "dashboard",
      amount: 2500,
      code: "our_failure_after_fix_offered",
      reference: refundId,
      fact,
    });
    assert.deepEqual(
      [done.status, done.channel, done.ends_paid_days, done.payment_status],
      ["applied", "dashboard", false, "complete"]
    );
    fails(
      refundSql(admin, pay, { channel: "dashboard", amount: 100, reference: refundId }),
      "PT409",
      /ozow_refund_id_used/
    );
  });

  // Last: once a refund was sent through Ozow, typed Ozow references retire.
  await check("several part refunds of one payment through Ozow", () => {
    const pay = buy(verified("part-api"), P180, 1, true);
    const one = refund(admin, pay, {
      channel: "ozow",
      amount: 1500,
      code: "our_failure_after_fix_offered",
    });
    assert.deepEqual([one.status, one.channel, one.ends_paid_days], ["approved", "api", false]);
    fails(refundSql(admin, pay, { channel: "ozow", amount: 1000 }), "PT409", /refund_in_flight/);
    const claimed = claim(one.request_id);
    assert.deepEqual([claimed.claimed, claimed.amount_cents], [true, 1500]);
    assert.equal(
      sendResult(one.request_id, { outcome: "accepted", ...ozowFact(claimed, "Complete") }).outcome,
      "applied"
    );
    assert.equal(record(one.request_id).status, "applied");
    assert.deepEqual([payStatus(pay), grantStatus(grantOf(pay))], ["complete", "active"]);
    // The rest of it, ending the paid days: Ozow confirms; the slot ends.
    const two = refund(admin, pay, { channel: "ozow" });
    assert.deepEqual([two.amount_cents, two.ends_paid_days], [P180.cents - 1500, true]);
    const claimed2 = claim(two.request_id);
    assert.equal(claimed2.amount_cents, P180.cents - 1500);
    assert.equal(
      sendResult(two.request_id, { outcome: "accepted", ...ozowFact(claimed2, "Complete") })
        .outcome,
      "applied"
    );
    assert.deepEqual([payStatus(pay), grantStatus(grantOf(pay))], ["refunded", "revoked"]);
    assert.equal(net(pay), 0);
  });

  await check("no grant beyond the staff commands; the helpers are internal", () => {
    const grants = executeGrants(json, [...COMMANDS, ...ADDED]);
    for (const signature of COMMANDS) assert.deepEqual(grants[signature], STAFF, signature);
    for (const signature of ADDED) assert.deepEqual(grants[signature], NONE, signature);
  });
  await check("preflight counts part refunds; the rollback refuses once one exists", () => {
    const rows = preflight();
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.match(
      rows[0][1],
      /^staff part refunds: already applied; .*; part refunds: [1-9][0-9]*$/
    );
    const before = fingerprint();
    assert.match(fails(kit.rollbackSql, "55000"), /first-purchase or part refunds/);
    assert.equal(fingerprint(), before);
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep part refunds", () => {
      const pay = buy(verified("part-later"), P180);
      const done = refund(admin, pay, {
        amount: 1000,
        code: "our_failure_after_fix_offered",
        reference: ozowRef("LATER"),
      });
      assert.equal(done.ends_paid_days, false);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Staff part refunds checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
