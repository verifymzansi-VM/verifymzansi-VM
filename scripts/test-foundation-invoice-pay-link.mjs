#!/usr/bin/env node
// Behaviour checks for 20261126053701_invoice_pay_link.sql (launch checklist
// items 38 and 34): a customer invoice is emailed with a payment link (only
// the link's SHA-256 is stored, replaced at each sending), whoever has the
// link can see and pay the invoice without signing in, with every rule of the
// member's Pay now, and the receipt names the invoice a payment paid.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of the staff payment checks (members and staff
// written directly as the database owner; members acting through the
// production API commands with synthetic sessions; the website's server as
// `service_role` with synthetic link hashes and Ozow ids). The script checks
// the read-only preflight, drifted bodies and a premature rollback, applies the
// update and proves apply -> rollback -> apply, then checks: the grants; every
// issued invoice queues one invoice email, which the claim hands out; the
// email step stores the link's hash on an unpaid invoice only and replaces it;
// the link read finds only the invoice of its current link, of an account that
// can use the site, without ids, and never falls back to a session; billing
// details and Pay now through the link keep every rule (details, box, total,
// ID review), bind the payment to the invoice's account, amount and number,
// and answer the account for the Ozow request; another invoice of the same
// account is out of reach; the member's own commands are unchanged (another
// member is refused; a revoked session is refused); the receipt names the
// invoice of an Ozow and of a bank transfer payment, and none for a checkout;
// the rollback refuses once an invoice email was queued.
//
//   node --import tsx scripts/test-foundation-invoice-pay-link.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertReadOnlyPreflight, executeGrants } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  functionBodyMd5,
  ozowPurchase,
  ozowSettle,
  P30,
  runTwoAdminUpdateCheck,
  sha,
  sqlValue,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261126053701_invoice_pay_link.sql";
const REPLACED = [
  "internal.notify_invoice_issued()",
  "internal.claim_supported_notification_outbox(text[],integer)",
  "internal.get_payment_receipt(uuid)",
  "api.get_my_invoice(text)",
  "api.save_my_invoice_billing(text,integer,text,text,text)",
  "api.start_invoice_payment(text,bigint,boolean)",
  "internal.get_my_invoice(text)",
  "internal.save_my_invoice_billing(text,integer,text,text,text)",
  "internal.start_invoice_payment(text,bigint,boolean)",
];
const LINK_COMMANDS = [
  "api.get_invoice_by_link(text)",
  "api.save_invoice_billing_by_link(text,integer,text,text,text)",
  "api.start_invoice_payment_by_link(text,bigint,boolean)",
  "api.prepare_invoice_email(uuid,text)",
];
const NOT_APPLIED = /^invoice payment link: update not applied; unpaid invoices: \d+$/;
// One invoice was issued before the update (it queued no email).
const APPLIED =
  /^invoice payment link: already applied; unpaid invoices: 1; invoices with a link: 0; invoice emails: 0$/;
const ADDRESS = "1 Example Road\nEmpangeni\n3880";

const SETUP = { update: UPDATE, label: "paylink", title: "Invoice payment link" };
await runTwoAdminUpdateCheck(SETUP, async (run) => {
  const { database, check, kit, world, admin, admin2 } = run;
  const { q, json, fails, member, staff, service, preflight } = kit;
  const reason = (stderr) => /^DETAIL:\s+(\S+)/m.exec(stderr)?.[1];
  const today = q(`select (now() at time zone 'Africa/Johannesburg')::date;`);
  const issue = (owner) =>
    json(
      staff(
        admin,
        `select api.issue_staff_invoice(${sqlValue(owner.email)},30,1,7,'Invoice asked for by email','${randomUUID()}');`
      )
    );
  const invoiceRow = (number) =>
    json(`select to_jsonb(i) from private.customer_invoices i where i.invoice_number='${number}';`);
  const prepareSql = (invoiceId, hash) =>
    service(`select api.prepare_invoice_email('${invoiceId}',${sqlValue(hash)});`);
  const readSql = (hash) => service(`select api.get_invoice_by_link(${sqlValue(hash)});`);
  const billingSql = (hash, revision, name = "Fixture Motors (Pty) Ltd") =>
    service(
      `select api.save_invoice_billing_by_link(${sqlValue(hash)},${revision},${sqlValue(name)},${sqlValue(ADDRESS)},null);`
    );
  const paySql = (hash, total, consent = true) =>
    service(`select api.start_invoice_payment_by_link(${sqlValue(hash)},${total},${consent});`);
  const emails = (invoiceId) =>
    q(
      `select count(*) from private.outbox_events where kind='invoice_issued' and subject_id='${invoiceId}';`
    );

  // ------------------------------------------------------------ before
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], NOT_APPLIED);
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a premature rollback and drifted bodies are refused", () => {
    assertDriftRefused(kit, { label: "invoice payment link", signatures: REPLACED, rows: 2 });
  });
  const early = world.verified("paylink-early", admin);
  await check("before the update an issued invoice queues no email", () => {
    const invoice = issue(early);
    assert.equal(emails(invoice.invoice_id), "0");
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "invoice payment link",
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  // ------------------------------------------------------------- after
  await check("grants: the link commands and the email step are the server's only", () => {
    const grants = executeGrants(json, [
      ...LINK_COMMANDS,
      "internal.prepare_invoice_email(uuid,text)",
      "internal.customer_invoice_for_caller(text,text)",
      "internal.get_my_invoice(text,text)",
      "internal.save_my_invoice_billing(text,integer,text,text,text,text)",
      "internal.start_invoice_payment(text,bigint,boolean,text)",
      "api.get_my_invoice(text)",
      "api.start_invoice_payment(text,bigint,boolean)",
    ]);
    for (const command of [...LINK_COMMANDS, "internal.prepare_invoice_email(uuid,text)"])
      assert.deepEqual(
        grants[command],
        { anon: false, authenticated: false, service_role: true },
        command
      );
    assert.deepEqual(grants["internal.customer_invoice_for_caller(text,text)"], {
      anon: false,
      authenticated: false,
      service_role: false,
    });
    for (const fn of [
      "internal.get_my_invoice(text,text)",
      "internal.save_my_invoice_billing(text,integer,text,text,text,text)",
      "internal.start_invoice_payment(text,bigint,boolean,text)",
    ])
      assert.deepEqual(grants[fn], { anon: false, authenticated: true, service_role: true }, fn);
    for (const fn of ["api.get_my_invoice(text)", "api.start_invoice_payment(text,bigint,boolean)"])
      assert.deepEqual(grants[fn], { anon: false, authenticated: true, service_role: false }, fn);
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        q(
          `select has_column_privilege('${role}','private.customer_invoices','pay_link_hash','select');`
        ),
        "f",
        role
      );
  });

  const thandi = world.verified("paylink-thandi", admin);
  const invoice = issue(thandi);
  const hash = sha(`link-${invoice.invoice_id}-1`);

  await check("an issued invoice queues one invoice email, which the claim hands out", () => {
    assert.equal(emails(invoice.invoice_id), "1");
    const [claimed, ...more] = json(
      service(`select api.claim_supported_notification_outbox(array['invoice_issued'],5);`)
    );
    assert.equal(more.length, 0);
    assert.equal(claimed.kind, "invoice_issued");
    assert.equal(claimed.subject_id, invoice.invoice_id);
    assert.equal(claimed.owner_id, thandi.id);
    assert.equal(claimed.recipient, thandi.email);
    assert.equal(claimed.post_id, null);
    // 28 kinds at most, each once.
    const all = [
      "payment_completed",
      "payment_reversed",
      "payment_reconciliation_required",
      "trial_started",
      "post_expired",
      "post_expiry_reminder",
      "draft_deletion_warning",
      "post_deleted",
      "verification_phone_confirmed",
      "identity_accepted",
      "enquiry_received",
      "account_warning",
      "content_hidden",
      "account_suspended",
      "account_banned",
      "appeal_decided",
      "business_check_update",
      "post_sold",
      "post_kept",
      "verification_returned",
      "slot_renewal_reminder",
      "term_ending_notice",
      "free_credit_reminder",
      "staff_privacy_request",
      "staff_appeal",
      "staff_report",
      "sticker_renewal_reminder",
      "invoice_issued",
    ].join(",");
    assert.equal(all.split(",").length, 28);
    json(
      service(`select api.claim_supported_notification_outbox(string_to_array('${all}',','),1);`)
    );
    fails(
      service(
        `select api.claim_supported_notification_outbox(string_to_array('${all},extra_kind',','),1);`
      ),
      "22023"
    );
    // Each invoice once: the in-app notice is still there too.
    assert.equal(
      q(
        `select count(*) from private.notifications where kind='invoice_issued' and subject_id='${invoice.invoice_id}';`
      ),
      "1"
    );
  });

  await check("an invoice email has no recipient once the account is closed", () => {
    const closed = world.verified("paylink-closed", admin);
    const owed = issue(closed);
    q(`set session_replication_role=replica;
      insert into private.account_closures(user_id,closed_at,evidence_delete_after)
        values('${closed.id}',now(),now()+interval '90 days');
      set session_replication_role=origin;`);
    const [claimed, ...more] = json(
      service(`select api.claim_supported_notification_outbox(array['invoice_issued'],5);`)
    );
    assert.equal(more.length, 0);
    assert.equal(claimed.subject_id, owed.invoice_id);
    assert.equal(claimed.recipient, null);
  });

  await check(
    "the email step stores the link's hash on an unpaid invoice and answers the email",
    () => {
      fails(prepareSql(invoice.invoice_id, "not-a-hash"), "22023");
      fails(prepareSql(invoice.invoice_id, null), "22023");
      assert.equal(reason(fails(prepareSql(randomUUID(), hash), "PT404")), "invoice_unavailable");
      for (const who of [thandi, admin])
        fails(
          member(who, `select api.prepare_invoice_email('${invoice.invoice_id}','${hash}');`),
          "42501"
        );
      const answer = json(prepareSql(invoice.invoice_id, hash));
      assert.deepEqual(answer, {
        invoice_number: invoice.invoice_number,
        status: "issued",
        owner_id: thandi.id,
        description: invoice.description,
        total_cents: invoice.total_cents,
        due_on: invoice.due_on,
      });
      assert.equal(invoiceRow(invoice.invoice_number).pay_link_hash, hash);
      // Nothing else of the invoice changed.
      assert.equal(invoiceRow(invoice.invoice_number).revision, 1);
    }
  );

  await check(
    "the link read finds only its invoice, as the member reads it, and never a session's",
    () => {
      const read = json(readSql(hash));
      const mine = json(member(thandi, `select api.get_my_invoice('${invoice.invoice_number}');`));
      assert.deepEqual(read, mine);
      for (const other of [sha("unknown-link"), "", null, invoice.invoice_number])
        assert.equal(reason(fails(readSql(other), "PT404")), "invoice_unavailable", String(other));
      // A member's session does not reach the server's command, nor the link
      // path of the internal functions it may execute.
      fails(member(thandi, `select api.get_invoice_by_link('${hash}');`), "42501");
      for (const sql of [
        `select internal.get_my_invoice(null,'${hash}');`,
        `select internal.save_my_invoice_billing(null,1,'Fixture Motors (Pty) Ltd',${sqlValue(ADDRESS)},null,'${hash}');`,
        `select internal.start_invoice_payment(null,${invoice.total_cents},true,'${hash}');`,
      ])
        fails(member(thandi, sql), "42501", /payment links are for the website's server/);
    }
  );

  await check(
    "a link works until 30 days after the due date, then reads as unknown; the member is unaffected",
    () => {
      const ayanda = world.verified("paylink-ayanda", admin);
      const owed = issue(ayanda);
      const link = sha(`link-${owed.invoice_id}-expiry`);
      json(prepareSql(owed.invoice_id, link));
      const dueSql = (days) =>
        q(`set session_replication_role=replica;
        update private.customer_invoices set due_on=(now() at time zone 'Africa/Johannesburg')::date-${days}
          where id='${owed.invoice_id}';
        set session_replication_role=origin;`);
      dueSql(30);
      assert.equal(json(readSql(link)).invoice_number, owed.invoice_number);
      dueSql(31);
      for (const sql of [readSql(link), billingSql(link, 1), paySql(link, owed.total_cents)])
        assert.equal(reason(fails(sql, "PT404")), "invoice_unavailable");
      assert.equal(
        json(member(ayanda, `select api.get_my_invoice('${owed.invoice_number}');`)).invoice_number,
        owed.invoice_number
      );
    }
  );

  await check(
    "billing details through the link: at the shown revision, then the member sees them",
    () => {
      fails(billingSql(hash, 1, "x"), "22023", /invoice_billing_invalid/);
      const saved = json(billingSql(hash, 1));
      assert.equal(saved.repeated, false);
      assert.equal(saved.revision, 2);
      assert.equal(
        reason(fails(billingSql(hash, 1, "Another Name Ltd"), "PT409")),
        "invoice_revision_changed"
      );
      assert.equal(json(billingSql(hash, 1)).repeated, true);
      const mine = json(member(thandi, `select api.get_my_invoice('${invoice.invoice_number}');`));
      assert.deepEqual(mine.buyer, {
        name: "Fixture Motors (Pty) Ltd",
        address: ADDRESS,
        registration_number: null,
      });
    }
  );

  let paymentId = "";
  await check(
    "Pay now through the link keeps every rule and binds the invoice's account, amount and number",
    () => {
      fails(paySql(hash, invoice.total_cents, false), "22023", /invoice_consent_required/);
      assert.equal(
        reason(fails(paySql(hash, invoice.total_cents + 1), "PT428")),
        "invoice_amount_mismatch"
      );
      assert.equal(
        reason(fails(paySql(sha("unknown-link"), invoice.total_cents), "PT404")),
        "invoice_unavailable"
      );
      fails(paySql(null, invoice.total_cents), "PT404");
      const quote = json(paySql(hash, invoice.total_cents));
      assert.equal(quote.owner_id, thandi.id);
      assert.equal(quote.merchant_reference, invoice.invoice_number);
      assert.equal(quote.amount_cents, String(invoice.total_cents));
      assert.equal(quote.reused, false);
      paymentId = quote.payment_id;
      const pay = json(
        `select jsonb_build_object('owner',owner_id,'amount',amount_cents,'consent',snapshot->'cooling_off_consent'->>'method') from private.payments where id='${paymentId}';`
      );
      assert.deepEqual(pay, { owner: thandi.id, amount: invoice.total_cents, consent: "invoice" });
      assert.ok(invoiceRow(invoice.invoice_number).cooling_off_consent_at);
      // The same attempt again (never sent to Ozow), still with the account.
      const again = json(paySql(hash, invoice.total_cents));
      assert.equal(again.payment_id, paymentId);
      assert.equal(again.owner_id, thandi.id);
      // The member's own Pay now answers no account.
      const own = json(
        member(
          thandi,
          `select api.start_invoice_payment('${invoice.invoice_number}',${invoice.total_cents},true);`
        )
      );
      assert.equal(own.payment_id, paymentId);
      assert.equal(own.owner_id, undefined);
    }
  );

  await check(
    "a paid invoice: the link shows it paid, and nothing more can be paid or changed",
    () => {
      ozowSettle(kit, thandi, paymentId);
      const read = json(readSql(hash));
      assert.equal(read.status, "paid");
      assert.equal(read.payment_status, "complete");
      assert.equal(read.latest_attempt.status, "complete");
      assert.equal(read.latest_attempt.payment_id, undefined);
      assert.equal(reason(fails(paySql(hash, invoice.total_cents), "PT409")), "invoice_paid");
      assert.equal(reason(fails(billingSql(hash, 2, "Later Name Ltd"), "PT409")), "invoice_paid");
      // A sending after payment stores nothing and says it is paid.
      const later = sha(`link-${invoice.invoice_id}-late`);
      assert.equal(json(prepareSql(invoice.invoice_id, later)).status, "paid");
      assert.equal(invoiceRow(invoice.invoice_number).pay_link_hash, hash);
    }
  );

  await check("the receipt names the invoice an Ozow payment paid, and none for a checkout", () => {
    const receipt = json(service(`select api.get_payment_receipt('${paymentId}');`));
    assert.equal(receipt.customer_invoice_number, invoice.invoice_number);
    const buyer = world.verified("paylink-buyer", admin);
    const checkout = ozowPurchase(kit, buyer, P30, 1);
    assert.equal(
      json(service(`select api.get_payment_receipt('${checkout}');`)).customer_invoice_number,
      null
    );
  });

  await check("a new sending replaces the link; the old one stops working", () => {
    const sipho = world.verified("paylink-sipho", admin);
    const first = issue(sipho);
    const second = issue(sipho);
    const a1 = sha(`link-${first.invoice_id}-1`);
    const a2 = sha(`link-${first.invoice_id}-2`);
    const b1 = sha(`link-${second.invoice_id}-1`);
    json(prepareSql(first.invoice_id, a1));
    json(prepareSql(second.invoice_id, b1));
    json(prepareSql(first.invoice_id, a2));
    assert.equal(reason(fails(readSql(a1), "PT404")), "invoice_unavailable");
    assert.equal(json(readSql(a2)).invoice_number, first.invoice_number);
    // A link reaches its own invoice only, never the account's other one.
    json(billingSql(a2, 1));
    json(billingSql(b1, 1));
    const quote = json(paySql(a2, first.total_cents));
    assert.equal(quote.merchant_reference, first.invoice_number);
    // One link per invoice: the same hash cannot name a second invoice.
    fails(prepareSql(second.invoice_id, a2), "23505");
  });

  await check(
    "an account that can no longer use the site, or has no accepted ID review, cannot pay by link",
    () => {
      const zodwa = world.verified("paylink-zodwa", admin);
      const owed = issue(zodwa);
      const link = sha(`link-${owed.invoice_id}`);
      json(prepareSql(owed.invoice_id, link));
      json(billingSql(link, 1));
      q(`update auth.users set banned_until=now()+interval '1 day' where id='${zodwa.id}';`);
      for (const sql of [readSql(link), billingSql(link, 2), paySql(link, owed.total_cents)])
        assert.equal(reason(fails(sql, "PT404")), "invoice_unavailable");
      q(`update auth.users set banned_until=null where id='${zodwa.id}';`);
      assert.equal(json(readSql(link)).status, "issued");
      q(`set session_replication_role=replica;
      update private.accepted_identity_facts set revoked_at=now() where owner_id='${zodwa.id}';
      set session_replication_role=origin;`);
      assert.equal(
        reason(fails(paySql(link, owed.total_cents), "PT412")),
        "invoice_buyer_unverified"
      );
    }
  );

  await check("the member's own commands are unchanged", () => {
    const nomsa = world.verified("paylink-nomsa", admin);
    const other = world.verified("paylink-other", admin);
    const owed = issue(nomsa);
    const getSql = (who) => member(who, `select api.get_my_invoice('${owed.invoice_number}');`);
    assert.equal(json(getSql(nomsa)).invoice_number, owed.invoice_number);
    assert.equal(reason(fails(getSql(other), "PT404")), "invoice_unavailable");
    fails(
      member(
        other,
        `select api.save_my_invoice_billing('${owed.invoice_number}',1,'Someone Else Ltd',${sqlValue(ADDRESS)},null);`
      ),
      "PT404"
    );
    json(
      member(
        nomsa,
        `select api.save_my_invoice_billing('${owed.invoice_number}',1,'Nomsa Trading',${sqlValue(ADDRESS)},null);`
      )
    );
    // The service role has no session: the member's commands refuse it.
    fails(service(`select api.get_my_invoice('${owed.invoice_number}');`), "42501");
    // A revoked session is refused.
    q(`delete from auth.sessions where id='${nomsa.session}';`);
    fails(getSql(nomsa), "42501", /live session required/);
    fails(
      member(
        nomsa,
        `select api.start_invoice_payment('${owed.invoice_number}',${owed.total_cents},true);`
      ),
      "42501"
    );
  });

  await check("the receipt names the invoice a confirmed bank transfer paid", () => {
    const lindiwe = world.verified("paylink-lindiwe", admin);
    const owed = issue(lindiwe);
    const recorded = json(
      staff(
        admin,
        `select api.record_staff_invoice_transfer('${owed.invoice_number}','FNB PAYLINK 0001','${today}',true,'EFT cleared; customer agreed in writing');`
      )
    );
    const confirmed = json(
      staff(admin2, `select api.confirm_staff_invoice_payment('${recorded.transfer_id}');`)
    );
    const payment = confirmed.payment_id ?? invoiceRow(owed.invoice_number).payment_id;
    assert.equal(invoiceRow(owed.invoice_number).status, "paid");
    assert.equal(
      json(service(`select api.get_payment_receipt('${payment}');`)).customer_invoice_number,
      owed.invoice_number
    );
  });

  await check("the rollback refuses once an invoice email was queued", () => {
    assert.match(fails(kit.rollbackSql, "55000"), /invoice email was queued/);
    assert.equal(
      functionBodyMd5(kit, "internal.start_invoice_payment(text,bigint,boolean)"),
      "missing"
    );
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the payment link", () => {
      const late = world.verified("paylink-later", admin);
      const owed = issue(late);
      assert.equal(emails(owed.invoice_id), "1");
      const link = sha(`link-${owed.invoice_id}`);
      json(prepareSql(owed.invoice_id, link));
      assert.equal(json(readSql(link)).invoice_number, owed.invoice_number);
    });
  }
});
