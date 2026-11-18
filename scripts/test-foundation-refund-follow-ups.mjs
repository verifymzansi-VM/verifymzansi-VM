#!/usr/bin/env node
// Behaviour checks for 20261118182332_refund_follow_ups.sql (owner's decisions
// of 18 November 2026): the reason "Cancelled before the renewal started", a
// slot's waiting renewal refunded first, refunds through Ozow only within 13
// days of the payment, and after that the money paid back by bank transfer
// and recorded with the bank reference.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff act with a verified authenticator app and an AAL2 session,
// members with synthetic sessions, the website server's Ozow jobs as
// `service_role`. Payments are made through the slot checkout and settled with
// a synthetic Ozow notice; a payment's age and a grant's dates are set as the
// database owner with triggers off; nothing else is written directly. The
// script checks the read-only preflight and the update's refusals, applies the
// update, proves apply -> rollback -> apply returns the schema fingerprint to
// the same values, then checks: the new reason only for a renewal whose days
// have not started (a reference, through Ozow); a period whose slot has a
// waiting renewal is refused in every channel, approving and sending check it
// again, a chargeback is not refused; a declined record's reference may be
// recorded again; a refund through Ozow at day 12 is sent, at day 13 refused,
// approving after the window is refused and one approved in time fails before
// it is sent (no alert); a dashboard record after the window is accepted; an
// Ozow payment past the window is paid back with a bank reference (spaces
// allowed) also once refunds through Ozow are used; the grants; the preflight
// counts; and that the rollback refuses once the new reason was recorded.
//
//   node --import tsx scripts/test-foundation-refund-follow-ups.mjs
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

const UPDATE = "20261118182332_refund_follow_ups.sql";
const REVIEWED = {
  "internal.assert_staff_refund_reason(text,text,text)": "9bdc2d6c07af6313c21463bd5fdca8d0",
  "internal.assert_staff_refund_input(text,text,text,text)": "09b161b7933849f4f5c221dd3c6e6f6d",
  "internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text)":
    "31f93ac046f3cb4b73bc6896e8e4d2a3",
  "internal.payment_refund_reference_rule()": "5f84fd9a07a75476cf72b741b20f5806",
  "internal.payment_refund_request_guard()": "08e1cff16910b59c8d305a1eae7f7b56",
  "internal.record_staff_payment_refund(uuid,text,text,text,text)":
    "2ba50b5b15c6259c1b2c6369d3473e90",
  "internal.record_staff_slot_refund(uuid,text,text,text,text)": "193a2b3abdbc83b0b16d81d759dc168e",
  "internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb)":
    "b47de2156d93ce9ee6a48bcb6d206adc",
  "internal.approve_staff_payment_refund(uuid)": "6c7090e7cb1fee5fffd3c3495e76e2ab",
  "internal.claim_ozow_refund_send(uuid)": "0b9666cbe9d56092d32b11e326c1fb90",
};
const ADDED = [
  "internal.ozow_refund_window()",
  "internal.ozow_refund_window_open(uuid)",
  "internal.refund_by_bank_transfer(uuid,text)",
  "internal.refund_renewal_waiting(uuid,uuid)",
  "internal.refund_renewal_not_started(uuid,uuid)",
  "internal.staff_refund_reference(uuid,text,text)",
];
const STAFF_COMMANDS = [
  "api.record_staff_payment_refund(uuid,text,text,text,text)",
  "api.record_staff_slot_refund(uuid,text,text,text,text)",
  "api.request_staff_ozow_refund(uuid,uuid,text,text)",
  "api.record_staff_dashboard_refund(uuid,uuid,text,text,uuid,jsonb)",
  "api.approve_staff_payment_refund(uuid)",
  "api.decline_staff_payment_refund(uuid,text)",
];
const NONE = { anon: false, authenticated: false, service_role: false };
const STAFF = { anon: false, authenticated: true, service_role: false };
const NOT_APPLIED =
  /^refund follow-ups: update not applied; waiting for approval: 0; through Ozow not sent: 0; past Ozow's 13 days: 0; while a renewal waits: 0; declined references: 0$/;

const started = Date.now();
const { check, current, passed: checks } = createChecks();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const kit = updateCheckKit(database, UPDATE, current);
  const world = createPaymentWorld(kit);
  const { admin, admin2 } = twoAdmins(world, "refund");
  const { q, json, fails, member, staff, service, preflight, fingerprint } = kit;
  const verified = (label) => world.verified(label, admin);
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
  const replica = (sql) =>
    q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);

  /** A completed Ozow slot order (Ozow's transaction id a UUID, so it can be refunded through Ozow). */
  const buy = (owner, plan = P30, slots = 1) =>
    completeSlotOrder({ q, json, member, service }, owner, plan, slots, randomUUID()).id;
  const lineOf = (paymentId, n = 1) =>
    q(`select id from private.payment_lines where payment_id='${paymentId}' and line_number=${n};`);
  const grantOf = (paymentId, n = 1) =>
    q(`select e.id from private.entitlements e join private.payment_lines l on l.id=e.payment_line_id
       where l.payment_id='${paymentId}' and l.line_number=${n};`);
  const grantStatus = (id) => q(`select status from private.entitlements where id='${id}';`);
  /** The slot ends in 10 days, so it can be renewed (renewing opens 14 days before the end). */
  const endsSoon = (grant) =>
    replica(`update private.entitlements set starts_at=now()-interval '20 days',
      ends_at=now()+interval '10 days' where id='${grant}';`);
  /** Renews the slot through the renewal checkout; Ozow settles it. Returns the renewal payment. */
  const renew = (owner, grant, plan = P30) => {
    const quoted = json(
      member(
        owner,
        `select api.start_slot_renewal_checkout(array['${grant}']::uuid[],'${plan.id}',${plan.cents},true);`
      )
    );
    const id = quoted.payment_id;
    const lease = json(service(`select api.claim_checkout_request('${id}','${owner.id}');`));
    if (!lease.checkout_url)
      q(
        service(
          `select api.complete_checkout_request('${id}','${owner.id}','${lease.claim_token}','req-${id}','https://one.ozow.com/checkout/req-${id}');`
        )
      );
    const ref = q(`select merchant_reference from private.payments where id='${id}';`);
    const event = {
      payload_sha256: createHash("sha256").update(`event-${id}-complete`).digest("hex"),
      merchant_reference: ref,
      provider_request_id: `req-${id}`,
      provider_transaction_id: randomUUID(),
      status: "complete",
      amount_cents: plan.cents,
      currency: "ZAR",
    };
    assert.equal(
      json(service(`select api.apply_provider_event($e$${JSON.stringify(event)}$e$::jsonb);`))
        .outcome,
      "completed"
    );
    return id;
  };
  /** The payment was made `interval` ago (the Ozow refund window counts from it). */
  const paidAgo = (paymentId, interval) =>
    replica(
      `update private.payments set created_at=now()-interval '${interval}' where id='${paymentId}';`
    );
  const payStatus = (paymentId) =>
    q(`select status from private.payments where id='${paymentId}';`);
  const record = (id) =>
    json(`select to_jsonb(r) from private.payment_refund_requests r where r.id='${id}';`);
  const problems = (paymentId) =>
    Number(q(`select count(*) from private.payment_problems where payment_id='${paymentId}';`));

  const refundSql = (
    who,
    paymentId,
    reference,
    { kind = "refunded", code = "s14_cancellation", reason = "Cancelled within 14 days" } = {}
  ) =>
    staff(
      who,
      `select api.record_staff_payment_refund('${paymentId}','${kind}','${code}',${sqlValue(reason)},${sqlValue(reference)});`
    );
  const slotRefundSql = (who, lineId, reference, code = "s14_cancellation") =>
    staff(
      who,
      `select api.record_staff_slot_refund('${lineId}','refunded','${code}','Cancelled within 14 days',${sqlValue(reference)});`
    );
  const ozowSql = (who, paymentId, lineId = null, code = "s14_cancellation") =>
    staff(
      who,
      `select api.request_staff_ozow_refund('${paymentId}',${sqlValue(lineId)},'${code}','Cancelled within 14 days');`
    );
  const dashboardSql = (who, paymentId, lineId = null) =>
    staff(
      who,
      `select api.record_staff_dashboard_refund('${paymentId}',${sqlValue(lineId)},'billing_error','Refunded by hand in Ozow','${randomUUID()}',null);`
    );
  const approveSql = (who, id) => staff(who, `select api.approve_staff_payment_refund('${id}');`);
  const declineSql = (who, id) =>
    staff(who, `select api.decline_staff_payment_refund('${id}','Recorded too early');`);
  const claim = (id) => json(service(`select api.claim_ozow_refund_send('${id}');`));

  // ------------------------------------------------------------ before
  const early = verified("refund-early");
  const earlyPay = buy(early);

  await check("before the update: the new reason is refused", () => {
    for (const [signature, md5] of Object.entries(REVIEWED))
      assert.equal(bodyMd5(signature), md5, signature);
    for (const signature of ADDED) assert.equal(bodyMd5(signature), "missing", signature);
    fails(
      refundSql(admin, earlyPay, "OZ-EARLY-0001", { code: "renewal_cancelled_before_start" }),
      "22023",
      /refund_reason_code_invalid/
    );
  });
  await check("preflight: read only; reads 'not applied'", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], NOT_APPLIED);
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("drift and a premature rollback are refused", () => {
    assertDriftRefused(kit, {
      label: "refund follow-ups",
      signatures: Object.keys(REVIEWED),
      rows: 2,
    });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "refund follow-ups",
    applied:
      /^refund follow-ups: already applied; waiting for approval: 0; through Ozow not sent: 0; past Ozow's 13 days: 0; while a renewal waits: 0; declined references: 0$/,
    notApplied: NOT_APPLIED,
  });

  // Refunds recorded with a reference come first: once a refund has been sent
  // through Ozow, Ozow payments in their window are refunded only through Ozow.
  const thandi = verified("refund-thandi");
  const current1 = buy(thandi);
  const period1 = grantOf(current1);
  endsSoon(period1);
  const renewal1 = renew(thandi, period1);
  const renewalGrant1 = grantOf(renewal1);

  await check("a period whose slot has a renewal waiting is refused in every channel", () => {
    assert.equal(grantStatus(renewalGrant1), "active");
    for (const sql of [
      refundSql(admin, current1, "OZ-THANDI-0001"),
      slotRefundSql(admin, lineOf(current1), "OZ-THANDI-0002"),
      ozowSql(admin, current1),
      ozowSql(admin, current1, lineOf(current1)),
      dashboardSql(admin, current1),
    ])
      fails(sql, "PT409", /renewal_queued/);
    assert.equal(payStatus(current1), "complete");
    assert.equal(
      Number(
        q(`select count(*) from private.payment_refund_requests where payment_id='${current1}';`)
      ),
      0
    );
  });
  await check(
    "'cancelled before the renewal started' fits only a renewal whose days have not started",
    () => {
      // Not a renewal.
      for (const sql of [
        refundSql(admin, current1, "OZ-THANDI-0003", { code: "renewal_cancelled_before_start" }),
        slotRefundSql(admin, lineOf(current1), "OZ-THANDI-0004", "renewal_cancelled_before_start"),
        ozowSql(admin, current1, null, "renewal_cancelled_before_start"),
      ])
        fails(sql, "PT409", /renewal_already_started/);
      // The renewal, whole payment (one renewed slot): accepted, and it ends the renewal only.
      const done = json(
        refundSql(admin, renewal1, "OZ-THANDI-0005", {
          code: "renewal_cancelled_before_start",
          reason: "Member cancelled the renewal",
        })
      );
      assert.deepEqual([done.status, done.payment_status], ["applied", "refunded"]);
      assert.equal(grantStatus(renewalGrant1), "revoked");
      assert.equal(grantStatus(period1), "active");
      assert.equal(record(done.request_id).reason_code, "renewal_cancelled_before_start");
    }
  );
  await check("once the renewal is refunded, the current period can be refunded", () => {
    const done = json(refundSql(admin, current1, "OZ-THANDI-0006"));
    assert.deepEqual([done.status, done.payment_status], ["applied", "refunded"]);
    assert.equal(grantStatus(period1), "revoked");
  });

  const enhle = verified("refund-enhle");
  const current2 = buy(enhle);
  endsSoon(grantOf(current2));
  const renewal2 = renew(enhle, grantOf(current2));
  await check("one renewed slot of a renewal; a renewal that has started does not fit", () => {
    replica(
      `update private.entitlements set starts_at=now()-interval '1 hour' where id='${grantOf(renewal2)}';`
    );
    fails(
      slotRefundSql(admin, lineOf(renewal2), "OZ-ENHLE-0001", "renewal_cancelled_before_start"),
      "PT409",
      /renewal_already_started/
    );
    // Started: the period before it is no longer waiting for it.
    replica(
      `update private.entitlements set starts_at=now()+interval '10 days' where id='${grantOf(renewal2)}';`
    );
    const done = json(
      slotRefundSql(admin, lineOf(renewal2), "OZ-ENHLE-0002", "renewal_cancelled_before_start")
    );
    assert.equal(done.status, "applied");
    assert.equal(grantStatus(grantOf(renewal2)), "revoked");
  });

  const mpho = verified("refund-mpho");
  const current3 = buy(mpho);
  endsSoon(grantOf(current3));
  const renewal3 = renew(mpho, grantOf(current3));
  await check("a chargeback is not refused while a renewal waits; the renewal stays", () => {
    const done = json(
      refundSql(admin, current3, "OZ-MPHO-CB01", { kind: "chargeback", code: "billing_error" })
    );
    assert.deepEqual([done.status, done.payment_status], ["applied", "chargeback"]);
    assert.equal(grantStatus(grantOf(renewal3)), "active");
  });

  // Above R1 000 another staff member approves.
  const sipho = verified("refund-sipho");
  const big = buy(sipho, P180, 3);
  let declined;
  await check("approving checks the renewal rule again; a declined reference is free again", () => {
    const waiting = json(refundSql(admin, big, "OZ-SIPHO-0001"));
    assert.equal(waiting.status, "awaiting_approval");
    // A renewal of one of its slots is bought while the refund waits.
    endsSoon(grantOf(big, 2));
    const renewal = renew(sipho, grantOf(big, 2));
    fails(approveSql(admin2, waiting.request_id), "PT409", /renewal_queued/);
    assert.equal(record(waiting.request_id).status, "awaiting_approval");
    assert.match(
      preflight()[0][1],
      /^refund follow-ups: already applied; waiting for approval: 1; through Ozow not sent: 0; past Ozow's 13 days: 0; while a renewal waits: 1; declined references: 0$/
    );
    q(declineSql(admin2, waiting.request_id));
    declined = waiting.request_id;
    // Renewal first, then the same refund with the same reference again: a new record.
    assert.equal(
      json(refundSql(admin, renewal, "OZ-SIPHO-0002", { code: "renewal_cancelled_before_start" }))
        .status,
      "applied"
    );
    const again = json(refundSql(admin, big, "OZ-SIPHO-0001"));
    assert.equal(again.status, "awaiting_approval");
    assert.equal(again.repeated, false);
    assert.notEqual(again.request_id, declined);
    // Repeating it returns the waiting record, not the declined one.
    const repeat = json(refundSql(admin, big, "OZ-SIPHO-0001"));
    assert.deepEqual([repeat.request_id, repeat.repeated], [again.request_id, true]);
    // A reference still in use stays refused.
    fails(
      refundSql(admin, buy(verified("refund-sipho2")), "oz-sipho-0001"),
      "PT409",
      /ozow_reference_used/
    );
    const approved = json(approveSql(admin2, again.request_id));
    assert.deepEqual([approved.status, approved.payment_status], ["applied", "refunded"]);
    assert.equal(record(declined).status, "declined");
  });

  // ------------------------------------------------- refunds through Ozow
  const lindiwe = verified("refund-lindiwe");
  const current4 = buy(lindiwe);
  await check(
    "sending checks the renewal rule again (the refund fails as 'payment changed')",
    () => {
      const approved = json(ozowSql(admin, current4));
      assert.equal(approved.status, "approved");
      endsSoon(grantOf(current4));
      const renewal = renew(lindiwe, grantOf(current4));
      const claimed = claim(approved.request_id);
      assert.deepEqual([claimed.claimed, claimed.status], [false, "failed"]);
      assert.equal(record(approved.request_id).failure_reason, "payment_changed");
      assert.equal(record(approved.request_id).send_attempts, 0);
      // The renewal itself, through Ozow, with the new reason.
      const renewalRefund = json(ozowSql(admin, renewal, null, "renewal_cancelled_before_start"));
      assert.equal(renewalRefund.status, "approved");
      assert.equal(claim(renewalRefund.request_id).claimed, true);
    }
  );

  const zola = verified("refund-zola");
  await check("Ozow's window: day 12 is sent, 13 days is refused before anything is asked", () => {
    const day12 = buy(zola);
    paidAgo(day12, "12 days 23 hours");
    const sent = json(ozowSql(admin, day12));
    assert.equal(sent.status, "approved");
    assert.equal(claim(sent.request_id).claimed, true);
    const day13 = buy(zola);
    paidAgo(day13, "13 days");
    fails(ozowSql(admin, day13), "PT409", /outside_refund_window/);
    fails(ozowSql(admin, day13, lineOf(day13)), "PT409", /outside_refund_window/);
    assert.equal(
      Number(
        q(`select count(*) from private.payment_refund_requests where payment_id='${day13}';`)
      ),
      0
    );
  });
  await check(
    "approving after the window is refused; one approved in time fails unsent, with no alert",
    () => {
      const bigLate = buy(verified("refund-busi"), P180, 3);
      paidAgo(bigLate, "12 days");
      const waiting = json(ozowSql(admin, bigLate));
      assert.equal(waiting.status, "awaiting_approval");
      paidAgo(bigLate, "13 days 1 minute");
      fails(approveSql(admin2, waiting.request_id), "PT409", /outside_refund_window/);
      assert.equal(record(waiting.request_id).status, "awaiting_approval");
      q(declineSql(admin2, waiting.request_id));

      const late = buy(zola);
      paidAgo(late, "12 days");
      const approved = json(ozowSql(admin, late));
      paidAgo(late, "13 days 1 minute");
      assert.match(
        preflight()[0][1],
        /^refund follow-ups: already applied; waiting for approval: \d+; through Ozow not sent: 1; past Ozow's 13 days: 1; /
      );
      const claimed = claim(approved.request_id);
      assert.deepEqual([claimed.claimed, claimed.status], [false, "failed"]);
      const failed = record(approved.request_id);
      assert.deepEqual(
        [failed.failure_reason, failed.send_attempts, failed.sent_at],
        ["outside_refund_window", 0, null]
      );
      assert.equal(problems(late), 0);
      // Listed for staff under 'Refunds that need staff'.
      const view = json(
        staff(admin, `select api.get_staff_ozow_refunds(array['${late}']::uuid[]);`)
      );
      assert.ok(
        view.attention.some(
          (r) => r.id === approved.request_id && r.failure_reason === "outside_refund_window"
        )
      );
      // Paid back by bank transfer (refunds through Ozow are in use now): the bank reference, spaces allowed.
      const back = json(
        refundSql(admin, late, " FNB  refund 0001 ", { reason: "Paid back by bank transfer" })
      );
      assert.equal(back.status, "applied");
      assert.equal(record(back.request_id).ozow_reference, "FNB refund 0001");
      assert.equal(payStatus(late), "refunded");
      assert.ok(
        !json(
          staff(admin, `select api.get_staff_ozow_refunds(array['${late}']::uuid[]);`)
        ).attention.some((r) => r.id === approved.request_id)
      );
    }
  );
  await check("after the window: bank reference rules; in the window: Ozow only", () => {
    const owner = verified("refund-lerato");
    const late = buy(owner);
    paidAgo(late, "20 days");
    fails(refundSql(admin, late, "A B"), "22023", /refund_reference_invalid/);
    fails(refundSql(admin, late, "  "), "22023", /refund_reference_required/);
    // A chargeback of it keeps Ozow's reference (no spaces).
    fails(
      refundSql(admin, late, "CB 0001", { kind: "chargeback", code: "billing_error" }),
      "22023",
      /ozow_reference_invalid/
    );
    const inWindow = buy(owner);
    fails(refundSql(admin, inWindow, "OZ-LERATO-0001"), "PT409", /ozow_reference_retired/);
    fails(refundSql(admin, inWindow, "FNB 0001"), "22023", /ozow_reference_invalid/);
    // The reference rule itself (not only the commands) allows spaces only for a bank pay-back.
    fails(
      `insert into private.payment_refund_requests(payment_id,account_id,kind,reason_code,reason,ozow_reference,
         amount_cents,recorded_before_cents,needs_approval,status,requested_by)
       values('${inWindow}','${owner.id}','chargeback','billing_error','Direct write','FNB 0002',6900,0,false,
         'awaiting_approval','${admin.id}');`,
      "23514",
      /paid back by bank transfer may contain spaces/
    );
    // A refund already made in the Ozow dashboard is recorded whenever it was made.
    const dash = json(dashboardSql(admin, late));
    assert.equal(dash.status, "applied");
  });

  await check("no grant changed; the helpers are internal", () => {
    const grants = executeGrants(json, [...STAFF_COMMANDS, ...ADDED]);
    for (const signature of STAFF_COMMANDS) assert.deepEqual(grants[signature], STAFF, signature);
    for (const signature of ADDED) assert.deepEqual(grants[signature], NONE, signature);
    assert.deepEqual(
      executeGrants(json, ["api.claim_ozow_refund_send(uuid)"])["api.claim_ozow_refund_send(uuid)"],
      {
        anon: false,
        authenticated: false,
        service_role: true,
      }
    );
  });
  await check("the rollback refuses once the new reason was recorded", () => {
    const before = fingerprint();
    assert.match(fails(kit.rollbackSql, "55000"), /renewal_cancelled_before_start/);
    assert.equal(fingerprint(), before);
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the refund follow-ups", () => {
      const owner = verified("refund-later");
      const pay = buy(owner);
      paidAgo(pay, "14 days");
      fails(ozowSql(admin, pay), "PT409", /outside_refund_window/);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Refund follow-ups checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
