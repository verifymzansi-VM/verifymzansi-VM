#!/usr/bin/env node
// Behaviour checks for 20261125194727_part_refund_follow_ups.sql (launch
// checklist item 56, batch A): the follow-ups of the staff part refunds.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff act with a verified authenticator app and an AAL2 session,
// members with synthetic sessions. Payments are made through the slot checkout
// and settled with a synthetic Ozow notice; a payment waiting for activation,
// and a slot reversal without a refund record (a bank's chargeback notice),
// are set up as the database owner. The script checks the read-only
// preflight and the update's refusals, applies the update, proves apply ->
// rollback -> apply returns the schema fingerprint to the same values, then
// checks: a slot reversed after a keep-running part refund counts as refunded;
// "everything left" never repeats a keep-running part refund; a corrected
// reference or Ozow refund id with the same request id is refused; a
// keep-running part refund waits for activation; the staff read (0 left at
// payment level once a slot was reversed, the notice end, the plan's term and
// the lost days); and the lost-days preview's money already returned.
//
//   node --import tsx scripts/test-foundation-part-refund-follow-ups.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assertReadOnlyPreflight,
  completeSlotOrder,
  executeGrants,
  sqlJsonb,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  buyPackage,
  ozowSettle,
  functionBodyMd5,
  P180,
  P30,
  runTwoAdminUpdateCheck,
  sqlValue,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261125194727_part_refund_follow_ups.sql";
const REVIEWED = {
  "internal.payment_refunded_before_cents(uuid)": "edcb14caf62c8375f0216d828ecc276d",
  "internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid)":
    "ec6a4f471dc46d6c6c31338f10de07bf",
  "internal.get_staff_refunds_left(uuid[])": "5df1c510531ea6e328ca33cba01e0b9f",
  "internal.get_lost_days_preview(text)": "8174b52a62082b35692a7a7237e2d807",
};
const UPDATED = {
  "internal.payment_refunded_before_cents(uuid)": "2c0d95fd340de5cdeb5bd1822e9328f0",
  "internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid)":
    "b19dc0eb2d6059d45a2d4dc1e41509c3",
  "internal.get_staff_refunds_left(uuid[])": "213b445867763f0f1d33c3b58a4d432a",
  "internal.get_lost_days_preview(text)": "28911037e70036c47131c49994740942",
};
const STAFF_COMMANDS = [
  "api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid)",
  "api.get_staff_refunds_left(uuid[])",
  "api.get_lost_days_preview(text)",
  "internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid)",
  "internal.get_staff_refunds_left(uuid[])",
  "internal.get_lost_days_preview(text)",
];
const HELPER = "internal.payment_refunded_before_cents(uuid)";
const NONE = { anon: false, authenticated: false, service_role: false };
const STAFF = { anon: false, authenticated: true, service_role: false };
const NOT_APPLIED =
  /^part refund follow-ups: update not applied; part refunds keeping the slot running: \d+; of them on payments not activated: \d+; slots reversed after one: \d+$/;
const APPLIED =
  /^part refund follow-ups: already applied; part refunds keeping the slot running: \d+; of them on payments not activated: \d+; slots reversed after one: \d+$/;
const FAILURE = "our_failure_after_fix_offered";

await runTwoAdminUpdateCheck(
  { update: UPDATE, label: "follow56", title: "Part refund follow-ups" },
  async ({ database, check, kit, world, admin }) => {
    const { fails, json, member, preflight, q, service, staff } = kit;
    const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
    const verified = (label) => world.verified(label, admin);
    const replica = (sql) =>
      q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
    const buy = (owner, plan = P180, slots = 1, uuidTx = false) =>
      completeSlotOrder(
        { q, json, member, service },
        owner,
        plan,
        slots,
        uuidTx ? randomUUID() : null
      ).id;
    const lineOf = (paymentId, n = 1) =>
      q(
        `select id from private.payment_lines where payment_id='${paymentId}' and line_number=${n};`
      );
    const requests = (paymentId) =>
      Number(
        q(`select count(*) from private.payment_refund_requests where payment_id='${paymentId}';`)
      );
    const refundedBefore = (paymentId) =>
      Number(q(`select internal.payment_refunded_before_cents('${paymentId}');`));
    const refundSql = (
      paymentId,
      {
        line = null,
        channel = "reference",
        amount = null,
        code = FAILURE,
        reason = "Days we failed to provide",
        reference = null,
        fact = null,
        requestId = randomUUID(),
      } = {}
    ) =>
      staff(
        admin,
        `select api.record_staff_refund(${sqlValue(paymentId)}::uuid,${sqlValue(line)}::uuid,${sqlValue(channel)},${amount ?? "null"}::bigint,${sqlValue(code)},${sqlValue(reason)},${sqlValue(reference)},${fact ? sqlJsonb(fact) : "null::jsonb"},null,${sqlValue(requestId)}::uuid);`
      );
    const refund = (paymentId, options) => json(refundSql(paymentId, options));
    let refNo = 0;
    const ozowRef = (label) => `OZ-${label}-${String(++refNo).padStart(4, "0")}`;
    const refundsLeft = (paymentId) =>
      json(staff(admin, `select api.get_staff_refunds_left(array['${paymentId}']::uuid[]);`))[0];
    const lostDaysPreview = (email) =>
      json(staff(admin, `select api.get_lost_days_preview(${sqlValue(email)});`)).items;

    // ---------------------------------------------------------- before
    await check("before the update: the reviewed bodies; the read-only preflight", () => {
      assert.deepEqual(Object.keys(REVIEWED).map(bodyMd5), Object.values(REVIEWED));
      assertReadOnlyPreflight(database, kit.preflightSql);
      const rows = preflight();
      assert.deepEqual(
        rows.map((row) => row[0]),
        ["summary"]
      );
      assert.match(rows[0][1], NOT_APPLIED);
    });
    await check("drift and a premature rollback are refused", () => {
      assertDriftRefused(kit, {
        label: "part refund follow-ups",
        signatures: Object.keys(REVIEWED),
        rows: 2,
      });
    });

    // Recorded before the update: a keep-running part refund on a payment
    // that waits for activation (the preflight counts it).
    const waitingBefore = buy(verified("follow56-waiting-before"));
    replica(
      `update private.payments set fulfillment_status='needs_reconciliation' where id='${waitingBefore}';`
    );
    assert.equal(
      refund(waitingBefore, { amount: 1000, reference: ozowRef("EARLY") }).ends_paid_days,
      false
    );
    await check("preflight before: the keep-running refund on a payment not activated", () => {
      assert.match(
        preflight()[0][1],
        /; part refunds keeping the slot running: 1; of them on payments not activated: 1; slots reversed after one: 0$/
      );
    });

    // ------------------------------------------------------------ apply
    await applyAndProveRollback(kit, database, check, {
      label: "part refund follow-ups",
      applied: APPLIED,
      notApplied: NOT_APPLIED,
    });
    await check("the update's bodies", () => {
      assert.deepEqual(Object.keys(UPDATED).map(bodyMd5), Object.values(UPDATED));
    });

    // (136) A slot reversed after a keep-running part refund counts again.
    await check("a slot reversed after a keep-running part refund counts as refunded", () => {
      const pay = buy(verified("follow56-reversed"));
      const line = lineOf(pay);
      const part = refund(pay, { line, amount: 1500, reference: ozowRef("REV") });
      assert.equal(part.ends_paid_days, false);
      assert.equal(refundedBefore(pay), 1500);
      // A bank's chargeback notice: the slot is reversed with no record of its own.
      q(
        `select internal.reverse_payment_line('${line}','chargeback','Bank chargeback notice','${admin.id}');`
      );
      assert.equal(refundedBefore(pay), 1500 + P180.cents);
      assert.equal(Number(q(`select internal.refund_left_cents('${pay}',null);`)), 0);
      assert.match(preflight()[0][1], /; slots reversed after one: 1$/);
    });

    // (141) "Everything left" never repeats a keep-running part refund.
    await check("'everything left' with a part refund's reference or request id is refused", () => {
      const pay = buy(verified("follow56-everything"));
      const reference = ozowRef("ALL");
      const requestId = randomUUID();
      const part = refund(pay, { amount: 2000, reference, requestId });
      assert.equal(part.ends_paid_days, false);
      fails(refundSql(pay, { reference }), "PT409", /reference_used/);
      fails(refundSql(pay, { reference, requestId }), "PT409", /refund_request_reused/);
      assert.equal(requests(pay), 1);
      // The same part refund again is still a repeat.
      const again = refund(pay, { amount: 2000, reference, requestId });
      assert.deepEqual([again.request_id, again.repeated], [part.request_id, true]);
      // A new reference refunds everything left.
      const rest = refund(pay, { reference: ozowRef("ALL") });
      assert.deepEqual([rest.amount_cents, rest.ends_paid_days], [P180.cents - 2000, true]);
    });

    // (155) A corrected reference or Ozow refund id with the same request id.
    await check("the same request id with another reference or refund id is refused", () => {
      const pay = buy(verified("follow56-reference"));
      const requestId = randomUUID();
      const first = refund(pay, { amount: 1000, reference: ozowRef("REF"), requestId });
      fails(
        refundSql(pay, { amount: 1000, reference: ozowRef("REF"), requestId }),
        "PT409",
        /refund_request_reused/
      );
      assert.equal(requests(pay), 1);
      const dash = buy(verified("follow56-dashboard"), P180, 1, true);
      const dashId = randomUUID();
      const tx = q(
        `select lower(provider_transaction_id) from private.payments where id='${dash}';`
      );
      const refundId = randomUUID();
      const fact = (id) => ({
        refund_id: id,
        transaction_id: tx,
        amount_cents: 1000,
        status: "Complete",
        requested_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      const recorded = refund(dash, {
        channel: "dashboard",
        amount: 1000,
        reference: refundId,
        fact: fact(refundId),
        requestId: dashId,
      });
      assert.equal(recorded.status, "applied");
      const other = randomUUID();
      fails(
        refundSql(dash, {
          channel: "dashboard",
          amount: 1000,
          reference: other,
          fact: fact(other),
          requestId: dashId,
        }),
        "PT409",
        /refund_request_reused/
      );
      const same = refund(dash, {
        channel: "dashboard",
        amount: 1000,
        reference: refundId,
        fact: fact(refundId),
        requestId: dashId,
      });
      assert.deepEqual([same.request_id, same.repeated], [recorded.request_id, true]);
      assert.equal(first.repeated, false);
    });

    // (157) Keep-running part refunds wait for activation.
    await check("a keep-running part refund waits for 'Activate what was paid for'", () => {
      const pay = buy(verified("follow56-activate"));
      replica(
        `update private.payments set fulfillment_status='needs_reconciliation' where id='${pay}';`
      );
      fails(
        refundSql(pay, { amount: 1000, reference: ozowRef("ACT") }),
        "PT409",
        /refund_activate_first/
      );
      fails(
        refundSql(pay, { amount: 1000, code: "billing_error", reference: ozowRef("ACT") }),
        "PT409",
        /refund_activate_first/
      );
      assert.equal(requests(pay), 0);
      // A refund that ends the paid days is not held back by it.
      const whole = refund(pay, { code: "s14_cancellation", reference: ozowRef("ACT") });
      assert.deepEqual([whole.status, whole.ends_paid_days], ["applied", true]);
    });

    // (142, 139, 143) The staff read. LIM-SQL-s14-notice-business-days: 20
    // South African business days of notice from today.
    await check(
      "the staff read: 0 left once a slot is reversed; notice end; term; lost days",
      () => {
        const owner = verified("follow56-read");
        const pay = buy(owner, P180, 2);
        const before = refundsLeft(pay);
        assert.equal(before.left_cents, P180.cents * 2);
        const [one, two] = [lineOf(pay, 1), lineOf(pay, 2)];
        refund(pay, { line: one, code: "s14_cancellation", reference: ozowRef("READ") });
        const after = refundsLeft(pay);
        assert.equal(after.left_cents, 0);
        assert.deepEqual(
          after.lines.map((l) => [l.line_id, l.left_cents]),
          [
            [one, 0],
            [two, P180.cents],
          ]
        );
        assert.equal(
          after.lines[1].paid_days,
          Number(q(`select duration_days from private.plan_versions where id='${P180.id}';`))
        );
        assert.equal(after.lines[1].lost_days, 0);
        // 20 business days after today, ending on one.
        const notice = after.notice_ends_on;
        assert.equal(
          q(`select count(*) from generate_series((now() at time zone 'Africa/Johannesburg')::date+1,
           '${notice}'::date,'1 day') d where internal.za_business_day(d::date);`),
          "20"
        );
        assert.equal(q(`select internal.za_business_day('${notice}');`), "t");
        // Lost days added to the running slot (once per slot, not per grant).
        json(
          staff(
            admin,
            `select api.add_lost_days(${sqlValue(owner.email)},3,'Site was down for three days','${randomUUID()}');`
          )
        );
        assert.equal(refundsLeft(pay).lines[1].lost_days, 3);
        const p30 = buy(verified("follow56-read-30"), P30);
        assert.equal(
          refundsLeft(p30).lines[0].paid_days,
          Number(q(`select duration_days from private.plan_versions where id='${P30.id}';`))
        );
      }
    );

    await check("the lost-days preview: money already returned for a term", () => {
      const owner = verified("follow56-preview");
      const pay = buy(owner);
      assert.deepEqual(
        lostDaysPreview(owner.email).map((i) => i.refunded_cents),
        [0]
      );
      refund(pay, { amount: 2500, reference: ozowRef("PRE") });
      assert.deepEqual(
        lostDaysPreview(owner.email).map((i) => i.refunded_cents),
        [2500]
      );
      // Only applied refunds of the slot itself: a refund waiting for approval
      // is not counted, nor a whole-payment refund of an order of several slots.
      const three = verified("follow56-preview-3");
      const order = buy(three, P180, 3);
      const [l1, l2, l3] = [1, 2, 3].map((n) => lineOf(order, n));
      refund(order, { line: l1, amount: 41_000, reference: ozowRef("PRE") });
      refund(order, { line: l2, amount: 41_000, reference: ozowRef("PRE") });
      const waiting = refund(order, { line: l3, amount: 30_000, reference: ozowRef("PRE") });
      assert.equal(waiting.status, "awaiting_approval");
      const sorted = (email) =>
        lostDaysPreview(email)
          .map((i) => i.refunded_cents)
          .sort((a, b) => a - b);
      assert.deepEqual(sorted(three.email), [0, 41_000, 41_000]);
      const two = verified("follow56-preview-2");
      const pair = buy(two, P180, 2);
      refund(pair, { amount: 1000, reference: ozowRef("PRE") });
      assert.deepEqual(sorted(two.email), [0, 0]);
    });

    await check(
      "slots added to a package have no plan term; a moved renewal gained no lost days",
      () => {
        q(
          "update private.slot_package_sales set on_sale=true,changed_at=now(),reason='Fixture: switched for the checks';"
        );
        const holder = verified("follow56-package");
        buyPackage(kit, holder, 5);
        const offer = json(member(holder, "select api.get_my_package_add_offer();")).package;
        const added = json(
          member(
            holder,
            `select api.start_package_add_checkout('${offer.id}',2,${2 * Number(offer.unit_price_cents)},true);`
          )
        );
        ozowSettle(kit, holder, added.payment_id);
        assert.equal(
          q(`select snapshot->>'category' from private.payments where id='${added.payment_id}';`),
          "slot_package_add"
        );
        const read = refundsLeft(added.payment_id);
        assert.equal(read.lines.length, 1);
        assert.equal(read.lines[0].paid_days, null);
        q(
          "update private.slot_package_sales set on_sale=false,changed_at=now(),reason='Fixture: switched back after the checks';"
        );
        // A record of lost days that only moved a waiting grant's start (as for a
        // queued renewal) is not counted; one that extended a running grant is.
        const owner = verified("follow56-moved");
        const pay = buy(owner);
        const grant = q(
          `select e.id from private.entitlements e join private.payment_lines l on l.id=e.payment_line_id where l.payment_id='${pay}';`
        );
        const record = (moved) =>
          q(`insert into private.lost_day_additions(request_id,entitlement_id,actor_id,days,starts_before,starts_after,ends_before,ends_after,reason)
          select gen_random_uuid(),e.id,'${admin.id}',4,e.starts_at,e.starts_at+interval '${moved ? 4 : 0} days',e.ends_at,e.ends_at+interval '4 days','Fixture: lost days'
          from private.entitlements e where e.id='${grant}';`);
        record(true);
        assert.equal(refundsLeft(pay).lines[0].lost_days, 0);
        record(false);
        assert.equal(refundsLeft(pay).lines[0].lost_days, 4);
      }
    );

    await check("grants unchanged: staff commands only; the helper is internal", () => {
      const grants = executeGrants(json, [...STAFF_COMMANDS, HELPER]);
      for (const signature of STAFF_COMMANDS) assert.deepEqual(grants[signature], STAFF, signature);
      assert.deepEqual(grants[HELPER], NONE);
    });

    const later = kit.steps.slice(kit.index + 1);
    if (later.length) {
      applySteps(database, later);
      await check("later updates keep the follow-ups", () => {
        const pay = buy(verified("follow56-later"));
        replica(
          `update private.payments set fulfillment_status='needs_reconciliation' where id='${pay}';`
        );
        fails(
          refundSql(pay, { amount: 1000, reference: ozowRef("LATER") }),
          "PT409",
          /refund_activate_first/
        );
      });
    }
  }
);
