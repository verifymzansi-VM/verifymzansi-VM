#!/usr/bin/env node
// Behaviour checks for 20261119025106_package_invoices.sql (roadmap P4e):
// Multi-listing package invoices and "Ask for an invoice". A member asks for an
// invoice for a package (5 to 250 slots, any amount, the price computed in SQL
// from the catalogue); staff issue it (above R50,000 a second staff member
// approves it first) or decline it; the invoice is paid with "Pay now" (up to
// the online payment limit) or by bank transfer (two staff members), and either
// way the payment opens the package exactly as a package bought online.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members act as `authenticated` with synthetic claims and a live session
// row; the website's server as `service_role`; staff with a verified
// authenticator app and an AAL2 session. The only stand-in is
// internal.current_verified_identity (the member's current accepted fact).
//
//   node --import tsx scripts/test-foundation-package-invoices.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  assertReadOnlyPreflight,
  createChecks,
  executeGrants,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  createPaymentWorld,
  fingerprintOf,
  P30,
  sqlValue,
  twoAdmins,
  updateCheckKit,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261119025106_package_invoices.sql";
/** The Multi-listing package terms (20261114154823_slot_packages.sql). */
const K30 = { id: "5b0f4c1e-2a7d-4c43-9b51-7e0d3f6a9c11", days: 30, cents: 10000 };
const K90 = { id: "8c3e1a52-6f0b-4d29-a7c4-2b9e5d1f7a33", days: 90, cents: 30000 };
const K180 = { id: "e1d7b6a4-0c95-4f8e-b3a2-6d4c8f2e1b55", days: 180, cents: 60000 };
const COMMANDS = [
  "api.request_package_invoice(uuid,integer,bigint,boolean,uuid)",
  "api.get_my_package_invoice_request()",
  "api.get_staff_package_invoice_requests()",
  "api.issue_staff_package_invoice(uuid,integer,text)",
  "api.approve_staff_package_invoice(uuid)",
  "api.decline_staff_package_invoice_request(uuid,text)",
];
const HELPERS = [
  "internal.package_invoice_request_guard()",
  "internal.package_invoice_approval_above_cents()",
  "internal.package_invoice_request_dto(private.package_invoice_requests,uuid)",
  "internal.package_invoice_issue_check(private.package_invoice_requests)",
  "internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text)",
  "internal.lock_package_invoice_request(uuid,uuid,text)",
];
const sha = (text) => createHash("sha256").update(text).digest("hex");

const started = Date.now();
const { check, current, passed: checks } = createChecks();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const kit = updateCheckKit(database, UPDATE, current);
  const { q, json, fails, count, member, staff, service, preflight } = kit;
  const world = createPaymentWorld(kit);
  const { admin, admin2 } = twoAdmins(world, "pkinv");
  const moderator = world.staffUser("pkinv-moderator", "moderator");
  world.review(moderator, admin, "pkinv-moderator");
  const verified = (label) => world.verified(label, admin);
  const today = q("select to_char((now() at time zone 'Africa/Johannesburg')::date,'YYYY-MM-DD');");
  const onSale = (value) =>
    q(
      `update private.slot_package_sales set on_sale=${value},changed_at=now(),reason='Fixture: switched for the checks';`
    );

  const askSql = (owner, plan, slots, { expected = plan.cents * slots, consent = true, id } = {}) =>
    member(
      owner,
      `select api.request_package_invoice('${plan.id}',${slots},${expected},${consent},'${id ?? randomUUID()}');`
    );
  const ask = (owner, plan, slots, options) => json(askSql(owner, plan, slots, options));
  const mine = (owner) =>
    json(member(owner, "select api.get_my_package_invoice_request();")).request;
  const queue = (who = admin) =>
    json(staff(who, "select api.get_staff_package_invoice_requests();"));
  const issueSql = (who, requestId, due = 7, reason = "Invoice asked for at checkout") =>
    staff(
      who,
      `select api.issue_staff_package_invoice('${requestId}',${due},${sqlValue(reason)});`
    );
  const approveSql = (who, requestId) =>
    staff(who, `select api.approve_staff_package_invoice('${requestId}');`);
  const declineSql = (who, requestId, reason = "Customer asked us to cancel it") =>
    staff(
      who,
      `select api.decline_staff_package_invoice_request('${requestId}',${sqlValue(reason)});`
    );
  const transferSql = (who, invoiceNumber, reference) =>
    staff(
      who,
      `select api.record_staff_invoice_transfer(${sqlValue(invoiceNumber)},${sqlValue(reference)},'${today}',true,'EFT cleared; customer agreed in writing');`
    );
  const confirmSql = (who, transferId) =>
    staff(who, `select api.confirm_staff_invoice_payment('${transferId}');`);
  const billing = (owner, invoiceNumber) => {
    const invoice = json(member(owner, `select api.get_my_invoice('${invoiceNumber}');`));
    json(
      member(
        owner,
        `select api.save_my_invoice_billing('${invoiceNumber}',${invoice.revision},'Fixture Motors (Pty) Ltd','1 Example Road\nEmpangeni\n3880',null);`
      )
    );
  };
  const payNowSql = (owner, invoice) =>
    member(
      owner,
      `select api.start_invoice_payment('${invoice.invoice_number}',${invoice.total_cents},true);`
    );
  /** Ozow's page opened and its settlement notice applied, as the server does. */
  const settle = (owner, paymentId) => {
    const lease = json(service(`select api.claim_checkout_request('${paymentId}','${owner.id}');`));
    q(
      service(
        `select api.complete_checkout_request('${paymentId}','${owner.id}','${lease.claim_token}','req-${paymentId}','https://one.ozow.com/checkout/req-${paymentId}');`
      )
    );
    const row = json(
      `select jsonb_build_object('ref',merchant_reference,'amount',amount_cents) from private.payments where id='${paymentId}';`
    );
    const event = {
      payload_sha256: sha(`event-${paymentId}`),
      merchant_reference: row.ref,
      provider_request_id: `req-${paymentId}`,
      provider_transaction_id: `tx-${paymentId}`,
      status: "complete",
      amount_cents: Number(row.amount),
      currency: "ZAR",
    };
    return json(service(`select api.apply_provider_event($e$${JSON.stringify(event)}$e$::jsonb);`));
  };
  /** The package grant of a payment: its one line and one grant. */
  const grantOf = (paymentId) =>
    json(`select jsonb_build_object('lines',(select count(*) from private.payment_lines where payment_id='${paymentId}'),
        'slot_count',l.slot_count,'amount',l.amount_cents,'capacity',e.slot_capacity,'activations',e.activations_per_period,
        'package',e.package_id,'days',extract(day from e.ends_at-e.starts_at)::integer,
        'package_slots',(select k.slot_count from private.slot_packages k where k.id=e.package_id))
      from private.payment_lines l left join private.entitlements e on e.payment_line_id=l.id
      where l.payment_id='${paymentId}' and l.line_number=1;`);
  const invoiceRow = (number) =>
    json(`select to_jsonb(i) from private.customer_invoices i where invoice_number='${number}';`);
  const numbersTaken = () =>
    Number(q("select coalesce(sum(last_number),0) from private.customer_invoice_numbers;"));

  // ------------------------------------------------------------ before
  await check(
    "before the update: the preflight reads 'not applied'; the commands are absent",
    () => {
      const rows = preflight();
      assert.deepEqual(
        rows.map((r) => r[0]),
        ["summary"],
        JSON.stringify(rows)
      );
      assert.equal(
        rows[0][1],
        "package invoices: update not applied (apply before the website release that uses it is deployed); on sale: no; invoice requests: none (table absent); package invoices: 0; package bank transfers: 0"
      );
      assertReadOnlyPreflight(database, kit.preflightSql);
      fails(askSql(verified("pkinv-early"), K30, 5), "42883");
    }
  );

  await check("the update and a premature rollback refuse drifted bodies, changing nothing", () =>
    assertDriftRefused(kit, {
      label: "package invoices",
      signatures: [
        "internal.start_invoice_payment(text,bigint,boolean)",
        "internal.record_staff_invoice_transfer(text,text,text,boolean,text)",
        "internal.confirm_staff_invoice_payment(uuid)",
        "internal.frontend_privacy_export_data(uuid)",
        "internal.customer_invoice_payment_guard()",
      ],
      rows: 2,
    })
  );

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: UPDATE,
    applied:
      /^package invoices: already applied; on sale: no; invoice requests: 0 \(open: 0\); package invoices: 0; package bank transfers: 0$/,
    notApplied: /^package invoices: update not applied/,
  });

  await check("grants: members and staff call the commands; nobody calls the helpers", () => {
    const grants = executeGrants(json, [...COMMANDS, ...HELPERS]);
    for (const command of COMMANDS)
      assert.deepEqual(
        grants[command],
        { anon: false, authenticated: true, service_role: false },
        command
      );
    for (const helper of HELPERS)
      assert.deepEqual(
        grants[helper],
        { anon: false, authenticated: false, service_role: false },
        helper
      );
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        q(
          `select has_table_privilege('${role}','private.package_invoice_requests','select,insert,update,delete');`
        ),
        "f"
      );
  });

  // ------------------------------------------------------- sales switch
  await check("with packages off sale nothing can be asked for, issued or paid", () => {
    const thandi = verified("pkinv-thandi");
    fails(askSql(thandi, K30, 5), "PT403", /packages_not_on_sale/);
    assert.equal(count("private.package_invoice_requests"), 0);
    assert.deepEqual(queue().items, []);
    assert.equal(mine(thandi), null);
  });

  onSale(true);

  // ------------------------------------------------- asking (the member)
  await check(
    "asking checks the term, the number of slots, the total, the box and the ID review",
    () => {
      const sipho = verified("pkinv-sipho");
      fails(askSql(sipho, K30, 4), "22023", /package_slots_invalid/);
      fails(askSql(sipho, K30, 251), "22023", /package_slots_invalid/);
      fails(askSql(sipho, P30, 5), "22023", /not on sale/);
      fails(askSql(sipho, K90, 50, { expected: 1499900 }), "PT428");
      fails(askSql(sipho, K90, 50, { consent: false }), "22023", /invoice_consent_required/);
      fails(askSql(world.user("pkinv-unreviewed"), K30, 5), "PT412");
      fails(kit.asRole("anon", `select api.get_my_package_invoice_request();`), "42501");
      assert.equal(count(`private.package_invoice_requests where account_id='${sipho.id}'`), 0);
    }
  );

  const lerato = verified("pkinv-lerato");
  let leratoRequest;
  await check(
    "a request records the order priced in SQL; repeats keep it; another order replaces it",
    () => {
      const id = randomUUID();
      const first = ask(lerato, K90, 50, { id });
      assert.equal(first.status, "requested");
      assert.equal(first.slots, 50);
      assert.equal(first.term_days, 90);
      assert.equal(first.unit_price_cents, 30000);
      assert.equal(first.total_cents, 1500000);
      assert.equal(first.invoice_number, null);
      assert.equal(first.repeated, false);
      assert.equal(first.customer_email, undefined, "a member's answer has no staff fields");
      // The same request again, and the same order under another id.
      assert.equal(ask(lerato, K90, 50, { id }).repeated, true);
      const same = ask(lerato, K90, 50);
      assert.equal(same.request_id, first.request_id);
      assert.equal(same.repeated, true);
      // The same id with another order is refused.
      fails(askSql(lerato, K90, 40, { id }), "PT409", /invoice_request_conflict/);
      // Another order replaces the waiting request.
      leratoRequest = ask(lerato, K90, 25);
      assert.notEqual(leratoRequest.request_id, first.request_id);
      assert.equal(
        q(`select status from private.package_invoice_requests where id='${first.request_id}';`),
        "withdrawn"
      );
      assert.equal(mine(lerato).request_id, leratoRequest.request_id);
      assert.equal(
        q(
          `select consent_version||' '||(consent_terms_version is not null) from private.package_invoice_requests where id='${leratoRequest.request_id}';`
        ),
        "invoice-cooling-off-v1 true"
      );
      // Another member sees nothing of it.
      assert.equal(mine(verified("pkinv-other")), null);
    }
  );

  await check("the staff queue lists open requests for payments:view only", () => {
    const listed = queue();
    const item = listed.items.find((i) => i.request_id === leratoRequest.request_id);
    assert.ok(item, JSON.stringify(listed));
    assert.equal(item.customer_email, lerato.email);
    assert.equal(item.identity_accepted, true);
    assert.equal(item.package_open, false);
    assert.equal(item.needs_approval, false);
    assert.equal(listed.approval_above_cents, 5000000);
    assert.ok(!listed.items.some((i) => i.status === "withdrawn"));
    fails(staff(moderator, "select api.get_staff_package_invoice_requests();"), "42501");
    fails(member(lerato, "select api.get_staff_package_invoice_requests();"), "42501");
  });

  let leratoInvoice;
  await check("staff issue a package invoice at the price asked for; repeats return it", () => {
    fails(issueSql(moderator, leratoRequest.request_id), "42501");
    fails(issueSql(admin, leratoRequest.request_id, 0), "22023", /invoice_issue_invalid/);
    fails(issueSql(admin, randomUUID()), "PT404", /package_invoice_request_unavailable/);
    const before = numbersTaken();
    const issued = json(issueSql(admin, leratoRequest.request_id));
    assert.equal(issued.status, "issued");
    assert.equal(issued.repeated, false);
    assert.equal(numbersTaken(), before + 1);
    leratoInvoice = issued.invoice;
    assert.match(leratoInvoice.invoice_number, /^VM-\d{4}-\d{6}$/);
    assert.equal(issued.invoice_number, leratoInvoice.invoice_number);
    assert.equal(leratoInvoice.slots, 25);
    assert.equal(leratoInvoice.term_days, 90);
    assert.equal(leratoInvoice.unit_price_cents, 30000);
    assert.equal(leratoInvoice.total_cents, 750000);
    assert.equal(leratoInvoice.description, "Multi-listing package: 25 slots × 90 days");
    assert.equal(leratoInvoice.status, "issued");
    const row = invoiceRow(leratoInvoice.invoice_number);
    assert.equal(row.account_id, lerato.id);
    assert.equal(row.issued_by, admin.id);
    assert.equal(row.request_id, leratoRequest.request_id);
    // A repeat returns the same invoice; another staff member is refused.
    const again = json(issueSql(admin, leratoRequest.request_id));
    assert.equal(again.repeated, true);
    assert.equal(again.invoice.invoice_number, leratoInvoice.invoice_number);
    fails(issueSql(admin2, leratoRequest.request_id), "PT409", /package_invoice_request_closed/);
    fails(declineSql(admin2, leratoRequest.request_id), "PT409", /package_invoice_request_closed/);
    // The member sees the invoice and the number on their request; the
    // member is told about it (the existing invoice notice).
    assert.equal(mine(lerato).invoice_number, leratoInvoice.invoice_number);
    const listed = json(member(lerato, "select api.get_my_invoices();")).items;
    assert.equal(listed[0].invoice_number, leratoInvoice.invoice_number);
    assert.equal(
      count(
        `private.notifications where account_id='${lerato.id}' and kind='invoice_issued' and subject_id='${row.id}'`
      ),
      1
    );
    // While it is unpaid, no other package invoice is asked for.
    fails(askSql(lerato, K30, 5), "PT409", /package_invoice_unpaid/);
  });

  await check("a package invoice above the online limit is paid by bank transfer only", () => {
    billing(lerato, leratoInvoice.invoice_number);
    fails(payNowSql(lerato, leratoInvoice), "PT413", /online_payment_above_limit/);
    assert.equal(count(`private.payments where owner_id='${lerato.id}'`), 0);
  });

  await check("a bank transfer confirmed by a second staff member opens the package", () => {
    const recorded = json(transferSql(admin, leratoInvoice.invoice_number, "FNB PKG 0001"));
    assert.equal(recorded.status, "awaiting_confirmation");
    assert.equal(recorded.slots, 25);
    assert.equal(recorded.amount_received_cents, 750000);
    assert.equal(count(`private.payments where owner_id='${lerato.id}'`), 0, "nothing paid yet");
    fails(confirmSql(admin, recorded.transfer_id), "42501", /transfer_confirmer_same/);
    const confirmed = json(confirmSql(admin2, recorded.transfer_id));
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.slots_started, 25);
    const grant = grantOf(confirmed.payment_id);
    assert.deepEqual(grant, {
      lines: 1,
      slot_count: 25,
      amount: 750000,
      capacity: 25,
      activations: 100,
      package: grant.package,
      days: 90,
      package_slots: 25,
    });
    assert.ok(grant.package);
    const pay = json(
      `select jsonb_build_object('status',status,'fulfilment',fulfillment_status,'provider',provider,'category',snapshot->>'category',
        'invoice',snapshot->>'customer_invoice_number') from private.payments where id='${confirmed.payment_id}';`
    );
    assert.deepEqual(pay, {
      status: "complete",
      fulfilment: "fulfilled",
      provider: "invoice",
      category: "slot_package",
      invoice: leratoInvoice.invoice_number,
    });
    assert.equal(invoiceRow(leratoInvoice.invoice_number).status, "paid");
    assert.equal(
      count(
        `private.outbox_events where kind='payment_completed' and subject_id='${confirmed.payment_id}'`
      ),
      1
    );
    assert.equal(
      count(`private.invoices where payment_id='${confirmed.payment_id}' and total_cents=750000`),
      1
    );
    const pkg = json(member(lerato, "select api.get_my_slot_package();"));
    assert.equal(pkg.package.places, 25, JSON.stringify(pkg));
    assert.equal(pkg.package.new_posts_limit, 100);
    // A package that has not ended: no further request.
    fails(askSql(lerato, K30, 5), "PT409", /package_active/);
  });

  await check(
    "above R50,000 a second staff member approves the invoice before it is issued",
    () => {
      const naledi = verified("pkinv-naledi");
      const request = ask(naledi, K180, 100);
      assert.equal(request.total_cents, 6000000);
      assert.equal(
        queue().items.find((i) => i.request_id === request.request_id).needs_approval,
        true
      );
      const before = numbersTaken();
      const prepared = json(issueSql(admin, request.request_id, 14, "Dealer order, 100 slots"));
      assert.equal(prepared.status, "awaiting_approval");
      assert.equal(prepared.invoice, null);
      assert.equal(prepared.invoice_number, null);
      assert.equal(numbersTaken(), before, "no number is taken before approval");
      assert.equal(
        json(issueSql(admin, request.request_id, 14, "Dealer order, 100 slots")).repeated,
        true
      );
      // While it waits the member cannot replace it.
      fails(askSql(naledi, K180, 90), "PT409", /package_invoice_request_open/);
      assert.equal(mine(naledi).status, "awaiting_approval");
      // Never the preparer; only payments:confirm_transfer.
      fails(approveSql(admin, request.request_id), "42501", /invoice_approver_same/);
      fails(approveSql(moderator, request.request_id), "42501");
      const approved = json(approveSql(admin2, request.request_id));
      assert.equal(approved.status, "issued");
      assert.equal(approved.invoice.total_cents, 6000000);
      assert.equal(approved.invoice.slots, 100);
      assert.equal(approved.invoice.due_on > today, true);
      assert.equal(numbersTaken(), before + 1);
      const row = invoiceRow(approved.invoice.invoice_number);
      assert.equal(row.issued_by, admin.id, "the preparer issued it");
      assert.equal(
        q(
          `select approved_by from private.package_invoice_requests where id='${request.request_id}';`
        ),
        admin2.id
      );
      assert.equal(json(approveSql(admin2, request.request_id)).repeated, true);
      // An approval needs a prepared request.
      const other = ask(verified("pkinv-zola"), K30, 5);
      fails(approveSql(admin2, other.request_id), "PT409", /package_invoice_request_closed/);
      // The member's invoice reads (the existing commands) show it.
      const read = json(member(naledi, `select api.get_my_invoice('${row.invoice_number}');`));
      assert.equal(read.total_cents, 6000000);
    }
  );

  await check("an approval is refused once the preparer can no longer issue invoices", () => {
    const thabo = verified("pkinv-thabo");
    const request = ask(thabo, K180, 90);
    const preparer = world.staffUser("pkinv-preparer", "admin");
    world.review(preparer, admin, "pkinv-preparer");
    assert.equal(json(issueSql(preparer, request.request_id)).status, "awaiting_approval");
    q(
      `update private.staff_roles set revoked_at=now(),revoked_by='${admin.id}' where user_id='${preparer.id}';`
    );
    fails(approveSql(admin2, request.request_id), "PT409", /invoice_preparer_inactive/);
    assert.equal(json(declineSql(admin2, request.request_id)).status, "declined");
  });

  await check(
    "Pay now pays a package invoice within the online limit and opens the package",
    () => {
      const zanele = verified("pkinv-zanele");
      const request = ask(zanele, K30, 5);
      const issued = json(issueSql(admin, request.request_id)).invoice;
      assert.equal(issued.total_cents, 50000);
      billing(zanele, issued.invoice_number);
      // The member's other open package checkout never sent to Ozow is closed.
      const online = json(
        member(zanele, `select api.start_package_checkout('${K30.id}',6,60000,true);`)
      );
      const quote = json(payNowSql(zanele, issued));
      assert.equal(quote.slots, 5);
      assert.equal(quote.amount_cents, "50000");
      assert.equal(quote.merchant_reference, issued.invoice_number);
      assert.equal(
        q(`select status from private.payments where id='${online.payment_id}';`),
        "cancelled"
      );
      assert.deepEqual(
        json(
          `select jsonb_build_object('lines',count(*),'slot_count',max(slot_count),'amount',sum(amount_cents)) from private.payment_lines where payment_id='${quote.payment_id}';`
        ),
        { lines: 1, slot_count: 5, amount: 50000 }
      );
      const settled = settle(zanele, quote.payment_id);
      assert.equal(settled.outcome, "completed", JSON.stringify(settled));
      assert.equal(settled.fulfillment_status, "fulfilled");
      const grant = grantOf(quote.payment_id);
      assert.equal(grant.capacity, 5);
      assert.equal(grant.activations, 20);
      assert.equal(grant.package_slots, 5);
      assert.equal(grant.days, 30);
      assert.equal(invoiceRow(issued.invoice_number).status, "paid");
    }
  );

  await check("a declined request issues nothing; the member may ask again", () => {
    const ayanda = verified("pkinv-ayanda");
    const request = ask(ayanda, K90, 10);
    fails(declineSql(admin, request.request_id, "x"), "22023");
    const declined = json(declineSql(admin, request.request_id));
    assert.equal(declined.status, "declined");
    assert.equal(declined.close_reason, "Customer asked us to cancel it");
    assert.equal(json(declineSql(admin, request.request_id)).repeated, true);
    fails(issueSql(admin2, request.request_id), "PT409", /package_invoice_request_closed/);
    assert.equal(mine(ayanda).status, "declined");
    assert.equal(ask(ayanda, K90, 10).status, "requested");
  });

  await check(
    "issuing checks the switch, the customer's ID review and the staff member's identity again",
    () => {
      const bongani = verified("pkinv-bongani");
      const request = ask(bongani, K30, 8);
      onSale(false);
      fails(issueSql(admin, request.request_id), "PT403", /packages_not_on_sale/);
      onSale(true);
      const revoked = verified("pkinv-revoked");
      const revokedRequest = ask(revoked, K30, 5);
      q(
        `update private.accepted_identity_facts set revoked_at=now() where owner_id='${revoked.id}';`
      );
      fails(issueSql(admin, revokedRequest.request_id), "PT412", /invoice_buyer_unverified/);
      // (closed here, so the fixture leaves no open request behind).
      q(
        `update private.package_invoice_requests set status='withdrawn',closed_at=now() where id='${revokedRequest.request_id}';`
      );
      // Staff never handle an account of their own identity.
      // (another account once reviewed as the same person as `admin`).
      const self = verified("pkinv-admin-alt");
      world.pastIdentity(self, admin2, fingerprintOf("pkinv-admin"));
      const own = ask(self, K30, 5);
      fails(issueSql(admin, own.request_id), "42501", /staff_same_identity/);
      assert.equal(json(issueSql(admin, request.request_id)).status, "issued");
    }
  );

  await check(
    "a bank transfer of a package invoice is refused while packages are off sale or the account has a package",
    () => {
      const kagiso = verified("pkinv-kagiso");
      const issued = json(issueSql(admin, ask(kagiso, K30, 6).request_id)).invoice;
      const recorded = json(transferSql(admin, issued.invoice_number, "FNB PKG 0002"));
      onSale(false);
      fails(confirmSql(admin2, recorded.transfer_id), "PT403", /packages_not_on_sale/);
      fails(transferSql(admin, issued.invoice_number, "FNB PKG 0003"), "PT409");
      onSale(true);
      assert.equal(json(confirmSql(admin2, recorded.transfer_id)).status, "confirmed");
    }
  );

  await check("the request record keeps what was asked and moves on once", () => {
    const request = ask(verified("pkinv-guard"), K30, 7);
    fails(
      `update private.package_invoice_requests set slots=9 where id='${request.request_id}';`,
      "23514"
    );
    fails(
      `update private.package_invoice_requests set total_cents=1 where id='${request.request_id}';`,
      "23514"
    );
    json(declineSql(admin, request.request_id));
    fails(
      `update private.package_invoice_requests set status='requested',closed_at=null,closed_by=null,close_reason=null where id='${request.request_id}';`,
      "23514"
    );
  });

  await check("Individual invoices work as before", () => {
    const mpho = verified("pkinv-mpho");
    const issued = json(
      staff(
        admin,
        `select api.issue_staff_invoice(${sqlValue(mpho.email)},30,2,7,'Invoice requested by email','${randomUUID()}');`
      )
    );
    assert.equal(issued.slots, 2);
    fails(
      staff(
        admin,
        `select api.issue_staff_invoice(${sqlValue(mpho.email)},30,26,7,'Too many slots','${randomUUID()}');`
      ),
      "22023"
    );
    const recorded = json(transferSql(admin, issued.invoice_number, "FNB IND 0001"));
    const confirmed = json(confirmSql(admin2, recorded.transfer_id));
    assert.equal(confirmed.slots_started, 2);
    assert.equal(count(`private.payment_lines where payment_id='${confirmed.payment_id}'`), 2);
    assert.equal(count(`private.slot_packages where owner_id='${mpho.id}'`), 0);
  });

  await check("the privacy export lists the member's package invoice requests", () => {
    const exported = json(`select internal.frontend_privacy_export_data('${lerato.id}');`);
    const requests = exported.package_invoice_requests;
    assert.equal(requests.length, 2);
    assert.ok(requests.some((r) => r.invoice_number === leratoInvoice.invoice_number));
    assert.ok(requests.every((r) => r.consent_version === "invoice-cooling-off-v1"));
  });

  await check("the preflight counts what was recorded; the rollback refuses", () => {
    assert.match(
      preflight()[0][1],
      /^package invoices: already applied; on sale: YES; invoice requests: \d+ \(open: \d+\); package invoices: [1-9]\d*; package bank transfers: [1-9]\d*$/
    );
    assert.match(fails(kit.rollbackSql, "55000"), /package invoice requests were made/);
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep package invoices", () => {
      const late = verified("pkinv-later");
      assert.equal(ask(late, K30, 5).status, "requested");
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Package invoice checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
