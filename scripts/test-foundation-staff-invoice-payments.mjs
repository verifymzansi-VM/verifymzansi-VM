#!/usr/bin/env node
// Behaviour checks for 20261113133605_staff_invoice_payments.sql: staff record
// a cleared bank transfer (EFT), a second staff member confirms it, and only
// then it becomes an ordinary payment with the method 'invoice' (roadmap P2b,
// first slice).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff act with a verified authenticator app and an AAL2 session;
// members buy with the production checkout command and the website server's
// settlement (as `service_role`, with synthetic Ozow ids) for the comparison
// with an Ozow payment. The only stand-in is
// internal.current_verified_identity, which answers with the member's current
// accepted identity fact (identity review has its own suites). The script
// checks the read-only preflight and the update's refusals, applies the
// update, proves apply -> rollback -> apply returns the schema fingerprint to
// the same values, then checks: a recorded transfer waits and starts nothing;
// its recorder (or another account of the recorder's identity) cannot confirm
// it; a second staff member's confirmation gives the same slots, invoice,
// receipt event and partner commission as an Ozow payment of the same order;
// repeats of the record, the confirmation and the decline return the first
// result; a declined record cannot be confirmed (nor a confirmed one declined)
// and its bank reference stays used; a bank reference is used once (whatever
// its case, spaces or punctuation, also by two staff members at once); every
// refusal records nothing; the slot limit is checked again at confirmation;
// staff never handle a customer they referred; the staff refund commands work
// on the payment; the records keep their rules; the audit trail, the reads and
// the receipt; the grants; and that the rollback refuses once a transfer was
// recorded.
//
//   node --import tsx scripts/test-foundation-staff-invoice-payments.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Members,
// staff, identity facts and partners are written directly as the database
// owner. Nothing contacts Ozow or a bank.
import assert from "node:assert/strict";
import { assertReadOnlyPreflight, createChecks } from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";
import {
  P180,
  P30,
  applyAndProveRollback,
  createPaymentWorld,
  fingerprintOf,
  psqlSessions,
  sha,
  updateCheckKit,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261113133605_staff_invoice_payments.sql";
const RECORD =
  "api.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)";

const { check, current, passed: checks } = createChecks();

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  // The replay before this update, its companions and the synthetic world.
  const kit = updateCheckKit(database, UPDATE, current);
  const world = createPaymentWorld(kit);
  const { q, json, fails, member, staff, service, asRole, fingerprint, preflight, count } = kit;
  const { steps, index, step, preflightSql: PREFLIGHT, rollbackSql: ROLLBACK } = kit;
  const { user, staffUser } = world;
  const admin = staffUser("eft-admin", "admin");
  const admin2 = staffUser("eft-admin2", "admin");
  const unreviewedAdmin = staffUser("eft-admin3", "admin");
  const moderator = staffUser("eft-moderator", "moderator");
  const verified = (label) => world.verified(label, admin);
  world.review(admin, admin2, "eft-admin");
  world.review(admin2, admin, "eft-admin2");
  const today = q("select to_char((now() at time zone 'Africa/Johannesburg')::date,'YYYY-MM-DD');");
  const daysAgo = (n) =>
    q(`select to_char((now() at time zone 'Africa/Johannesburg')::date - ${n},'YYYY-MM-DD');`);
  // A separate psql session, for the concurrency checks.
  const { session, sessionAfter } = psqlSessions(database);

  /** An Ozow purchase through checkout and the settlement notice. */
  const buy = (owner, plan, slots) => {
    const quoted = json(
      member(
        owner,
        `select api.start_slot_checkout('${plan.id}',${slots},${plan.cents * slots},true);`
      )
    );
    const lease = json(
      service(`select api.claim_checkout_request('${quoted.payment_id}','${owner.id}');`)
    );
    q(
      service(
        `select api.complete_checkout_request('${quoted.payment_id}','${owner.id}','${lease.claim_token}','req-${quoted.payment_id}','https://one.ozow.com/checkout/req-${quoted.payment_id}');`
      )
    );
    const ref = q(
      `select merchant_reference from private.payments where id='${quoted.payment_id}';`
    );
    const event = {
      payload_sha256: sha(`event-${quoted.payment_id}`),
      merchant_reference: ref,
      provider_request_id: `req-${quoted.payment_id}`,
      provider_transaction_id: `tx-${quoted.payment_id}`,
      status: "complete",
      amount_cents: plan.cents * slots,
      currency: "ZAR",
    };
    assert.equal(
      json(service(`select api.apply_provider_event($e$${JSON.stringify(event)}$e$::jsonb);`))
        .outcome,
      "completed"
    );
    return quoted.payment_id;
  };
  const literal = (value) =>
    value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
  /** The record command's SQL, with every argument overridable. */
  const recordSql = (who, input) => {
    const a = {
      email: null,
      term: 180,
      slots: 1,
      amount: null,
      reference: null,
      cleared: today,
      waiver: true,
      reason: "EFT cleared; customer agreed in writing",
      ...input,
    };
    const amount = a.amount ?? (a.term === 30 ? 6900 : a.term === 90 ? 20700 : 41400) * a.slots;
    return staff(
      who,
      `select api.record_staff_invoice_payment(${literal(a.email)},${a.term === null ? "null" : a.term},${a.slots === null ? "null" : a.slots},${amount},${literal(a.reference)},${literal(a.cleared)},${a.waiver === null ? "null" : a.waiver},${literal(a.reason)});`
    );
  };
  const record = (who, input) => json(recordSql(who, input));
  const confirmSql = (who, id) => staff(who, `select api.confirm_staff_invoice_payment('${id}');`);
  const confirm = (who, id) => json(confirmSql(who, id));
  const declineSql = (who, id, reason = "The bank shows no such transfer") =>
    staff(who, `select api.decline_staff_invoice_payment('${id}',${literal(reason)});`);
  /** Recorded by `who`, confirmed by the other admin; returns the payment id. */
  const recordAndConfirm = (who, input) => {
    const recorded = record(who, input);
    return confirm(who === admin ? admin2 : admin, recorded.transfer_id).payment_id;
  };
  const transfer = (id) =>
    json(`select jsonb_build_object('status',status,'payment',payment_id,'confirmed_by',confirmed_by,
      'declined_by',declined_by) from private.invoice_transfers where id='${id}';`);
  const payment = (id) =>
    json(`select jsonb_build_object('status',status,'fulfillment',fulfillment_status,'provider',provider,
      'tx',provider_transaction_id,'request',provider_request_id,'amount',amount_cents,'owner',owner_id)
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
        where c.payment_id='${id}'));`);
  const records = () => count("private.invoice_transfers");
  const invoicePayments = (owner) =>
    count(`private.payments where owner_id='${owner.id}' and provider='invoice'`);

  // ------------------------------------------------------------ before
  await check("before the update: preflight reads 'not applied', the commands are absent", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^staff invoice payments: update not applied \(apply before the website release that uses it is deployed\); bank transfers waiting for confirmation: none \(table absent\); payments confirmed from a bank transfer: 0$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
    fails(recordSql(admin, { email: "x@example.invalid", reference: "REF-0001" }), "42883");
  });

  await check("the update refuses without the reviewed bodies and with a drifted table", () => {
    const before = fingerprint();
    const original = q(
      "select pg_get_functiondef('internal.individual_slot_limit(text)'::regprocedure);"
    );
    q(`create or replace function internal.individual_slot_limit(p_identity text) returns integer
      language sql stable set search_path to 'pg_catalog' as $fn$ select 100 $fn$;`);
    assert.match(fails(step.sql, "55000"), /apply 20261113021223_staff_payment_fixes\.sql first/);
    assert.match(
      preflight()
        .map((r) => r[1])
        .join("\n"),
      /internal\.individual_slot_limit\(text\) is not the reviewed body/
    );
    q(original);
    q("create table private.invoice_transfers(id uuid primary key);");
    assert.match(fails(step.sql, "55000"), /table drift: private\.invoice_transfers id/);
    q("drop table private.invoice_transfers;");
    q(`alter table private.payments drop constraint payments_provider_check;
       alter table private.payments add constraint payments_provider_check check (provider in ('ozow','card'));`);
    assert.match(fails(step.sql, "55000"), /payments constraints differ/);
    q(`alter table private.payments drop constraint payments_provider_check;
       alter table private.payments add constraint payments_provider_check check (provider = 'ozow');`);
    q(`insert into private.staff_capabilities(role,capability,requires_recent_mfa)
       values('moderator','payments:confirm_transfer',false);`);
    assert.match(fails(step.sql, "55000"), /confirm_transfer is granted differently/);
    q(
      "delete from private.staff_capabilities where role='moderator' and capability='payments:confirm_transfer';"
    );
    assert.equal(fingerprint(), before);
  });

  // An Ozow payment from before the update keeps meeting the payment rules.
  const early = verified("early");
  const earlyPayment = buy(early, P30, 1);

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "staff invoice payments",
    applied:
      /^staff invoice payments: already applied; bank transfers waiting for confirmation: 0; payments confirmed from a bank transfer: 0$/,
    notApplied: /^staff invoice payments: update not applied/,
  });
  await check("an earlier Ozow payment keeps its method; the new capability is admin only", () => {
    assert.equal(payment(earlyPayment).provider, "ozow");
    assert.equal(
      q(
        "select string_agg(role||':'||requires_recent_mfa,',') from private.staff_capabilities where capability='payments:confirm_transfer';"
      ),
      "admin:true"
    );
  });

  // A partner who referred two customers: one pays by Ozow, one by bank transfer.
  const partner = user("eft-partner");
  q(`select set_config('session_replication_role','replica',false);
    insert into private.partners(account_id,code,status,commission_bps,created_by)
      values('${partner.id}','EFTPART1','active',2000,'${admin.id}');
    select set_config('session_replication_role','origin',false);`);
  const referred = (label) => {
    const m = verified(label);
    q(`select set_config('session_replication_role','replica',false);
      insert into private.account_acquisitions(account_id,source,partner_id)
        values('${m.id}','partner',(select id from private.partners where account_id='${partner.id}'));
      select set_config('session_replication_role','origin',false);`);
    return m;
  };

  // ------------------------------------------------------- record, confirm
  const thandi = referred("thandi");
  const ozowBuyer = referred("ozow-buyer");
  let thandiTransfer;
  let thandiPayment;
  await check("a recorded transfer waits: nothing starts, nothing is sent", () => {
    const result = record(admin, {
      email: thandi.email,
      term: 180,
      slots: 2,
      reference: "FNB 2026-11 A1",
    });
    thandiTransfer = result.transfer_id;
    assert.deepEqual(
      [
        result.status,
        result.slots,
        result.term_days,
        result.amount_received_cents,
        result.payment_id,
        result.recorded_by_me,
        result.repeated,
        result.customer_name,
      ],
      ["awaiting_confirmation", 2, 180, 82800, null, true, false, "Fixture t."]
    );
    assert.equal(invoicePayments(thandi), 0);
    assert.equal(json(member(thandi, "select api.get_my_slots();")).individual.held, 0);
    assert.equal(count(`private.partner_commissions where referred_account_id='${thandi.id}'`), 0);
    assert.equal(count("private.outbox_events where kind='payment_completed'"), 1); // the early Ozow payment only
    const waiting = json(staff(admin2, "select api.get_staff_invoice_transfers();"));
    assert.equal(waiting.waiting, 1);
    assert.deepEqual(
      [
        waiting.items[0].transfer_id,
        waiting.items[0].recorded_by_me,
        waiting.items[0].bank_reference,
      ],
      [thandiTransfer, false, "FNB 2026-11 A1"]
    );
    assert.equal(
      json(staff(admin, "select api.get_staff_invoice_transfers();")).items[0].recorded_by_me,
      true
    );
    assert.match(
      preflight()[0][1],
      /bank transfers waiting for confirmation: 1; payments confirmed from a bank transfer: 0$/
    );
  });

  await check("the recorder cannot confirm their own record, nor can their other account", () => {
    fails(confirmSql(admin, thandiTransfer), "42501", /different staff member must confirm/);
    const twin = staffUser("eft-admin-twin", "admin");
    world.review(twin, admin2, "eft-admin-twin");
    world.pastIdentity(twin, admin2, fingerprintOf("eft-admin"));
    fails(confirmSql(twin, thandiTransfer), "42501", /different staff member must confirm/);
    // Without the capability, or as the customer: refused.
    fails(confirmSql(moderator, thandiTransfer), "42501", /capability not granted/);
    fails(
      member(thandi, `select api.confirm_staff_invoice_payment('${thandiTransfer}');`),
      "42501"
    );
    fails(confirmSql(unreviewedAdmin, thandiTransfer), "42501", /accepted ID review of their own/);
    assert.equal(transfer(thandiTransfer).status, "awaiting_confirmation");
    assert.equal(invoicePayments(thandi), 0);
  });

  await check(
    "a second staff member's confirmation delivers exactly what an Ozow payment does",
    () => {
      const result = confirm(admin2, thandiTransfer);
      thandiPayment = result.payment_id;
      assert.deepEqual(
        [result.status, result.slots_started, result.commissions, result.repeated],
        ["confirmed", 2, 2, false]
      );
      assert.deepEqual(payment(thandiPayment), {
        status: "complete",
        fulfillment: "fulfilled",
        provider: "invoice",
        tx: null,
        request: null,
        amount: 82800,
        owner: thandi.id,
      });
      const ozowPayment = buy(ozowBuyer, P180, 2);
      const viaBank = delivered(thandiPayment);
      assert.deepEqual(viaBank, delivered(ozowPayment));
      assert.deepEqual(viaBank.commissions, [
        [41400, 2000, 8280, "pending", true],
        [41400, 2000, 8280, "pending", true],
      ]);
      assert.equal(viaBank.receipt_event, 1);
      assert.equal(json(member(thandi, "select api.get_my_slots();")).individual.held, 2);
      assert.deepEqual(transfer(thandiTransfer), {
        status: "confirmed",
        payment: thandiPayment,
        confirmed_by: admin2.id,
        declined_by: null,
      });
      // The audit trail: recorded by one, confirmed by the other.
      assert.deepEqual(
        json(`select jsonb_agg(action||'|'||actor_id order by action) from private.frontend_staff_audit_events
          where target_id='${thandiPayment}' and action like 'payment:invoice%';`),
        [`payment:invoice_confirmed|${admin2.id}`, `payment:invoice_recorded|${admin.id}`]
      );
      // The staff list shows an ordinary delivered payment; nothing waits.
      const listed = json(staff(admin, "select api.get_staff_payment_list(1);")).items.find(
        (i) => i.id === thandiPayment
      );
      assert.deepEqual(
        [listed.status, listed.fulfillment_status, listed.lines.length],
        ["complete", "fulfilled", 2]
      );
      assert.equal(json(staff(admin, "select api.get_staff_invoice_transfers();")).waiting, 0);
    }
  );

  await check("repeats return the first result; a reference is used once", () => {
    // Confirming again by the confirmer: the same payment, nothing new.
    const again = confirm(admin2, thandiTransfer);
    assert.deepEqual(
      [again.payment_id, again.repeated, again.commissions],
      [thandiPayment, true, 2]
    );
    // Recording the same transfer again (also written differently): the same record.
    for (const reference of ["FNB 2026-11 A1", "fnb/2026.11-a1"]) {
      const repeat = record(admin, { email: thandi.email, term: 180, slots: 2, reference });
      assert.deepEqual(
        [repeat.transfer_id, repeat.repeated, repeat.status, repeat.payment_id],
        [thandiTransfer, true, "confirmed", thandiPayment]
      );
    }
    const other = verified("other-customer");
    for (const [who, input] of [
      [admin2, { email: thandi.email, term: 180, slots: 2, reference: "FNB 2026-11 A1" }],
      [admin2, { email: thandi.email, term: 180, slots: 2, reference: "fnb202611a1" }],
      [admin, { email: thandi.email, term: 180, slots: 1, reference: "FNB 2026-11 A1" }],
      [admin, { email: thandi.email, term: 90, slots: 2, reference: "FNB 2026-11 A1" }],
      [admin, { email: other.email, term: 30, slots: 1, reference: "FNB 2026-11 A1" }],
      [
        admin,
        {
          email: thandi.email,
          term: 180,
          slots: 2,
          reference: "FNB 2026-11 A1",
          cleared: daysAgo(1),
        },
      ],
      [
        admin,
        {
          email: thandi.email,
          term: 180,
          slots: 2,
          reference: "FNB 2026-11 A1",
          reason: "A second transfer, same reference",
        },
      ],
    ])
      fails(recordSql(who, input), "PT409", /bank reference was already recorded \(confirmed\)/);
    assert.equal(records(), 1);
    assert.equal(invoicePayments(thandi), 1);
    // A confirmed record cannot be declined.
    fails(declineSql(admin, thandiTransfer), "PT409", /already confirmed; it cannot be declined/);
  });

  await check("a declined record cannot be confirmed, and its reference stays used", () => {
    const sizwe = verified("sizwe");
    const recorded = record(admin, {
      email: sizwe.email,
      term: 30,
      slots: 1,
      reference: "WRONG-0001",
    });
    fails(declineSql(admin2, recorded.transfer_id, "no"), "22023", /decline reason/);
    const declined = json(declineSql(admin2, recorded.transfer_id));
    assert.deepEqual([declined.status, declined.repeated], ["declined", false]);
    // Declining again with the same reason by the same person: the same result.
    assert.equal(json(declineSql(admin2, recorded.transfer_id)).repeated, true);
    fails(declineSql(admin, recorded.transfer_id), "PT409", /already declined/);
    fails(
      confirmSql(admin2, recorded.transfer_id),
      "PT409",
      /already declined; it cannot be confirmed/
    );
    assert.equal(invoicePayments(sizwe), 0);
    // The reference cannot be recorded again, by anyone, for anything.
    fails(
      recordSql(admin2, { email: sizwe.email, term: 30, slots: 1, reference: "wrong 0001" }),
      "PT409",
      /already recorded \(declined\)/
    );
    const repeat = record(admin, {
      email: sizwe.email,
      term: 30,
      slots: 1,
      reference: "WRONG-0001",
    });
    assert.deepEqual([repeat.status, repeat.repeated], ["declined", true]);
    // The recorder may withdraw a record of their own (it is declined).
    const withdrawn = record(admin, {
      email: sizwe.email,
      term: 30,
      slots: 1,
      reference: "WITHDRAW-001",
    });
    assert.equal(
      json(declineSql(admin, withdrawn.transfer_id, "Recorded by mistake")).status,
      "declined"
    );
    assert.equal(
      count(
        `private.frontend_staff_audit_events where target_id='${recorded.transfer_id}' and action='payment:invoice_declined' and actor_id='${admin2.id}'`
      ),
      1
    );
  });

  await check(
    "the staff read gives the transfer details; the receipt read the bank reference",
    () => {
      const read = (who, ids) =>
        json(
          staff(
            who,
            `select api.get_staff_invoice_payments(array[${ids.map((id) => `'${id}'`).join(",")}]::uuid[]);`
          )
        );
      const mine = read(admin, [thandiPayment, earlyPayment]);
      assert.equal(mine.items.length, 1);
      assert.deepEqual(
        [
          mine.items[0].payment_id,
          mine.items[0].bank_reference,
          mine.items[0].cleared_on,
          mine.items[0].amount_received_cents,
          mine.items[0].recorded_by_me,
          mine.items[0].confirmed_by_me,
        ],
        [thandiPayment, "FNB 2026-11 A1", today, 82800, true, false]
      );
      assert.equal(read(admin2, [thandiPayment]).items[0].confirmed_by_me, true);
      assert.deepEqual(read(admin, []).items, []);
      fails(staff(moderator, `select api.get_staff_invoice_payments(array[]::uuid[]);`), "42501");
      fails(member(thandi, `select api.get_staff_invoice_payments(array[]::uuid[]);`), "42501");
      fails(staff(moderator, "select api.get_staff_invoice_transfers();"), "42501");
      fails(
        staff(
          admin,
          `select api.get_staff_invoice_payments(array_fill(gen_random_uuid(),array[51]));`
        ),
        "22023"
      );
      fails(staff(admin, `select api.get_staff_invoice_payments(array[null]::uuid[]);`), "22023");
      const receipt = json(service(`select api.get_payment_receipt('${thandiPayment}');`));
      assert.deepEqual(
        [receipt.payment_method, receipt.bank_reference, receipt.slots, receipt.amount_cents],
        ["invoice", "FNB 2026-11 A1", 2, 82800]
      );
      assert.ok(receipt.invoice_number);
      const ozowReceipt = json(service(`select api.get_payment_receipt('${earlyPayment}');`));
      assert.deepEqual([ozowReceipt.payment_method, ozowReceipt.bank_reference], ["ozow", null]);
    }
  );

  await check("every refusal records nothing", () => {
    const zola = verified("zola");
    const unverified = user("unverified");
    const ok = { email: zola.email, term: 30, slots: 1 };
    const before = records();
    const refusals = [
      [
        member(
          zola,
          `select ${RECORD.replace(/\(.*$/, "")}('${zola.email}',30,1,6900,'REF-MEMBER','${today}',true,'Recording my own');`
        ),
        "42501",
        /second factor required/,
      ],
      [recordSql(moderator, { ...ok, reference: "REF-MOD-1" }), "42501", /capability not granted/],
      [
        recordSql(unreviewedAdmin, { ...ok, reference: "REF-UNREV-1" }),
        "42501",
        /accepted ID review of their own/,
      ],
      [
        recordSql(admin, { ...ok, email: admin.email, reference: "REF-SELF-1" }),
        "42501",
        /different staff member/,
      ],
      [
        recordSql(admin, { ...ok, amount: 6800, reference: "REF-AMOUNT-1" }),
        "PT428",
        /not the order total of 6900 cents/,
      ],
      [
        recordSql(admin, { ...ok, amount: 5000001, reference: "REF-BIG-1" }),
        "PT413",
        /above R50,000/,
      ],
      [
        recordSql(admin, { ...ok, email: "nobody@example.invalid", reference: "REF-NONE-1" }),
        "PT404",
        /no confirmed account/,
      ],
      [
        recordSql(admin, { ...ok, email: unverified.email, reference: "REF-UNVER-1" }),
        "PT412",
        /ID review must be accepted/,
      ],
      [
        recordSql(admin, { ...ok, waiver: false, reference: "REF-WAIVE-1" }),
        "22023",
        /cooling-off waiver/,
      ],
      [
        recordSql(admin, { ...ok, waiver: null, reference: "REF-WAIVE-2" }),
        "22023",
        /cooling-off waiver/,
      ],
      [recordSql(admin, { ...ok, reference: null }), "22023", /bank reference required/],
      [recordSql(admin, { ...ok, reference: "  " }), "22023", /bank reference required/],
      [recordSql(admin, { ...ok, reference: "A-1" }), "22023", /4 to 60 letters/],
      [recordSql(admin, { ...ok, reference: "R--1--2" }), "22023", /4 to 60 letters/],
      [recordSql(admin, { ...ok, reference: "REF;DROP" }), "22023", /4 to 60 letters/],
      [recordSql(admin, { ...ok, reference: "X".repeat(61) }), "22023", /4 to 60 letters/],
      [
        recordSql(admin, { ...ok, reference: "REF-DATE-1", cleared: daysAgo(-1) }),
        "22023",
        /last 90 days/,
      ],
      [
        recordSql(admin, { ...ok, reference: "REF-DATE-2", cleared: daysAgo(91) }),
        "22023",
        /last 90 days/,
      ],
      [
        recordSql(admin, { ...ok, reference: "REF-DATE-3", cleared: "2026-02-30" }),
        "22023",
        /date the money cleared/,
      ],
      [
        recordSql(admin, { ...ok, reference: "REF-DATE-4", cleared: "13/11/2026" }),
        "22023",
        /date the money cleared/,
      ],
      [
        recordSql(admin, { ...ok, reference: "REF-TERM-1", term: 60, amount: 13800 }),
        "22023",
        /slot term/,
      ],
      [
        recordSql(admin, { ...ok, reference: "REF-SLOTS-1", slots: 26 }),
        "22023",
        /number of slots/,
      ],
      [
        recordSql(admin, { ...ok, reference: "REF-SLOTS-2", slots: 0, amount: 6900 }),
        "22023",
        /number of slots/,
      ],
      [
        recordSql(admin, { ...ok, reference: "REF-REASON-1", reason: "no" }),
        "22023",
        /audit reason/,
      ],
    ];
    for (const [sql, state, message] of refusals) fails(sql, state, message);
    assert.equal(records(), before);
    // Money cleared 90 days ago is still accepted.
    const ninety = record(admin, { ...ok, reference: "REF-DATE-OK", cleared: daysAgo(90) });
    assert.equal(ninety.status, "awaiting_confirmation");
    assert.equal(records(), before + 1);
    fails(confirmSql(admin2, "00000000-0000-4000-8000-000000000000"), "22023", /not found/);
  });

  await check("the slot limit is checked when recording and again when confirming", () => {
    const sipho = verified("sipho");
    buy(sipho, P30, 2);
    fails(
      recordSql(admin, { email: sipho.email, term: 30, slots: 3, reference: "SIPHO-0001" }),
      "PT429",
      /raise the limit first/
    );
    const waiting = record(admin, {
      email: sipho.email,
      term: 30,
      slots: 2,
      reference: "SIPHO-0002",
    });
    // Meanwhile the person opens an Ozow checkout for one more: confirming
    // would push that payment over the limit, so it is refused.
    json(member(sipho, `select api.start_slot_checkout('${P30.id}',1,${P30.cents},true);`));
    fails(confirmSql(admin2, waiting.transfer_id), "PT429", /raise the limit or decline/);
    assert.equal(transfer(waiting.transfer_id).status, "awaiting_confirmation");
    assert.equal(invoicePayments(sipho), 0);
    // The staff member cannot record for another account of their own identity.
    const mirror = user("admin-second-account");
    world.pastIdentity(mirror, admin2, fingerprintOf("eft-admin"));
    fails(
      recordSql(admin, { email: mirror.email, term: 30, slots: 1, reference: "MIRROR-0001" }),
      "42501",
      /different staff member/
    );
  });

  await check("staff never record or confirm a payment that earns them commission", () => {
    // The first admin is also an active partner who referred this customer.
    const referredByStaff = verified("referred-by-staff");
    q(`select set_config('session_replication_role','replica',false);
      insert into private.partners(account_id,code,status,commission_bps,created_by)
        values('${admin.id}','STAFFP01','active',2000,'${admin2.id}');
      insert into private.account_acquisitions(account_id,source,partner_id)
        values('${referredByStaff.id}','partner',(select id from private.partners where account_id='${admin.id}'));
      select set_config('session_replication_role','origin',false);`);
    const input = { email: referredByStaff.email, term: 30, slots: 1, reference: "REFERRED-001" };
    fails(recordSql(admin, input), "42501", /customer you referred/);
    fails(
      staff(admin, `select api.get_staff_invoice_customer('${referredByStaff.email}');`),
      "42501",
      /customer you referred/
    );
    // Recorded by the other admin, the referring admin cannot confirm it either.
    const recorded = record(admin2, input);
    fails(confirmSql(admin, recorded.transfer_id), "42501", /customer you referred/);
    assert.equal(invoicePayments(referredByStaff), 0);
  });

  await check(
    "confirmation rechecks the recorder and flags a possible duplicate under another reference",
    () => {
      const nomsa = verified("nomsa");
      // A recorder who lost the staff role since recording.
      const former = staffUser("eft-admin-former", "admin");
      world.review(former, admin2, "eft-admin-former");
      const byFormer = record(former, {
        email: nomsa.email,
        term: 30,
        slots: 1,
        reference: "FORMER-0001",
      });
      q(`set session_replication_role=replica;
        update private.staff_roles set revoked_at=now(),revoked_by='${admin.id}' where user_id='${former.id}';
        set session_replication_role=origin;`);
      fails(confirmSql(admin2, byFormer.transfer_id), "PT409", /can no longer record payments/);
      // A recorder who became the customer's referring partner since recording.
      const thabo = verified("thabo-later");
      const byAdmin2 = record(admin2, {
        email: thabo.email,
        term: 30,
        slots: 1,
        reference: "LATEREF-001",
      });
      q(`select set_config('session_replication_role','replica',false);
        insert into private.partners(account_id,code,status,commission_bps,created_by)
          values('${admin2.id}','STAFFP02','active',2000,'${admin.id}');
        insert into private.account_acquisitions(account_id,source,partner_id)
          values('${thabo.id}','partner',(select id from private.partners where account_id='${admin2.id}'));
        select set_config('session_replication_role','origin',false);`);
      fails(
        confirmSql(admin, byAdmin2.transfer_id),
        "42501",
        /recorded this bank transfer referred/
      );
      assert.equal(invoicePayments(nomsa) + invoicePayments(thabo), 0);
      // The same customer, amount and date under another reference is flagged.
      const second = record(admin, {
        email: nomsa.email,
        term: 30,
        slots: 1,
        reference: "DUP-B-0001",
      });
      const item = json(staff(admin2, "select api.get_staff_invoice_transfers();")).items.find(
        (i) => i.transfer_id === second.transfer_id
      );
      assert.deepEqual([item.similar_records, item.customer_email], [1, nomsa.email]);
    }
  );

  await check("staff see whose account an email names before recording", () => {
    const preview = (who, email) =>
      json(staff(who, `select api.get_staff_invoice_customer(${literal(email)});`));
    assert.deepEqual(preview(admin, thandi.email.toUpperCase()), {
      customer_name: "Fixture t.",
      id_reviewed: true,
      can_use_slots: true,
      slots_held: 2,
      slot_limit: 4,
    });
    const unreviewed = user("preview-unreviewed");
    assert.deepEqual(preview(admin, unreviewed.email), {
      customer_name: "Fixture p.",
      id_reviewed: false,
      can_use_slots: true,
      slots_held: null,
      slot_limit: null,
    });
    fails(
      staff(admin, `select api.get_staff_invoice_customer('nobody@example.invalid');`),
      "PT404"
    );
    fails(staff(admin, `select api.get_staff_invoice_customer('${admin.email}');`), "42501");
    fails(staff(moderator, `select api.get_staff_invoice_customer('${thandi.email}');`), "42501");
    fails(member(thandi, `select api.get_staff_invoice_customer('${thandi.email}');`), "42501");
    fails(staff(admin, "select api.get_staff_invoice_customer(null);"), "22023");
  });

  await check(
    "races: one record per reference; confirm and decline at once give one outcome",
    async () => {
      const lebo = verified("lebo");
      const first = session(
        `begin;\n${recordSql(admin, { email: lebo.email, term: 30, slots: 1, reference: "RACE-0001" })}\nselect pg_sleep(1.5);\ncommit;`
      );
      const second = sessionAfter(
        400,
        recordSql(admin2, { email: lebo.email, term: 30, slots: 1, reference: "race 0001" })
      );
      const [a, b] = await Promise.all([first, second]);
      assert.equal(a.status, 0, a.stderr);
      assert.notEqual(b.status, 0);
      assert.match(b.stderr, /PT409:.*bank reference was already recorded/);
      assert.equal(count(`private.invoice_transfers where account_id='${lebo.id}'`), 1);
      const id = q(`select id from private.invoice_transfers where account_id='${lebo.id}';`);
      // The confirmation holds the record while a decline waits: the decline is refused.
      const confirming = session(
        `begin;\n${confirmSql(admin2, id)}\nselect pg_sleep(1.5);\ncommit;`
      );
      const declining = sessionAfter(400, declineSql(admin2, id, "Declined while confirming"));
      const [c, d] = await Promise.all([confirming, declining]);
      assert.equal(c.status, 0, c.stderr);
      assert.notEqual(d.status, 0);
      assert.match(d.stderr, /PT409:.*already confirmed/);
      assert.equal(invoicePayments(lebo), 1);
    }
  );

  // ------------------------------------------------------------- refunds
  await check("the staff refund commands work on a confirmed bank transfer payment", () => {
    const refund = (paymentId, ref) =>
      json(
        staff(
          admin,
          `select api.record_staff_payment_refund('${paymentId}','refunded','billing_error','Refunded by EFT to the payer','${ref}');`
        )
      );
    // One slot of two: that slot and its commission only.
    const line = q(
      `select id from private.payment_lines where payment_id='${thandiPayment}' and line_number=2;`
    );
    const slot = json(
      staff(
        admin,
        `select api.record_staff_slot_refund('${line}','refunded','s14_cancellation','Cancelled within 14 days','EFT-OUT-0001');`
      )
    );
    assert.equal(slot.status, "applied");
    assert.deepEqual(
      json(`select jsonb_agg(jsonb_build_array(l.status,c.status) order by l.line_number)
        from private.payment_lines l join private.partner_commissions c on c.payment_line_id=l.id
        where l.payment_id='${thandiPayment}';`),
      [
        ["open", "pending"],
        ["reversed", "reversed"],
      ]
    );
    // A whole small order: applied at once, slots and commission withdrawn.
    const small = referred("small");
    const smallPayment = recordAndConfirm(admin, {
      email: small.email,
      term: 30,
      slots: 1,
      reference: "SMALL-0001",
    });
    assert.equal(refund(smallPayment, "EFT-OUT-0003").status, "applied");
    assert.equal(payment(smallPayment).status, "refunded");
    assert.equal(
      q(
        `select string_agg(status,',') from private.partner_commissions where payment_id='${smallPayment}';`
      ),
      "reversed"
    );
    fails(
      recordSql(admin2, { email: small.email, term: 30, slots: 1, reference: "SMALL-0001" }),
      "PT409"
    );
    // Above R1,000: the refund waits for a second staff member.
    const big = verified("big");
    const bigPayment = recordAndConfirm(admin2, {
      email: big.email,
      term: 180,
      slots: 3,
      reference: "BIG-ORDER-0001",
    });
    const waiting = refund(bigPayment, "EFT-OUT-0004");
    assert.equal(waiting.status, "awaiting_approval");
    assert.equal(
      json(staff(admin2, `select api.approve_staff_payment_refund('${waiting.request_id}');`))
        .status,
      "applied"
    );
    assert.equal(payment(bigPayment).status, "refunded");
  });

  await check("records and invoice payments keep their rules", () => {
    for (const sql of [
      `update private.invoice_transfers set reason='Changed later on' where id='${thandiTransfer}';`,
      `update private.invoice_transfers set status='declined',declined_by='${admin.id}',declined_at=now(),decline_reason='Changed my mind' where id='${thandiTransfer}';`,
      `delete from private.invoice_transfers where id='${thandiTransfer}';`,
    ])
      fails(sql, "23514");
    // A record starts waiting, and a confirmation names its own invoice payment.
    fails(
      `insert into private.invoice_transfers(account_id,plan_version_id,slots,amount_received_cents,bank_reference,cleared_on,
        cooling_off_waiver_confirmed,reason,recorded_by,status,confirmed_by,confirmed_at,payment_id)
       values('${early.id}','${P30.id}',1,6900,'FAKE-0001',current_date,true,'Fake record here','${admin.id}','confirmed',
         '${admin2.id}',now(),'${earlyPayment}');`,
      "23514",
      /recorded as waiting/
    );
    const waiting = q(
      "select id from private.invoice_transfers where status='awaiting_confirmation' order by recorded_at limit 1;"
    );
    fails(
      `update private.invoice_transfers set status='confirmed',confirmed_by='${moderator.id}',confirmed_at=now(),
         payment_id='${earlyPayment}' where id='${waiting}';`,
      "23514",
      /names its invoice payment/
    );
    // An invoice payment never carries Ozow's fields, and Ozow payments keep theirs.
    fails(
      `update private.payments set provider_transaction_id='tx-fake' where id='${thandiPayment}';`,
      "23514"
    );
    fails(
      `insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,provider,status,
        fulfillment_status,completed_at) values('${early.id}','plan','${P30.id}',6900,'ZAR','{}','ozow','complete','fulfilled',now());`,
      "23514"
    );
    fails(
      `insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,provider,status)
        values('${early.id}','plan','${P30.id}',6900,'ZAR','{}','card','pending');`,
      "23514"
    );
  });

  await check("grants: staff commands for authenticated, the table closed", () => {
    const grants = json(
      "select jsonb_object_agg(r.rolname||' '||f.sig,has_function_privilege(r.rolname,f.sig,'execute')) " +
        "from (values('anon'),('authenticated'),('service_role')) r(rolname), " +
        `(values('${RECORD}'),('api.confirm_staff_invoice_payment(uuid)'),('api.decline_staff_invoice_payment(uuid,text)'),` +
        "('api.get_staff_invoice_transfers()'),('api.get_staff_invoice_payments(uuid[])')," +
        "('api.get_staff_invoice_customer(text)'),('internal.assert_staff_not_referrer(uuid,uuid)')," +
        "('internal.lock_invoice_transfer_for_review(uuid,uuid)'),('internal.invoice_transfer_guard()')) f(sig);"
    );
    for (const [key, value] of Object.entries(grants)) {
      const [role, sig] = key.split(" ");
      assert.equal(value, role === "authenticated" && sig.startsWith("api."), key);
    }
    assert.equal(
      q(
        "select bool_or(has_table_privilege(r,'private.invoice_transfers','select,insert,update,delete')) from unnest(array['anon','authenticated','service_role']) r;"
      ),
      "f"
    );
    fails(
      asRole("anon", `select ${RECORD.replace(/\(.*$/, "")}(null,30,1,6900,null,null,true,null);`),
      "42501"
    );
    fails(
      asRole("service_role", `select api.confirm_staff_invoice_payment(gen_random_uuid());`),
      "42501"
    );
  });

  await check("the rollback refuses once a transfer was recorded", () => {
    const now = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /staff already recorded bank transfers/);
    assert.equal(fingerprint(), now);
    assert.match(
      preflight()[0][1],
      /^staff invoice payments: already applied; bank transfers waiting for confirmation: [0-9]+; payments confirmed from a bank transfer: [0-9]+$/
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the bank transfer commands", () => {
      assert.ok(records() > 0);
      assert.equal(q(`select has_function_privilege('authenticated','${RECORD}','execute');`), "t");
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Staff invoice payment checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
