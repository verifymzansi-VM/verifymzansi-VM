#!/usr/bin/env node
// Behaviour checks for 20261114041000_customer_invoice_pay_now.sql: staff issue
// a customer invoice (VM-YYYY-NNNNNN, numbered without gaps), the customer adds
// billing details, ticks the cooling-off box and pays it with Ozow ("Pay now"),
// and the paid invoice gives exactly what an Ozow checkout of the same order
// gives (roadmap P2b, second slice).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff act with a verified authenticator app and an AAL2 session;
// members with synthetic sessions; the website server (Ozow request, notice
// and status check) as `service_role` with synthetic Ozow ids. The only
// stand-in is internal.current_verified_identity, which answers with the
// member's current accepted identity fact (identity review has its own
// suites). The script checks the read-only preflight and the update's
// refusals, applies the update, proves apply -> rollback -> apply returns the
// schema fingerprint to the same values, then checks: issuing (and its
// refusals, which take no number); numbers without gaps, also when several
// staff issue at once and when an issue fails; only the owner (and staff with
// payments:view) can read an invoice, and only the owner can change or pay it;
// billing details and the cooling-off consent before payment; "Pay now" binds
// the amount, the slots and the invoice number as the Ozow reference; the
// settlement notice is idempotent and checks the amount; a paid or void
// invoice cannot be paid again; a paid invoice gives the same slots, receipt
// event and partner commission as an Ozow checkout; later attempts, attempts
// still being checked and a late settlement of an earlier attempt; another
// open payment and the slot limit; voiding; refunds; the record rules; the
// privacy export, the retention job and the audit trail; the grants; and that
// the rollback refuses once an invoice was issued.
//
//   node --import tsx scripts/test-foundation-customer-invoices.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Members,
// staff, identity facts and partners are written directly as the database
// owner. Nothing contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertReadOnlyPreflight, createChecks } from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";
import {
  P30,
  applyAndProveRollback,
  createPaymentWorld,
  ozowPurchase,
  psqlSessions,
  sha,
  sqlValue,
  updateCheckKit,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261114041000_customer_invoice_pay_now.sql";
/** The 90-day Individual slot on sale since 20261113002421_individual_slots_r69.sql. */
const P90 = { id: "6a449457-2384-457e-9434-23c2b0e73127", cents: 20700 };
const API = [
  "api.issue_staff_invoice(text,integer,integer,integer,text,uuid)",
  "api.void_staff_invoice(uuid,text)",
  "api.get_staff_invoices()",
  "api.get_staff_invoice(text)",
  "api.get_my_invoices()",
  "api.get_my_invoice(text)",
  "api.save_my_invoice_billing(text,integer,text,text,text)",
  "api.start_invoice_payment(text,bigint,boolean)",
];
const INTERNAL = [
  "internal.customer_invoice_number_guard()",
  "internal.customer_invoice_numbers_gapless()",
  "internal.customer_invoice_guard()",
  "internal.customer_invoice_payment_guard()",
  "internal.customer_invoice_payment_settled()",
  "internal.customer_invoice_consent()",
  "internal.customer_invoice_dto(private.customer_invoices,uuid)",
  "internal.customer_invoice_number(text)",
  "internal.customer_invoice_attempt_live(private.payments)",
  "internal.lock_my_issued_invoice(uuid,text)",
];

const started = Date.now();
const { check, current, passed: checks } = createChecks();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  // The replay before this update, its companions and the synthetic world.
  const kit = updateCheckKit(database, UPDATE, current);
  const { q, json, fails, count, member, staff, service, asRole, preflight, fingerprint } = kit;
  const { step, steps, index, rollbackSql: ROLLBACK, preflightSql: PREFLIGHT } = kit;
  const world = createPaymentWorld(kit);
  const { staffUser, user } = world;
  const admin = staffUser("inv-admin", "admin");
  const admin2 = staffUser("inv-admin2", "admin");
  const unreviewedAdmin = staffUser("inv-admin3", "admin");
  const moderator = staffUser("inv-moderator", "moderator");
  world.review(admin, admin2, "inv-admin");
  world.review(admin2, admin, "inv-admin2");
  world.review(moderator, admin, "inv-moderator");
  const verified = (label) => world.verified(label, admin);
  const { sessionAfter } = psqlSessions(database);
  const year = q("select extract(year from (now() at time zone 'Africa/Johannesburg'))::int;");
  const daysFromToday = (n) =>
    q(`select to_char((now() at time zone 'Africa/Johannesburg')::date + ${n},'YYYY-MM-DD');`);
  const number = (n) => `VM-${year}-${String(n).padStart(6, "0")}`;

  // ------------------------------------------------------------ commands
  const issueSql = (who, input) => {
    const a = {
      email: null,
      term: 90,
      slots: 3,
      due: 7,
      reason: "Invoice requested by email",
      request: randomUUID(),
      ...input,
    };
    const value = (v) => (v === null ? "null" : v);
    return staff(
      who,
      `select api.issue_staff_invoice(${sqlValue(a.email)},${value(a.term)},${value(a.slots)},${value(a.due)},${sqlValue(a.reason)},${a.request === null ? "null" : `'${a.request}'`});`
    );
  };
  const issue = (who, input) => json(issueSql(who, input));
  const voidSql = (who, id, reason = "Issued for the wrong term") =>
    staff(who, `select api.void_staff_invoice('${id}',${sqlValue(reason)});`);
  const mineSql = (owner, invoice) =>
    member(owner, `select api.get_my_invoice(${sqlValue(invoice)});`);
  const mine = (owner, invoice) => json(mineSql(owner, invoice));
  const saveSql = (owner, invoice, revision, input = {}) => {
    const a = {
      name: "Fixture Traders (Pty) Ltd",
      address: "1 Example Road\nEmpangeni\n3880",
      registration: "2020/123456/07",
      ...input,
    };
    return member(
      owner,
      `select api.save_my_invoice_billing(${sqlValue(invoice)},${revision === null ? "null" : revision},${sqlValue(a.name)},${sqlValue(a.address)},${sqlValue(a.registration)});`
    );
  };
  const save = (owner, invoice, revision, input) => json(saveSql(owner, invoice, revision, input));
  const startSql = (owner, invoice, total, consent = true) =>
    member(
      owner,
      `select api.start_invoice_payment(${sqlValue(invoice)},${total === null ? "null" : total},${consent === null ? "null" : consent});`
    );
  const start = (owner, invoice, total, consent) => json(startSql(owner, invoice, total, consent));
  /** The website server opens the attempt's Ozow request (service commands). */
  const openAtOzow = (owner, paymentId) => {
    const lease = json(service(`select api.claim_checkout_request('${paymentId}','${owner.id}');`));
    if (!lease.checkout_url)
      q(
        service(
          `select api.complete_checkout_request('${paymentId}','${owner.id}','${lease.claim_token}','req-${paymentId}','https://one.ozow.com/checkout/req-${paymentId}');`
        )
      );
    return lease;
  };
  /** Ozow's notice for a payment as the website server applies it. */
  const settle = (paymentId, { key = "complete", ...event } = {}) => {
    const row =
      json(`select jsonb_build_object('ref',merchant_reference,'request',provider_request_id,
      'amount',amount_cents) from private.payments where id='${paymentId}';`);
    const payload = {
      payload_sha256: sha(`invoice-event-${paymentId}-${key}`),
      merchant_reference: row.ref,
      provider_request_id: row.request,
      provider_transaction_id: randomUUID(),
      status: "complete",
      amount_cents: Number(row.amount),
      currency: "ZAR",
      ...event,
    };
    return json(
      service(`select api.apply_provider_event($e$${JSON.stringify(payload)}$e$::jsonb);`)
    );
  };
  /** Issue, add billing details, pay now, open at Ozow and settle. */
  const paidInvoice = (owner, input) => {
    const invoice = issue(admin, { email: owner.email, ...input });
    save(owner, invoice.invoice_number, 1);
    const quote = start(owner, invoice.invoice_number, invoice.total_cents);
    openAtOzow(owner, quote.payment_id);
    assert.equal(settle(quote.payment_id).outcome, "completed");
    return { invoice, paymentId: quote.payment_id };
  };
  const invoiceRow = (invoiceNumber) =>
    json(
      `select to_jsonb(i) from private.customer_invoices i where invoice_number='${invoiceNumber}';`
    );
  const payment = (id) =>
    json(`select jsonb_build_object('status',status,'fulfillment',fulfillment_status,'provider',provider,
      'reference',merchant_reference,'amount',amount_cents,'owner',owner_id,'snapshot',snapshot)
      from private.payments where id='${id}';`);
  /** What a payment delivered, without ids and times: lines, slots, invoice, receipt event, commissions. */
  const delivered = (id) =>
    json(`select jsonb_build_object(
      'lines',(select jsonb_agg(jsonb_build_array(l.line_number,l.amount_cents,l.status) order by l.line_number)
        from private.payment_lines l where l.payment_id='${id}'),
      'slots',(select jsonb_agg(jsonb_build_array(e.source,e.status,e.slot_capacity,e.activations_per_period,
          e.activation_period_days,e.max_photos,e.max_videos,e.addon_capabilities,
          round(extract(epoch from e.ends_at-e.starts_at)/86400),e.payment_line_id is not null,
          e.starts_at=(select p.completed_at from private.payments p where p.id='${id}')) order by e.payment_line_id)
        from private.entitlements e where e.payment_id='${id}'),
      'invoice',(select jsonb_build_array(i.total_cents,i.vat_cents,i.amount_ex_vat_cents,i.description,
          i.invoice_number ~ '^INV-[0-9]{8}-[0-9A-F]{10}$') from private.invoices i where i.payment_id='${id}'),
      'receipt_event',(select count(*) from private.outbox_events o where o.kind='payment_completed' and o.subject_id='${id}'),
      'commissions',(select jsonb_agg(jsonb_build_array(c.base_cents,c.rate_bps,c.amount_cents,c.status,
          c.payment_line_id is not null) order by c.base_cents, c.payment_line_id) from private.partner_commissions c
        where c.payment_id='${id}'),
      'fulfillment',(select p.fulfillment_status from private.payments p where p.id='${id}'));`);
  const numbers = () =>
    q(
      `select coalesce(string_agg(sequence_number::text,',' order by sequence_number),'') from private.customer_invoices where invoice_year=${year};`
    );

  // ------------------------------------------------------------ before
  await check("before the update: preflight reads 'not applied', the commands are absent", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "customer invoices: update not applied (apply before the website release that uses it is deployed); " +
        "invoices issued: none (table absent); payment attempts: none (table absent)"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
    fails(issueSql(admin, { email: "x@example.invalid" }), "42883");
  });

  await check("the update refuses without the reviewed bodies or with a drifted table", () => {
    const before = fingerprint();
    const original = q(
      "select pg_get_functiondef('internal.individual_slot_limit(text)'::regprocedure);"
    );
    q(`create or replace function internal.individual_slot_limit(p_identity text) returns integer
      language sql stable set search_path to 'pg_catalog' as $fn$ select 100 $fn$;`);
    assert.match(
      fails(step.sql, "55000"),
      /individual_slot_limit\(text\) [0-9a-f]{32} is not the reviewed body this update builds on/
    );
    assert.match(
      preflight()
        .map((r) => r[1])
        .join("\n"),
      /internal\.individual_slot_limit\(text\) is not the reviewed body this update builds on/
    );
    q(`${original};`);
    q("create table private.customer_invoices(id uuid primary key);");
    assert.match(fails(step.sql, "55000"), /table drift: private\.customer_invoices id/);
    q("drop table private.customer_invoices;");
    assert.equal(fingerprint(), before);
  });

  // An Ozow payment from before the update is untouched by it.
  const early = verified("inv-early");
  const earlyPayment = ozowPurchase(kit, early, P30, 1);

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "customer invoices",
    applied:
      /^customer invoices: already applied; invoices issued: 0 \(unpaid: 0\); payment attempts: 0$/,
    notApplied: /^customer invoices: update not applied/,
  });
  await check("an earlier Ozow payment is untouched", () => {
    assert.equal(payment(earlyPayment).status, "complete");
    assert.equal(count(`private.customer_invoice_payments where payment_id='${earlyPayment}'`), 0);
  });

  // A partner who referred two customers: one buys by Ozow checkout, one pays an invoice.
  const partner = user("inv-partner");
  q(`select set_config('session_replication_role','replica',false);
    insert into private.partners(account_id,code,status,commission_bps,created_by)
      values('${partner.id}','INVPART1','active',2000,'${admin.id}');
    select set_config('session_replication_role','origin',false);`);
  const referred = (label) => {
    const m = verified(label);
    q(`select set_config('session_replication_role','replica',false);
      insert into private.account_acquisitions(account_id,source,partner_id)
        values('${m.id}','partner',(select id from private.partners where account_id='${partner.id}'));
      select set_config('session_replication_role','origin',false);`);
    return m;
  };

  // --------------------------------------------------------------- issue
  const thandi = referred("inv-thandi");
  let first;
  await check("staff issue an invoice: numbered, priced and described by the database", () => {
    const request = randomUUID();
    first = issue(admin, { email: thandi.email, term: 90, slots: 3, due: 7, request });
    assert.equal(first.invoice_number, number(1));
    assert.equal(first.status, "issued");
    assert.equal(first.total_cents, 3 * P90.cents);
    assert.equal(first.unit_price_cents, P90.cents);
    assert.equal(first.slots, 3);
    assert.equal(first.term_days, 90);
    assert.equal(first.description, "3 × Individual slot — 90 days");
    assert.equal(first.due_on, daysFromToday(7));
    assert.equal(first.payment_reference, number(1));
    assert.deepEqual(first.seller, {
      legal_name: "Verifymzansi (Pty) Ltd",
      registration_number: "2026/155305/07",
      vat_registered: false,
    });
    assert.equal(first.buyer, null);
    assert.equal(first.customer_email, thandi.email);
    assert.equal(first.issued_by_me, true);
    assert.equal(first.repeated, false);
    assert.equal(first.consent.version, "invoice-cooling-off-v1");
    // The same request again (a retried submission) returns the first invoice.
    const again = issue(admin, { email: thandi.email, term: 90, slots: 3, due: 7, request });
    assert.equal(again.invoice_number, number(1));
    assert.equal(again.repeated, true);
    fails(
      issueSql(admin, { email: thandi.email, term: 90, slots: 2, due: 7, request }),
      "PT409",
      /already issued another invoice/
    );
    assert.equal(numbers(), "1");
  });

  await check("issuing refuses wrong callers and orders, and a refusal takes no number", () => {
    const unverified = user("inv-unverified");
    const blocked = verified("inv-blocked");
    q(`update auth.users set banned_until=now()+interval '1 day' where id='${blocked.id}';`);
    const refusals = [
      [issueSql(moderator, { email: thandi.email }), "42501"],
      [issueSql(unreviewedAdmin, { email: thandi.email }), "42501", /own for this/],
      [issueSql(admin, { email: admin.email }), "42501", /different staff member/],
      [issueSql(admin, { email: "nobody@example.invalid" }), "PT404"],
      [issueSql(admin, { email: unverified.email }), "PT412"],
      [issueSql(admin, { email: blocked.email }), "PT409", /cannot use slots/],
      [issueSql(admin, { email: thandi.email, slots: 5 }), "PT429"],
      [issueSql(admin, { email: thandi.email, term: 60 }), "22023"],
      [issueSql(admin, { email: thandi.email, due: 0 }), "22023"],
      [issueSql(admin, { email: thandi.email, due: 31 }), "22023"],
      [issueSql(admin, { email: thandi.email, request: null }), "22023"],
      [issueSql(admin, { email: thandi.email, reason: "no" }), "22023"],
    ];
    for (const [sql, state, message] of refusals) fails(sql, state, message);
    // The VAT setting must still say "not registered".
    q(
      `update private.invoice_merchant_config set registration_status='registered',vat_number='4123456789',vat_rate_bps=1500;`
    );
    fails(issueSql(admin, { email: thandi.email }), "PT409", /VAT registration setting changed/);
    q(
      `update private.invoice_merchant_config set registration_status='not_registered',vat_number=null,vat_rate_bps=0;`
    );
    assert.equal(numbers(), "1");
    assert.equal(
      issue(admin2, { email: thandi.email, slots: 1, term: 30 }).invoice_number,
      number(2)
    );
  });

  await check("staff never invoice a customer a partner account of their identity referred", () => {
    const own = verified("inv-own-referral");
    q(`select set_config('session_replication_role','replica',false);
      insert into private.partners(account_id,code,status,commission_bps,created_by)
        values('${admin2.id}','INVPART2','active',2000,'${admin.id}');
      insert into private.account_acquisitions(account_id,source,partner_id)
        values('${own.id}','partner',(select id from private.partners where account_id='${admin2.id}'));
      select set_config('session_replication_role','origin',false);`);
    fails(issueSql(admin2, { email: own.email }), "42501", /customer you referred/);
    assert.equal(issue(admin, { email: own.email, slots: 1 }).invoice_number, number(3));
  });

  // ------------------------------------------------------------- numbers
  await check(
    "numbers run without gaps when staff issue at once and when an issue fails",
    async () => {
      const buyers = Array.from({ length: 5 }, (_, i) => verified(`inv-race-${i}`));
      const runs = buyers.map((buyer, i) =>
        sessionAfter(
          i * 50,
          `begin;\n${issueSql(i % 2 ? admin : admin2, { email: buyer.email, slots: 1, term: 30 })}\nselect pg_sleep(0.4);\ncommit;`
        )
      );
      // An issue rolled back after taking its number gives it back.
      runs.push(
        sessionAfter(
          120,
          `begin;\n${issueSql(admin, { email: buyers[0].email, slots: 1, term: 30 })}\nselect pg_sleep(0.2);\nrollback;`
        )
      );
      const results = await Promise.all(runs);
      for (const result of results) assert.equal(result.status, 0, result.stderr);
      assert.equal(numbers(), "1,2,3,4,5,6,7,8");
      assert.equal(
        q(`select last_number from private.customer_invoice_numbers where invoice_year=${year};`),
        "8"
      );
      // The counter cannot skip, step back or lose an invoice.
      fails(
        `update private.customer_invoice_numbers set last_number=last_number+2 where invoice_year=${year};`,
        "23514"
      );
      fails(
        `update private.customer_invoice_numbers set last_number=last_number-1 where invoice_year=${year};`,
        "23514"
      );
      fails(
        `update private.customer_invoice_numbers set last_number=last_number+1 where invoice_year=${year};`,
        "23514",
        /without gaps/
      );
      fails(`delete from private.customer_invoice_numbers where invoice_year=${year};`, "23514");
      fails(
        `insert into private.customer_invoices(invoice_number,invoice_year,sequence_number,account_id,plan_version_id,slots,
         unit_price_cents,total_cents,description,due_on,issued_by,issue_reason,request_id,seller)
       values('${number(10)}',${year},10,'${thandi.id}','${P30.id}',1,6900,6900,'Individual slot',current_date+7,
         '${admin.id}','Inserted by hand',gen_random_uuid(),'{}');`,
        "23514"
      );
      assert.equal(numbers(), "1,2,3,4,5,6,7,8");
    }
  );

  // ------------------------------------------------------------ access
  await check(
    "only the owner reads, changes or pays an invoice; staff read with payments:view",
    () => {
      const stranger = verified("inv-stranger");
      assert.equal(mine(thandi, first.invoice_number).invoice_number, number(1));
      assert.equal(mine(thandi, first.invoice_number.toLowerCase()).invoice_number, number(1));
      assert.equal(mine(thandi, first.invoice_number).customer_email, undefined);
      for (const sql of [
        mineSql(stranger, first.invoice_number),
        mineSql(thandi, "VM-2026-00001"),
        mineSql(thandi, "not an invoice"),
        saveSql(stranger, first.invoice_number, 1),
        startSql(stranger, first.invoice_number, first.total_cents),
      ])
        fails(sql, "PT404", /invoice not found/);
      assert.ok(
        json(member(stranger, "select api.get_my_invoices();")).items.every(
          (item) => item.invoice_number !== first.invoice_number
        )
      );
      assert.deepEqual(
        json(member(thandi, "select api.get_my_invoices();")).items.map(
          (item) => item.invoice_number
        ),
        [number(2), number(1)]
      );
      assert.equal(
        json(staff(admin2, `select api.get_staff_invoice('${first.invoice_number}');`))
          .customer_email,
        thandi.email
      );
      assert.equal(json(staff(admin2, "select api.get_staff_invoices();")).items.length, 8);
      fails(staff(moderator, `select api.get_staff_invoice('${first.invoice_number}');`), "42501");
      fails(member(thandi, `select api.get_staff_invoice('${first.invoice_number}');`), "42501");
      fails(staff(admin, `select api.get_staff_invoice('VM-${year}-999999');`), "PT404");
      fails(asRole("anon", `select api.get_my_invoice('${first.invoice_number}');`), "42501");
      fails(service(`select api.get_my_invoice('${first.invoice_number}');`), "42501");
    }
  );

  // ------------------------------------------------- billing and consent
  let quote;
  await check("billing details and the cooling-off consent come before payment", () => {
    fails(startSql(thandi, first.invoice_number, first.total_cents), "PT409", /billing details/);
    fails(saveSql(thandi, first.invoice_number, 1, { name: "x" }), "22023");
    fails(saveSql(thandi, first.invoice_number, 1, { address: "" }), "22023");
    fails(saveSql(thandi, first.invoice_number, 1, { registration: "<script>" }), "22023");
    const saved = save(thandi, first.invoice_number, 1, {
      name: "  Fixture   Traders (Pty) Ltd ",
      address: "1 Example Road\r\nEmpangeni\r\n3880",
    });
    assert.equal(saved.revision, 2);
    assert.deepEqual(saved.buyer, {
      name: "Fixture Traders (Pty) Ltd",
      address: "1 Example Road\nEmpangeni\n3880",
      registration_number: "2020/123456/07",
    });
    assert.equal(saved.repeated, false);
    // The same details again change nothing; a stale revision is refused.
    assert.equal(save(thandi, first.invoice_number, 1).repeated, true);
    fails(
      saveSql(thandi, first.invoice_number, 1, { registration: null }),
      "PT409",
      /invoice changed/
    );
    assert.equal(save(thandi, first.invoice_number, 2, { registration: null }).revision, 3);
    save(thandi, first.invoice_number, 3);
    // No consent, or another total: refused, nothing recorded.
    fails(startSql(thandi, first.invoice_number, first.total_cents, false), "22023", /consent/);
    fails(startSql(thandi, first.invoice_number, first.total_cents, null), "22023", /consent/);
    fails(startSql(thandi, first.invoice_number, first.total_cents - 1), "PT428");
    fails(startSql(thandi, first.invoice_number, null), "22023");
    assert.equal(count(`private.payments where owner_id='${thandi.id}'`), 0);
    assert.equal(invoiceRow(first.invoice_number).cooling_off_consent_at, null);
  });

  await check(
    "Pay now: an Ozow payment of the invoice total, its slots and the invoice number",
    () => {
      quote = start(thandi, first.invoice_number, first.total_cents);
      assert.equal(quote.reused, false);
      assert.equal(quote.amount_cents, String(first.total_cents));
      assert.equal(quote.merchant_reference, first.invoice_number);
      assert.equal(quote.slots, 3);
      const pay = payment(quote.payment_id);
      assert.equal(pay.status, "pending");
      assert.equal(pay.provider, "ozow");
      assert.equal(pay.reference, first.invoice_number);
      assert.equal(pay.snapshot.customer_invoice_id, first.invoice_id);
      assert.equal(pay.snapshot.invoice_description, "3 × Individual slot — 90 days");
      assert.equal(pay.snapshot.cooling_off_consent.method, "invoice");
      assert.equal(pay.snapshot.cooling_off_consent.version, "invoice-cooling-off-v1");
      assert.deepEqual(
        json(`select jsonb_agg(amount_cents order by line_number) from private.payment_lines
        where payment_id='${quote.payment_id}';`),
        [P90.cents, P90.cents, P90.cents]
      );
      const row = invoiceRow(first.invoice_number);
      assert.ok(row.cooling_off_consent_at);
      assert.equal(row.cooling_off_consent_version, "invoice-cooling-off-v1");
      // Not yet sent to Ozow: the same attempt again.
      const again = start(thandi, first.invoice_number, first.total_cents);
      assert.deepEqual([again.payment_id, again.reused], [quote.payment_id, true]);
      // Open at Ozow: the customer continues there.
      openAtOzow(thandi, quote.payment_id);
      const open = start(thandi, first.invoice_number, first.total_cents);
      assert.deepEqual([open.payment_id, open.reused], [quote.payment_id, true]);
      assert.equal(mine(thandi, first.invoice_number).latest_attempt.checkout_open, true);
      assert.equal(
        invoiceRow(first.invoice_number).cooling_off_consent_at,
        row.cooling_off_consent_at,
        "the consent is recorded once"
      );
      assert.equal(
        count(`private.customer_invoice_payments where invoice_id='${first.invoice_id}'`),
        1
      );
    }
  );

  await check(
    "the settlement notice checks the amount, pays the invoice once and is idempotent",
    () => {
      const wrong = settle(quote.payment_id, {
        key: "wrong",
        amount_cents: first.total_cents - 100,
      });
      assert.equal(wrong.outcome, "amount_mismatch");
      assert.equal(invoiceRow(first.invoice_number).status, "issued");
      const paid = settle(quote.payment_id);
      assert.equal(paid.outcome, "completed");
      const row = invoiceRow(first.invoice_number);
      assert.equal(row.status, "paid");
      assert.equal(row.payment_id, quote.payment_id);
      assert.equal(
        row.paid_at,
        json(`select to_jsonb(completed_at) from private.payments where id='${quote.payment_id}';`)
      );
      assert.equal(settle(quote.payment_id).outcome, "duplicate_event");
      assert.equal(settle(quote.payment_id, { key: "second" }).outcome, "conflicting_transaction");
      assert.equal(invoiceRow(first.invoice_number).payment_id, quote.payment_id);
      const view = mine(thandi, first.invoice_number);
      assert.equal(view.status, "paid");
      assert.equal(view.payment_status, "complete");
    }
  );

  await check(
    "a paid invoice gives the same slots, receipt and commission as an Ozow checkout",
    () => {
      const sipho = referred("inv-sipho");
      const checkout = ozowPurchase(kit, sipho, P90, 3);
      const viaInvoice = delivered(quote.payment_id);
      assert.deepEqual(viaInvoice, delivered(checkout));
      assert.equal(viaInvoice.slots.length, 3);
      assert.equal(viaInvoice.receipt_event, 1);
      assert.equal(viaInvoice.commissions.length, 3);
      assert.equal(viaInvoice.fulfillment, "fulfilled");
    }
  );

  await check("a paid invoice cannot be paid, changed or voided", () => {
    fails(startSql(thandi, first.invoice_number, first.total_cents), "PT409", /already paid/);
    fails(saveSql(thandi, first.invoice_number, 4), "PT409", /already paid/);
    fails(voidSql(admin, first.invoice_id), "PT409", /refund the payment/);
    assert.equal(
      count(`private.customer_invoice_payments where invoice_id='${first.invoice_id}'`),
      1
    );
  });

  // ---------------------------------------------------------- attempts
  await check("later attempts: a closed attempt makes way, a live one is being checked", () => {
    const lerato = verified("inv-lerato");
    const invoice = issue(admin, { email: lerato.email, term: 30, slots: 2 });
    save(lerato, invoice.invoice_number, 1);
    const one = start(lerato, invoice.invoice_number, invoice.total_cents);
    openAtOzow(lerato, one.payment_id);
    // Its Ozow window passed while still pending: being checked.
    q(
      `update private.payments set checkout_expires_at=now()-interval '1 minute' where id='${one.payment_id}';`
    );
    fails(startSql(lerato, invoice.invoice_number, invoice.total_cents), "PT409", /being checked/);
    // The status check closes it: a new attempt, its reference ending -2.
    q(service(`select api.finish_unpaid_checkout('${one.payment_id}','expired');`));
    const two = start(lerato, invoice.invoice_number, invoice.total_cents);
    assert.equal(two.merchant_reference, `${invoice.invoice_number}-2`);
    openAtOzow(lerato, two.payment_id);
    // A declined bank attempt while Ozow's page may still take another try.
    assert.equal(settle(two.payment_id, { key: "error", status: "error" }).outcome, "not_paid");
    fails(startSql(lerato, invoice.invoice_number, invoice.total_cents), "PT409", /being checked/);
    q(
      `update private.payments set checkout_expires_at=now()-interval '1 minute' where id='${two.payment_id}';`
    );
    const three = start(lerato, invoice.invoice_number, invoice.total_cents);
    assert.equal(three.merchant_reference, `${invoice.invoice_number}-3`);
    openAtOzow(lerato, three.payment_id);
    assert.equal(settle(three.payment_id).outcome, "completed");
    assert.equal(invoiceRow(invoice.invoice_number).payment_id, three.payment_id);
    // An earlier attempt settling late: the money is kept, staff see it.
    assert.equal(settle(two.payment_id, { key: "late" }).outcome, "completed");
    assert.equal(invoiceRow(invoice.invoice_number).payment_id, three.payment_id);
    assert.equal(
      q(
        `select needs_alert from private.payment_problems where payment_id='${two.payment_id}' and reason='conflicting_transaction';`
      ),
      "t"
    );
    assert.equal(mine(lerato, invoice.invoice_number).latest_attempt.attempt, 3);
  });

  await check("another open payment for the slot term, and the slot limit, come first", () => {
    const naledi = verified("inv-naledi");
    const invoice = issue(admin, { email: naledi.email, term: 30, slots: 1 });
    save(naledi, invoice.invoice_number, 1);
    // An ordinary checkout open at Ozow for the same term: finish or cancel it first.
    const open = json(
      member(naledi, `select api.start_slot_checkout('${P30.id}',1,${P30.cents},true);`)
    );
    openAtOzow(naledi, open.payment_id);
    fails(
      startSql(naledi, invoice.invoice_number, invoice.total_cents),
      "PT409",
      /other open payment/
    );
    q(service(`select api.finish_unpaid_checkout('${open.payment_id}','cancelled');`));
    // One never sent to Ozow is closed instead.
    const unsent = json(
      member(naledi, `select api.start_slot_checkout('${P30.id}',2,${2 * P30.cents},true);`)
    );
    const paying = start(naledi, invoice.invoice_number, invoice.total_cents);
    assert.equal(payment(unsent.payment_id).status, "cancelled");
    assert.equal(payment(paying.payment_id).status, "pending");
    // The slot limit counts held slots and open checkouts.
    const kagiso = verified("inv-kagiso");
    const full = issue(admin, { email: kagiso.email, term: 90, slots: 4 });
    save(kagiso, full.invoice_number, 1);
    ozowPurchase(kit, kagiso, P30, 1);
    fails(startSql(kagiso, full.invoice_number, full.total_cents), "PT429");
    assert.equal(
      count(`private.customer_invoice_payments where invoice_id='${full.invoice_id}'`),
      0
    );
  });

  await check("ID review, access and the catalogue are checked again at payment", () => {
    const zola = verified("inv-zola");
    const invoice = issue(admin, { email: zola.email, term: 30, slots: 1 });
    save(zola, invoice.invoice_number, 1);
    q(`select set_config('session_replication_role','replica',false);
      update private.accepted_identity_facts set revoked_at=now() where owner_id='${zola.id}';
      select set_config('session_replication_role','origin',false);`);
    fails(startSql(zola, invoice.invoice_number, invoice.total_cents), "PT412");
    q(`select set_config('session_replication_role','replica',false);
      update private.accepted_identity_facts set revoked_at=null where owner_id='${zola.id}';
      select set_config('session_replication_role','origin',false);`);
    q(`select set_config('session_replication_role','replica',false);
      update private.plan_versions set retired_at=now() where id='${P30.id}';
      select set_config('session_replication_role','origin',false);`);
    fails(
      startSql(zola, invoice.invoice_number, invoice.total_cents),
      "PT409",
      /no longer be paid online/
    );
    q(`select set_config('session_replication_role','replica',false);
      update private.plan_versions set retired_at=null where id='${P30.id}';
      select set_config('session_replication_role','origin',false);`);
    assert.equal(start(zola, invoice.invoice_number, invoice.total_cents).reused, false);
  });

  // --------------------------------------------------------------- void
  await check("staff void an unpaid invoice no attempt can still pay; it can never be paid", () => {
    const musa = verified("inv-musa");
    const invoice = issue(admin, { email: musa.email, term: 30, slots: 1 });
    save(musa, invoice.invoice_number, 1);
    const attempt = start(musa, invoice.invoice_number, invoice.total_cents);
    openAtOzow(musa, attempt.payment_id);
    fails(voidSql(admin, invoice.invoice_id), "PT409", /still open at Ozow/);
    fails(voidSql(moderator, invoice.invoice_id), "42501");
    fails(voidSql(admin, invoice.invoice_id, "no"), "22023");
    q(service(`select api.finish_unpaid_checkout('${attempt.payment_id}','expired');`));
    const voided = json(voidSql(admin, invoice.invoice_id));
    assert.equal(voided.status, "void");
    assert.equal(voided.void_reason, "Issued for the wrong term");
    assert.equal(json(voidSql(admin, invoice.invoice_id)).repeated, true);
    fails(voidSql(admin2, invoice.invoice_id), "PT409", /already void/);
    fails(startSql(musa, invoice.invoice_number, invoice.total_cents), "PT409", /cancelled/);
    fails(saveSql(musa, invoice.invoice_number, 2), "PT409", /cancelled/);
    assert.equal(mine(musa, invoice.invoice_number).status, "void");
    // A void invoice keeps its number; an attempt never sent to Ozow is closed with it.
    const other = issue(admin, { email: musa.email, term: 30, slots: 1 });
    save(musa, other.invoice_number, 1);
    const unsent = start(musa, other.invoice_number, other.total_cents);
    json(voidSql(admin2, other.invoice_id, "Customer chose another order"));
    assert.equal(payment(unsent.payment_id).status, "cancelled");
    assert.equal(invoiceRow(invoice.invoice_number).invoice_number, invoice.invoice_number);
  });

  // ------------------------------------------------------------ refunds
  await check("refunds work on a paid invoice's payment as on any Ozow payment", () => {
    const busi = referred("inv-busi");
    const { invoice, paymentId } = paidInvoice(busi, { term: 30, slots: 2 });
    // One slot of two: that slot and its commission only.
    const line = q(
      `select id from private.payment_lines where payment_id='${paymentId}' and line_number=2;`
    );
    assert.equal(
      json(
        staff(
          admin,
          `select api.record_staff_slot_refund('${line}','refunded','s14_cancellation','Cancelled within 14 days','OZ-INV-REFUND-1');`
        )
      ).status,
      "applied"
    );
    assert.deepEqual(
      json(`select jsonb_agg(jsonb_build_array(l.status,c.status) order by l.line_number)
        from private.payment_lines l join private.partner_commissions c on c.payment_line_id=l.id
        where l.payment_id='${paymentId}';`),
      [
        ["open", "pending"],
        ["reversed", "reversed"],
      ]
    );
    // Refunds through Ozow can address it (its transaction id).
    assert.notEqual(q(`select internal.ozow_refund_transaction('${paymentId}');`), "");
    // A whole payment: refunded, the invoice stays paid and says so.
    const mpho = verified("inv-mpho");
    const whole = paidInvoice(mpho, { term: 30, slots: 1 });
    assert.equal(
      json(
        staff(
          admin,
          `select api.record_staff_payment_refund('${whole.paymentId}','refunded','billing_error','Refunded to the payer','OZ-INV-REFUND-2');`
        )
      ).status,
      "applied"
    );
    const view = mine(mpho, whole.invoice.invoice_number);
    assert.deepEqual([view.status, view.payment_status], ["paid", "refunded"]);
    assert.equal(mine(busi, invoice.invoice_number).payment_status, "complete");
  });

  // -------------------------------------------------------------- rules
  await check("invoices and attempts keep their rules", () => {
    for (const sql of [
      `update private.customer_invoices set total_cents=total_cents+100,unit_price_cents=unit_price_cents where id='${first.invoice_id}';`,
      `update private.customer_invoices set description='Changed later' where id='${first.invoice_id}';`,
      `update private.customer_invoices set status='issued',payment_id=null,paid_at=null where id='${first.invoice_id}';`,
      `update private.customer_invoices set buyer_name='Someone Else' where id='${first.invoice_id}';`,
      `delete from private.customer_invoices where id='${first.invoice_id}';`,
      `update private.customer_invoice_payments set attempt=2 where payment_id='${quote.payment_id}';`,
      `delete from private.customer_invoice_payments where payment_id='${quote.payment_id}';`,
    ])
      fails(sql, "23514");
    // An issued invoice cannot be marked paid with another payment, nor its consent changed.
    const issued = q(
      "select id from private.customer_invoices where status='issued' and cooling_off_consent_at is not null limit 1;"
    );
    fails(
      `update private.customer_invoices set status='paid',payment_id='${earlyPayment}',paid_at=now() where id='${issued}';`,
      "23514",
      /names its complete Ozow payment/
    );
    fails(
      `update private.customer_invoices set cooling_off_consent_at=now() where id='${issued}';`,
      "23514"
    );
    // An attempt is a new pending Ozow payment of that invoice.
    fails(
      `insert into private.customer_invoice_payments(payment_id,invoice_id,attempt) values('${earlyPayment}','${issued}',9);`,
      "23514"
    );
  });

  // ------------------------------------------- export, retention, audit
  await check("the privacy export holds the member's own invoices, never staff details", () => {
    const exported = json(
      `select internal.frontend_privacy_export_data('${thandi.id}')->'customer_invoices';`
    );
    assert.deepEqual(
      exported.map((row) => row.invoice_number),
      [number(1), number(2)]
    );
    assert.equal(exported[0].buyer_name, "Fixture Traders (Pty) Ltd");
    assert.deepEqual(exported[0].payment_attempts, [quote.payment_id]);
    for (const key of ["issued_by", "issue_reason", "voided_by", "void_reason", "account_id"])
      assert.equal(key in exported[0], false, key);
    assert.deepEqual(
      json(`select internal.frontend_privacy_export_data('${early.id}')->'customer_invoices';`),
      []
    );
  });

  await check(
    "the retention job keeps payments an invoice names and removes invoices five tax years on",
    () => {
      const old = verified("inv-old");
      const { invoice, paymentId } = paidInvoice(old, { term: 30, slots: 1 });
      // The payment and everything it delivered are old; the invoice is not.
      q(`select set_config('session_replication_role','replica',false);
      update private.payments set completed_at=now()-interval '7 years',created_at=now()-interval '7 years',
        status_changed_at=now()-interval '7 years' where id='${paymentId}';
      update private.entitlements set starts_at=now()-interval '7 years',ends_at=now()-interval '7 years'+interval '30 days',
        created_at=now()-interval '7 years' where payment_id='${paymentId}';
      update private.invoices set issued_at=now()-interval '7 years' where payment_id='${paymentId}';
      update private.provider_events set received_at=now()-interval '7 years' where payment_id='${paymentId}';
      update private.outbox_events set created_at=now()-interval '7 years' where subject_id='${paymentId}';
      select set_config('session_replication_role','origin',false);`);
      const firstRun = json(service("select api.run_retention(1000);"));
      assert.equal(firstRun.commerce.customer_invoices, 0);
      assert.equal(count(`private.payments where id='${paymentId}'`), 1);
      // Now the invoice too: it and its attempt go, then the payment.
      q(`select set_config('session_replication_role','replica',false);
      update private.customer_invoices set issued_at=now()-interval '7 years',paid_at=now()-interval '7 years'
        where invoice_number='${invoice.invoice_number}';
      select set_config('session_replication_role','origin',false);`);
      const secondRun = json(service("select api.run_retention(1000);"));
      assert.equal(secondRun.commerce.customer_invoices, 1);
      assert.equal(
        count(`private.customer_invoices where invoice_number='${invoice.invoice_number}'`),
        0
      );
      assert.equal(count(`private.customer_invoice_payments where payment_id='${paymentId}'`), 0);
      assert.equal(count(`private.payments where id='${paymentId}'`), 0);
    }
  );

  await check("the staff audit trail lists invoices issued and voided", () => {
    const actions = json(`select jsonb_object_agg(action,n) from (select action,count(*) n
      from private.frontend_staff_audit_events where action like 'payment:customer_invoice_%' group by action) a;`);
    assert.ok(actions["payment:customer_invoice_issued"] >= 10);
    assert.equal(actions["payment:customer_invoice_voided"], 2);
    assert.match(
      q(
        `select reason from private.frontend_staff_audit_events where id='customer_invoice_issued:${first.invoice_id}';`
      ),
      new RegExp(`^Invoice ${number(1)} \\(3 slots, 62100 cents\\): Invoice requested by email$`)
    );
  });

  await check("grants: commands for authenticated only, helpers and tables closed", () => {
    const grants = json(
      "select jsonb_object_agg(r.rolname||' '||f.sig,has_function_privilege(r.rolname,f.sig,'execute')) " +
        "from (values('anon'),('authenticated'),('service_role')) r(rolname), " +
        `(values${[...API, ...INTERNAL].map((sig) => `('${sig}')`).join(",")}) f(sig);`
    );
    for (const [key, value] of Object.entries(grants)) {
      const [role, sig] = key.split(" ");
      assert.equal(value, role === "authenticated" && sig.startsWith("api."), key);
    }
    assert.equal(
      q(
        "select bool_or(has_table_privilege(r,t,'select,insert,update,delete')) from unnest(array['anon','authenticated','service_role']) r, " +
          "unnest(array['private.customer_invoices','private.customer_invoice_numbers','private.customer_invoice_payments']) t;"
      ),
      "f"
    );
    assert.equal(
      q(
        "select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('private.customer_invoices'::regclass,'private.customer_invoice_numbers'::regclass,'private.customer_invoice_payments'::regclass);"
      ),
      "t"
    );
    fails(service(`select api.start_invoice_payment('${first.invoice_number}',1,true);`), "42501");
    fails(
      service(
        `select api.issue_staff_invoice('x@example.invalid',30,1,7,'Reason here',gen_random_uuid());`
      ),
      "42501"
    );
  });

  await check("the rollback refuses once an invoice was issued", () => {
    const now = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /invoices were already issued/);
    assert.equal(fingerprint(), now);
    assert.match(
      preflight()[0][1],
      /^customer invoices: already applied; invoices issued: [0-9]+ \(unpaid: [0-9]+\); payment attempts: [0-9]+$/
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the invoice commands", () => {
      assert.ok(count("private.customer_invoices") > 0);
      for (const sig of API)
        assert.equal(q(`select has_function_privilege('authenticated','${sig}','execute');`), "t");
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Customer invoice checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
