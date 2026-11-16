#!/usr/bin/env node
// Behaviour checks for 20261113223806_bank_transfer_and_consent_fixes.sql:
// one bank credit (reference, amount, date cleared) waits or is confirmed once
// and a declined record frees it; bank refund references may hold spaces while
// Ozow references keep their rules; the receipt read gives the date a bank
// transfer cleared; the privacy export holds the consent records and bank
// transfers; the retention job treats the three consent records alike; and a
// restricted member reads their own email history.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff act with a verified authenticator app and an AAL2 session;
// members with synthetic sessions; the website server as `service_role`. The
// only stand-in is internal.current_verified_identity (identity review has its
// own suites). The script checks the read-only preflight and the update's
// refusals, applies the update, proves apply -> rollback -> apply returns the
// schema fingerprint to the same values, checks the behaviour, and that the
// rollback refuses once the new rules were used.
//
//   node --import tsx scripts/test-foundation-bank-transfer-consent-fixes.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import {
  assertReadOnlyPreflight,
  authSignUp,
  createChecks,
  executeGrants,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";
import {
  P30,
  applyAndProveRollback,
  bankTransferCommands,
  createPaymentWorld,
  ozowPurchase,
  psqlSessions,
  sqlValue,
  updateCheckKit,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261113223806_bank_transfer_and_consent_fixes.sql";
const { check, current, passed: checks } = createChecks();

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const kit = updateCheckKit(database, UPDATE, current);
  const world = createPaymentWorld(kit);
  const { q, json, fails, member, staff, service, fingerprint, preflight, count } = kit;
  const { steps, index, step, preflightSql: PREFLIGHT, rollbackSql: ROLLBACK } = kit;
  const { user, staffUser } = world;
  const admin = staffUser("fix-admin", "admin");
  const admin2 = staffUser("fix-admin2", "admin");
  world.review(admin, admin2, "fix-admin");
  world.review(admin2, admin, "fix-admin2");
  const verified = (label) => world.verified(label, admin);
  const today = q("select to_char((now() at time zone 'Africa/Johannesburg')::date,'YYYY-MM-DD');");
  const daysAgo = (n) =>
    q(`select to_char((now() at time zone 'Africa/Johannesburg')::date - ${n},'YYYY-MM-DD');`);
  const { recordSql, record, confirm, declineSql } = bankTransferCommands(kit, today);
  const { session, sessionAfter } = psqlSessions(database);
  const summary = () => preflight()[0][1];
  const transfers = (owner) => count(`private.invoice_transfers where account_id='${owner.id}'`);
  const history = (who) => member(who, "select api.list_my_email_history(20);");
  const queueEmail = (who) =>
    q(`insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key,processed_at,delivery_attempts)
        values('payment_completed',gen_random_uuid(),'${who.id}','vmtest:'||gen_random_uuid(),now(),1);`);
  const refundSql = (who, paymentId, reference, reason = "Refunded by EFT to the payer") =>
    staff(
      who,
      `select api.record_staff_payment_refund('${paymentId}','refunded','billing_error',${sqlValue(reason)},${sqlValue(reference)});`
    );
  const slotRefundSql = (who, lineId, reference) =>
    staff(
      who,
      `select api.record_staff_slot_refund('${lineId}','refunded','s14_cancellation','Cancelled within 14 days',${sqlValue(reference)});`
    );
  /** Recorded by admin, confirmed by admin2; returns the payment id. */
  const bankPayment = (owner, input) =>
    confirm(admin2, record(admin, { email: owner.email, term: 30, slots: 1, ...input }).transfer_id)
      .payment_id;

  // ------------------------------------------------------------ before
  const sizwe = verified("sizwe");
  const restricted = user("restricted");
  let declinedEarlier;
  await check("before the update: preflight reads 'not applied'; the findings hold", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "bank transfer and consent fixes: update not applied; declined bank transfers: 0; " +
        "bank references recorded more than once: 0; refund references with a space: 0"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
    // A declined reference is burned for good under the earlier rule.
    declinedEarlier = record(admin, { email: sizwe.email, term: 30, reference: "WRONG-0001" });
    json(declineSql(admin2, declinedEarlier.transfer_id));
    fails(
      recordSql(admin2, { email: sizwe.email, term: 30, reference: "WRONG-0001" }),
      "PT409",
      /already recorded \(declined\)/
    );
    // A restricted member cannot open their email history.
    queueEmail(restricted);
    q(`update auth.users set banned_until=now()+interval '1 day' where id='${restricted.id}';`);
    fails(history(restricted), "42501", /active authenticated member required/);
  });

  await check("the update refuses with a drifted body or index and changes nothing", () => {
    const before = fingerprint();
    const original = q(
      "select pg_get_functiondef('internal.list_my_email_history(integer)'::regprocedure);"
    );
    q(
      `do $$begin execute replace(pg_get_functiondef('internal.list_my_email_history(integer)'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    assert.match(
      fails(step.sql, "55000"),
      /list_my_email_history\(integer\) [0-9a-f]{32} is not a reviewed body/
    );
    assert.match(
      preflight()
        .map((r) => r[1])
        .join("\n"),
      /list_my_email_history\(integer\) is neither the earlier reviewed body nor the update's/
    );
    q(`${original};`);
    q(
      `create index invoice_transfers_open_reference_idx on private.invoice_transfers(bank_reference);`
    );
    assert.match(fails(step.sql, "55000"), /bank reference index differs/);
    q("drop index private.invoice_transfers_open_reference_idx;");
    assert.match(
      fails(ROLLBACK, "55000"),
      /rollback precondition: the bank transfer and consent fixes update is not applied/
    );
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "bank transfer and consent fixes",
    applied:
      /^bank transfer and consent fixes: already applied; declined bank transfers: 1; bank references recorded more than once: 0; refund references with a space: 0$/,
    notApplied: /^bank transfer and consent fixes: update not applied/,
  });

  // ------------------------------------------------------- bank references
  await check("a declined reference can be recorded again and confirmed", () => {
    const again = record(admin, { email: sizwe.email, term: 30, reference: "wrong 0001" });
    assert.notEqual(again.transfer_id, declinedEarlier.transfer_id);
    assert.deepEqual(
      [again.status, again.repeated, again.similar_records],
      ["awaiting_confirmation", false, 0]
    );
    // A declined record took no effect: it is no possible duplicate.
    const waiting = json(staff(admin2, "select api.get_staff_invoice_transfers();")).items.find(
      (i) => i.transfer_id === again.transfer_id
    );
    assert.equal(waiting.similar_records, 0);
    const confirmed = confirm(admin2, again.transfer_id);
    assert.equal(confirmed.status, "confirmed");
    assert.match(summary(), /bank references recorded more than once: 1;/);
  });

  await check("a waiting or a confirmed credit can never be recorded again", () => {
    const thandi = verified("thandi");
    const other = verified("other");
    const waiting = record(admin, { email: thandi.email, term: 30, reference: "FNB 2026 A1" });
    // The same request by the same staff member returns the record.
    const repeat = record(admin, { email: thandi.email, term: 30, reference: "fnb/2026-a1" });
    assert.deepEqual([repeat.transfer_id, repeat.repeated], [waiting.transfer_id, true]);
    const sameCredit = [
      [
        admin,
        { email: thandi.email, term: 30, reference: "FNB 2026 A1", reason: "Another note here" },
      ],
      [admin2, { email: thandi.email, term: 30, reference: "FNB2026A1" }],
      [admin, { email: other.email, term: 30, reference: "FNB 2026 A1" }],
    ];
    for (const [who, input] of sameCredit)
      fails(
        recordSql(who, input),
        "PT409",
        /reference, amount and date was already recorded \(awaiting confirmation\)/
      );
    confirm(admin2, waiting.transfer_id);
    for (const [who, input] of sameCredit)
      fails(
        recordSql(who, input),
        "PT409",
        /reference, amount and date was already recorded \(confirmed\)/
      );
    fails(declineSql(admin2, waiting.transfer_id), "PT409", /already confirmed/);
    assert.equal(transfers(thandi), 1);
    assert.equal(transfers(other), 0);
  });

  await check("a common reference is recorded for two customers; the confirmer sees it", () => {
    const [a, b, c] = ["common-a", "common-b", "common-c"].map(verified);
    const first = record(admin, { email: a.email, term: 30, reference: "VerifyMzansi" });
    const otherDay = record(admin, {
      email: b.email,
      term: 30,
      reference: "verifymzansi",
      cleared: daysAgo(1),
    });
    const otherAmount = record(admin, { email: b.email, term: 90, reference: "VERIFY MZANSI" });
    assert.deepEqual(
      [first, otherDay, otherAmount].map((t) => t.status),
      ["awaiting_confirmation", "awaiting_confirmation", "awaiting_confirmation"]
    );
    // The same reference, amount and day for a third customer is one credit.
    fails(
      recordSql(admin, { email: c.email, term: 30, reference: "Verify-Mzansi" }),
      "PT409",
      /reference, amount and date was already recorded/
    );
    // The confirmer sees each record with the same reference and amount (a
    // date typed wrongly would look exactly like this), not the other amount.
    const items = json(staff(admin2, "select api.get_staff_invoice_transfers();")).items;
    assert.deepEqual(
      [first, otherDay, otherAmount].map(
        (t) => items.find((i) => i.transfer_id === t.transfer_id).similar_records
      ),
      [1, 1, 0]
    );
    // Both customers' transfers are confirmed by a second person.
    assert.equal(confirm(admin2, first.transfer_id).status, "confirmed");
    assert.equal(confirm(admin2, otherDay.transfer_id).status, "confirmed");
    assert.equal(transfers(c), 0);
  });

  await check("two staff recording the same credit at once give one record", async () => {
    const lebo = verified("lebo");
    const first = session(
      `begin;\n${recordSql(admin, { email: lebo.email, term: 30, reference: "RACE-0001" })}\nselect pg_sleep(1.5);\ncommit;`
    );
    const second = sessionAfter(
      400,
      recordSql(admin2, { email: lebo.email, term: 30, reference: "race 0001" })
    );
    const [x, y] = await Promise.all([first, second]);
    assert.equal(x.status, 0, x.stderr);
    assert.notEqual(y.status, 0);
    assert.match(y.stderr, /PT409:.*reference, amount and date was already recorded/);
    assert.equal(transfers(lebo), 1);
    // The unique index holds even without the command's lock.
    const row = q(`select id from private.invoice_transfers where account_id='${lebo.id}';`);
    fails(
      `insert into private.invoice_transfers(account_id,plan_version_id,slots,amount_received_cents,bank_reference,
        cleared_on,cooling_off_waiver_confirmed,reason,recorded_by)
       select account_id,plan_version_id,slots,amount_received_cents,'RACE.0001',cleared_on,true,'A second copy',recorded_by
       from private.invoice_transfers where id='${row}';`,
      "23505"
    );
  });

  // -------------------------------------------------------------- refunds
  let receiptPayment;
  await check("a bank refund reference may hold spaces; Ozow references keep their rules", () => {
    const zola = verified("zola");
    receiptPayment = bankPayment(zola, { reference: "ZOLA-0001", cleared: daysAgo(3) });
    const refunded = json(refundSql(admin, receiptPayment, "  FNB   Refund 001 "));
    assert.equal(refunded.status, "applied");
    assert.equal(
      q(
        `select ozow_reference from private.payment_refund_requests where id='${refunded.request_id}';`
      ),
      "FNB Refund 001"
    );
    // The same request again (spaced differently) returns the first result.
    assert.equal(json(refundSql(admin, receiptPayment, "FNB Refund   001")).repeated, true);
    // Refusals for a bank transfer never mention Ozow.
    const next = bankPayment(verified("zola-2"), { reference: "ZOLA-0002" });
    for (const [reference, state, message] of [
      ["   ", "22023", /bank refund reference required/],
      ["A B", "22023", /bank refund reference must be 4 to 100 letters, digits, spaces/],
      ["FNB;REFUND", "22023", /bank refund reference must be/],
      ["fnb refund 001", "PT409", /this refund reference was already recorded/],
    ]) {
      const stderr = fails(refundSql(admin, next, reference), state, message);
      assert.doesNotMatch(stderr, /Ozow/);
    }
    // One slot of a bank transfer order, with a spaced reference.
    const two = confirm(
      admin2,
      record(admin, {
        email: verified("zola-3").email,
        term: 30,
        slots: 2,
        reference: "ZOLA-0003",
      }).transfer_id
    ).payment_id;
    const line = q(
      `select id from private.payment_lines where payment_id='${two}' and line_number=2;`
    );
    assert.equal(json(slotRefundSql(admin, line, "ABSA REF 77")).status, "applied");
    // An Ozow payment: spaces refused with the Ozow wording, as before.
    const ozowBuyer = verified("ozow-buyer");
    const ozowPayment = ozowPurchase(kit, ozowBuyer, P30, 1);
    fails(refundSql(admin, ozowPayment, "OZ REF 1"), "22023", /Ozow refund reference must be/);
    fails(refundSql(admin, ozowPayment, ""), "22023", /Ozow refund reference required/);
    assert.equal(json(refundSql(admin, ozowPayment, "OZOW-REF-0001")).status, "applied");
    // The stored rule: a spaced reference only for a bank-transfer payment.
    const ozowAgain = ozowPurchase(kit, ozowBuyer, P30, 1);
    fails(
      `insert into private.payment_refund_requests(payment_id,account_id,kind,reason_code,reason,ozow_reference,
        amount_cents,recorded_before_cents,needs_approval,status,requested_by)
       values('${ozowAgain}','${ozowBuyer.id}','refunded','billing_error','Direct write','OZ REF 2',6900,0,false,
        'awaiting_approval','${admin.id}');`,
      "23514",
      /only the refund reference of a bank-transfer payment may contain spaces/
    );
    fails(
      `insert into private.payment_refund_requests(payment_id,account_id,kind,reason_code,reason,ozow_reference,
        amount_cents,recorded_before_cents,needs_approval,status,requested_by)
       values('${next}','${q(`select owner_id from private.payments where id='${next}';`)}','refunded','billing_error',
        'Direct write','FNB  DOUBLE',6900,0,false,'awaiting_approval','${admin.id}');`,
      "23514"
    );
    assert.match(summary(), /refund references with a space: 2$/);
  });

  await check("the receipt read gives the cleared date, and a refund reads as refunded", () => {
    const receipt = json(service(`select api.get_payment_receipt('${receiptPayment}');`));
    assert.deepEqual(
      [receipt.payment_method, receipt.bank_reference, receipt.cleared_on, receipt.status],
      ["invoice", "ZOLA-0001", daysAgo(3), "refunded"]
    );
    // The payment itself still completed when the second person confirmed it.
    assert.notEqual(receipt.completed_at.slice(0, 10), daysAgo(3));
    const ozowPaid = q(
      "select id from private.payments where provider='ozow' and status='complete' limit 1;"
    );
    const ozowReceipt = json(service(`select api.get_payment_receipt('${ozowPaid}');`));
    assert.deepEqual(
      [ozowReceipt.payment_method, ozowReceipt.cleared_on, ozowReceipt.status],
      ["ozow", null, "complete"]
    );
  });

  // ----------------------------------------------------- privacy and consent
  const emailApp = { provider: "email", providers: ["email"] };
  /** A member who signed up through the form, accepted the posting terms
   * and turned marketing email on. */
  const consenting = () => {
    const m = authSignUp(
      json,
      { display_name: "Thando Dlamini", terms_accepted: true },
      {
        app: emailApp,
      }
    );
    q(`insert into private.posting_terms_acceptances(owner_id,version,document_hash)
        select '${m.id}',v.version,v.document_hash from private.posting_terms_current c
        join private.posting_terms_versions v using(version) where c.singleton;`);
    json(
      member(
        m,
        "select api.save_my_communication_choices('communication-2026-11',p_marketing_email=>true);"
      )
    );
    return m;
  };
  const consentRows = (m) =>
    json(`select jsonb_build_array(
      (select count(*) from private.posting_terms_acceptances where owner_id='${m.id}'),
      (select count(*) from private.signup_terms_acceptances where account_id='${m.id}'),
      (select count(*) from private.communication_choice_events where account_id='${m.id}'));`);

  await check(
    "the privacy export holds the member's consent records and bank transfers only",
    () => {
      const m = consenting();
      const bankCustomer = verified("export-bank");
      bankPayment(bankCustomer, { reference: "EXPORT 0001" });
      const exported = json(`select internal.frontend_privacy_export_data('${m.id}');`);
      assert.deepEqual(
        exported.communication_choices.map((c) => [c.purpose, c.granted, c.wording_version]),
        [["marketing_email", true, "communication-2026-11"]]
      );
      assert.deepEqual(
        exported.signup_terms.map((t) => t.method),
        ["email_form"]
      );
      assert.equal(exported.posting_terms.length, 1);
      assert.deepEqual(exported.bank_transfers, []);
      const bank = json(`select internal.frontend_privacy_export_data('${bankCustomer.id}');`);
      assert.equal(bank.bank_transfers.length, 1);
      const t = bank.bank_transfers[0];
      assert.deepEqual(
        [
          t.bank_reference,
          t.status,
          t.term_days,
          t.slots,
          t.amount_received_cents,
          t.cooling_off_waiver_confirmed,
        ],
        ["EXPORT 0001", "confirmed", 30, 1, 6900, true]
      );
      for (const key of [
        "recorded_by",
        "confirmed_by",
        "declined_by",
        "reason",
        "decline_reason",
        "account_id",
      ])
        assert.equal(Object.hasOwn(t, key), false, key);
      assert.deepEqual(bank.communication_choices, []);
    }
  );

  await check("retention deletes the three consent records together, 30 days after closure", () => {
    const [closedOld, held, closedRecent, open] = [0, 1, 2, 3].map(() => consenting());
    const close = (m, days) =>
      q(`insert into private.account_closures(user_id,closed_at,evidence_delete_after)
          values('${m.id}',now()-interval '${days} days',now()-interval '${days} days'+interval '90 days');`);
    close(closedOld, 31);
    close(held, 31);
    close(closedRecent, 10);
    q(`set session_replication_role=replica;
      insert into private.legal_holds(subject_id,reason,placed_by) values('${held.id}','Dispute about consent','${admin.id}');
      set session_replication_role=origin;`);
    const result = json(service("select api.run_retention(500);")).verification;
    assert.ok(result.closed_account_signup_terms >= 1, JSON.stringify(result));
    assert.ok(result.closed_account_communication_choices >= 1, JSON.stringify(result));
    assert.deepEqual(consentRows(closedOld), [0, 0, 0]);
    for (const kept of [held, closedRecent, open]) assert.deepEqual(consentRows(kept), [1, 1, 1]);
    // A batch of one takes the oldest closed account that still holds
    // records: never one already cleared, so the sweep does not stall.
    const later = consenting();
    close(later, 31);
    const one = json(service("select api.run_retention(1);")).verification;
    assert.deepEqual(
      [one.closed_account_signup_terms, one.closed_account_terms_acceptances],
      [1, 1],
      JSON.stringify(one)
    );
    assert.deepEqual(consentRows(later), [0, 0, 0]);
    // Outside the retention job, consent records still never go one by one.
    fails(
      `delete from private.communication_choice_events where account_id='${open.id}';`,
      "23514"
    );
  });

  await check("a restricted member reads their email history; an ended session is told so", () => {
    const items = json(history(restricted)).items;
    assert.deepEqual(
      items.map((i) => [i.kind, i.status]),
      [["payment_completed", "sent"]]
    );
    // Turning a choice on still needs an active account; withdrawing does not.
    fails(
      member(
        restricted,
        "select api.save_my_communication_choices('communication-2026-11',p_analytics=>true);"
      ),
      "42501",
      /active authenticated member required/
    );
    json(
      member(
        restricted,
        "select api.save_my_communication_choices('communication-2026-11',p_analytics=>false);"
      )
    );
    const ended = user("ended");
    q(`update auth.sessions set not_after=now()-interval '1 minute' where id='${ended.session}';`);
    fails(history(ended), "42501", /live session required/);
  });

  await check("grants: the new functions are not callable by any API role", () => {
    const grants = executeGrants(json, [
      "internal.staff_refund_reference(uuid,text)",
      "internal.assert_staff_refund_reason(text,text,text)",
      "internal.payment_refund_reference_rule()",
      "internal.frontend_privacy_export_data(uuid)",
      "internal.retention_verification(integer)",
    ]);
    for (const [signature, roles] of Object.entries(grants))
      assert.deepEqual(
        roles,
        { anon: false, authenticated: false, service_role: false },
        signature
      );
  });

  await check("the rollback refuses once the new rules were used", () => {
    const now = fingerprint();
    assert.match(
      fails(ROLLBACK, "55000"),
      /bank references are recorded more than once and [0-9]+ refund references hold a space/
    );
    assert.equal(fingerprint(), now);
    assert.match(summary(), /^bank transfer and consent fixes: already applied;/);
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the rules", () => {
      // Another staff member: the same request by its recorder (admin) is a
      // repeat that returns the confirmed record instead.
      fails(
        recordSql(admin2, { email: sizwe.email, term: 30, reference: "WRONG-0001" }),
        "PT409",
        /reference, amount and date was already recorded \(confirmed\)/
      );
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Bank transfer and consent fix checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
