#!/usr/bin/env node
// Behaviour checks for 20261120045404_package_add_slots.sql: slots added
// part-way through a Multi-listing package (roadmap P4b; the owner's
// decision D1).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members buy with the production checkouts (as `authenticated` with
// synthetic claims and a live session row); the website's server leases,
// attaches and settles as `service_role` with synthetic Ozow ids; staff act
// with a verified authenticator app and an AAL2 session. Time is moved by
// shifting a member's own dates back (vmtest.travel). The only stand-in is
// internal.current_verified_identity (the member's current accepted fact). The
// sales switch is turned on the way the owner would: one SQL statement.
//
// It checks the read-only preflight, drifted bodies and a premature rollback,
// applies the update and proves apply -> rollback -> apply, then: the grants;
// with packages off sale nothing can be added; the offer (days left, the price
// of one slot for them, the most that can be added, which ways are open); the
// online add's rules (total, box, number, 100 slots in all and Ozow's maximum
// by invoice, unpaid package invoice), its repeat and delivery as a further
// grant of the package ending with it (4 new posts per added slot, the partner
// commission of 20%); the 30-minute price hold and the 7-day rule when the
// order is sent to Ozow; an add paid after the package ended goes to
// reconciliation and staff cannot activate it; "Ask for an invoice" for added
// slots (10 or more days, the price kept, repeats, the staff queue, the
// invoice's price and words), paid by bank transfer (two staff members) or Pay
// now, and refused once the package has ended; the 250-slot limit; a refunded
// add keeps the posts that still fit (the most recently approved first) and
// ends only the others; and the rollback refused once slots were added.
//
//   node --import tsx scripts/test-foundation-package-add-slots.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { executeGrants } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  ozowNoticeSql,
  ozowOpen,
  ozowSettle,
  runTwoAdminUpdateCheck,
  sqlValue,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261120045404_package_add_slots.sql";
/** The Multi-listing package terms (20261114154823_slot_packages.sql). */
const K30 = { id: "5b0f4c1e-2a7d-4c43-9b51-7e0d3f6a9c11", days: 30, cents: 10000 };
const COMMANDS = [
  "api.get_my_package_add_offer()",
  "api.start_package_add_checkout(uuid,integer,bigint,boolean)",
  "api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid)",
];
const MEMBER_INTERNALS = [
  "internal.get_my_package_add_offer()",
  "internal.start_package_add_checkout(uuid,integer,bigint,boolean)",
  "internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid)",
];
const HELPERS = [
  "internal.slot_package_term_plan(integer)",
  "internal.slot_package_add_quote(uuid)",
  "internal.slot_package_add_ok(uuid,uuid,integer)",
  "internal.package_add_invoice_package(uuid)",
  "internal.slot_package_keep_posts(uuid)",
];
const REPLACED = [
  "internal.issue_slot_line_entitlements(uuid)",
  "internal.apply_provider_event(jsonb)",
  "internal.activate_staff_paid_payment(uuid,text)",
  "internal.claim_checkout_request(uuid,uuid)",
  "internal.slot_package_grant_revoked()",
  "internal.package_invoice_request_guard()",
  "internal.package_invoice_request_dto(private.package_invoice_requests,uuid)",
  "internal.package_invoice_issue_check(private.package_invoice_requests)",
  "internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text)",
  "internal.start_invoice_payment(text,bigint,boolean)",
  "internal.record_staff_invoice_transfer(text,text,text,boolean,text)",
  "internal.confirm_staff_invoice_payment(uuid)",
];
/** The price of one added slot for `days` whole days of a 30-day term. */
const unit = (days) => Math.round((K30.cents * days) / 30);

const SETUP = { update: UPDATE, label: "adds", title: "Package add slots" };
await runTwoAdminUpdateCheck(SETUP, async ({ database, check, kit, world, admin, admin2 }) => {
  const { q, json, fails, count, member, staff, service, preflight } = kit;
  const verified = (label) => world.verified(label, admin);
  const scalar = (sql) => q(sql);
  const truth = (sql) => scalar(`select (${sql});`) === "t";
  const today = q("select to_char((now() at time zone 'Africa/Johannesburg')::date,'YYYY-MM-DD');");

  // Days pass for one member: every date of their slots, activations, posts,
  // search documents and finished payments moves back by p_by.
  q(`create function vmtest.travel(p_owner uuid,p_by interval) returns void language plpgsql as $$
    begin
      perform set_config('session_replication_role','replica',true);
      update private.entitlements set starts_at=starts_at-p_by,ends_at=ends_at-p_by where owner_id=p_owner;
      update private.post_activations set activated_at=activated_at-p_by,released_at=released_at-p_by where owner_id=p_owner;
      update private.posts set visible_until=visible_until-p_by,published_at=published_at-p_by,ended_at=ended_at-p_by,
        deletes_at=deletes_at-p_by where owner_id=p_owner;
      update private.post_search_documents d set visible_until=d.visible_until-p_by,published_at=d.published_at-p_by
        from private.posts p where p.id=d.post_id and p.owner_id=p_owner;
      update private.payments set created_at=created_at-p_by,completed_at=completed_at-p_by,
        status_changed_at=status_changed_at-p_by where owner_id=p_owner and status<>'pending';
      update private.slot_packages set created_at=created_at-p_by where owner_id=p_owner;
      perform set_config('session_replication_role','origin',true);
    end$$;`);
  const travel = (owner, by) => q(`select vmtest.travel('${owner.id}','${by}'::interval);`);
  const onSale = (value) =>
    q(
      `update private.slot_package_sales set on_sale=${value},changed_at=now(),reason='Fixture: switched for the checks';`
    );
  const settle = (owner, paymentId) => ozowSettle(kit, owner, paymentId);
  const buyPackage = (owner, slots) => {
    const quoted = json(
      member(
        owner,
        `select api.start_package_checkout('${K30.id}',${slots},${K30.cents * slots},true);`
      )
    );
    assert.equal(settle(owner, quoted.payment_id).fulfillment_status, "fulfilled");
    return quoted.payment_id;
  };
  /** A member with a running 30-day package of `slots` slots, `daysIn` days into it. */
  const packageHolder = (label, slots = 5, daysIn = "10 days") => {
    const owner = verified(label);
    const paymentId = buyPackage(owner, slots);
    travel(owner, daysIn);
    return { owner, paymentId };
  };
  const offer = (owner) => json(member(owner, "select api.get_my_package_add_offer();"));
  const addSql = (owner, packageId, slots, { expected, consent = true } = {}) =>
    member(
      owner,
      `select api.start_package_add_checkout('${packageId}',${slots},${expected ?? slots * offer(owner).package.unit_price_cents},${consent});`
    );
  const add = (owner, packageId, slots, options) => json(addSql(owner, packageId, slots, options));
  const askSql = (owner, packageId, slots, { expected, id } = {}) =>
    member(
      owner,
      `select api.request_package_add_invoice('${packageId}',${slots},${expected ?? slots * offer(owner).package.unit_price_cents},true,'${id ?? randomUUID()}');`
    );
  const ask = (owner, packageId, slots, options) => json(askSql(owner, packageId, slots, options));
  const queue = () => json(staff(admin, "select api.get_staff_package_invoice_requests();"));
  const issue = (requestId, due = 3) =>
    json(
      staff(
        admin,
        `select api.issue_staff_package_invoice('${requestId}',${due},'Invoice asked for on the add page');`
      )
    );
  const transferSql = (who, invoiceNumber, reference) =>
    staff(
      who,
      `select api.record_staff_invoice_transfer(${sqlValue(invoiceNumber)},${sqlValue(reference)},'${today}',true,'EFT cleared; customer agreed in writing');`
    );
  const confirm = (who, transferId) =>
    json(staff(who, `select api.confirm_staff_invoice_payment('${transferId}');`));
  const billing = (owner, invoiceNumber) => {
    const invoice = json(member(owner, `select api.get_my_invoice('${invoiceNumber}');`));
    json(
      member(
        owner,
        `select api.save_my_invoice_billing('${invoiceNumber}',${invoice.revision},'Fixture Motors (Pty) Ltd','1 Example Road\nEmpangeni\n3880',null);`
      )
    );
  };
  const grantOf = (paymentId) =>
    json(`select jsonb_build_object('id',e.id,'line',l.id,'slots',l.slot_count,'amount',l.amount_cents,
        'capacity',e.slot_capacity,'activations',e.activations_per_period,'package',e.package_id,
        'starts',e.starts_at,'ends',e.ends_at,'status',e.status)
      from private.payment_lines l left join private.entitlements e on e.payment_line_id=l.id
      where l.payment_id='${paymentId}' and l.line_number=1;`);
  const mine = (owner) => json(member(owner, "select api.get_my_slot_package();")).package;
  const live = (owner, id) => {
    json(member(owner, `select api.activate_post('${id}');`));
    q(`update private.posts set status='live',published_at=clock_timestamp(),
         visible_until=(select f.funded_until from internal.post_funding('${id}') f) where id='${id}';
       select internal.write_post_projection('${id}');`);
  };
  const grantHolding = (id) =>
    scalar(
      `select a.entitlement_id from private.post_activations a where a.post_id='${id}' and a.released_at is null;`
    );

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
      assert.match(
        rows[0][1],
        /^package add slots: update not applied; on sale: no; packages running: 0; package invoice requests: 0; added-slots requests: none \(column absent\); added-slots payments: 0$/
      );
      const someone = world.user("adds-before");
      fails(member(someone, "select api.get_my_package_add_offer();"), "42883");
    }
  );

  await check("the update and a premature rollback refuse drifted bodies, changing nothing", () =>
    assertDriftRefused(kit, { label: "package add slots", signatures: REPLACED, rows: 2 })
  );

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: UPDATE,
    applied:
      /^package add slots: already applied; on sale: no; packages running: 0; package invoice requests: 0; added-slots requests: 0; added-slots payments: 0$/,
    notApplied: /^package add slots: update not applied/,
  });

  await check("grants: members call the three commands; nobody calls the helpers", () => {
    const grants = executeGrants(json, [...COMMANDS, ...MEMBER_INTERNALS, ...HELPERS]);
    for (const name of [...COMMANDS, ...MEMBER_INTERNALS])
      assert.deepEqual(
        grants[name],
        { anon: false, authenticated: true, service_role: false },
        name
      );
    for (const name of HELPERS)
      assert.deepEqual(
        grants[name],
        { anon: false, authenticated: false, service_role: false },
        name
      );
  });

  await check("while packages are off sale nothing can be added", () => {
    const thandi = verified("adds-off");
    const read = offer(thandi);
    assert.equal(read.on_sale, false);
    assert.equal(read.package, null);
    const id = randomUUID();
    fails(addSql(thandi, id, 5, { expected: 5000 }), "PT403", /packages_not_on_sale/);
    fails(askSql(thandi, id, 5, { expected: 5000 }), "PT403", /packages_not_on_sale/);
  });

  onSale(true);

  // -------------------------------------------------------- the offer
  let ayanda;
  let ayandaPackage;
  let ayandaPayment;
  await check("the offer: whole days left, one slot's price for them, what can be added", () => {
    ({ owner: ayanda, paymentId: ayandaPayment } = packageHolder("adds-ayanda"));
    ayandaPackage = grantOf(ayandaPayment).package;
    const read = offer(ayanda).package;
    assert.equal(read.id, ayandaPackage);
    assert.equal(read.places, 5);
    // 10 days and a moment have passed: 19 whole days are left.
    assert.equal(read.days_left, 19);
    assert.equal(Number(read.unit_price_cents), unit(19));
    assert.equal(read.max_slots, 245);
    assert.equal(read.max_online_slots, 95);
    assert.equal(read.online_open, true);
    assert.equal(read.invoice_open, true);
    assert.equal(read.invoice_unpaid, false);
    assert.equal(read.request, null);
    assert.deepEqual(read.adds, []);
    // Another account sees only its own (none).
    assert.equal(offer(verified("adds-other")).package, null);
  });

  // ------------------------------------------------------ online add
  await check(
    "the online add's rules: total, box, number, 100 slots in all and Ozow's maximum",
    () => {
      const price = unit(19);
      fails(addSql(ayanda, ayandaPackage, 5, { expected: price * 5 + 1 }), "PT428");
      fails(addSql(ayanda, ayandaPackage, 5, { consent: false }), "22023");
      fails(addSql(ayanda, ayandaPackage, 0, { expected: 1 }), "22023", /package_slots_invalid/);
      fails(addSql(ayanda, ayandaPackage, 246), "22023", /package_slots_invalid/);
      // Above Ozow's maximum (R1,300): by invoice.
      fails(addSql(ayanda, ayandaPackage, 21), "PT413", /package_invoice_required/);
      // Another package id (someone else's, or an ended one): refused.
      fails(addSql(ayanda, randomUUID(), 5), "PT409", /package_ended/);
    }
  );

  await check(
    "an online add is one payment, delivered as a further grant ending with the package",
    () => {
      // A partner referred the buyer: 20% of the add, as of any plan payment.
      const partner = world.user("adds-partner");
      q(`select set_config('session_replication_role','replica',false);
      insert into private.partners(account_id,code,status,commission_bps,created_by)
        values('${partner.id}','ADDSLOTS','active',2000,'${admin.id}');
      insert into private.account_acquisitions(account_id,source,partner_id)
        values('${ayanda.id}','partner',(select id from private.partners where account_id='${partner.id}'));
      select set_config('session_replication_role','origin',false);`);
      const first = add(ayanda, ayandaPackage, 5);
      assert.equal(first.package, true);
      assert.equal(first.slots, 5);
      assert.equal(Number(first.amount_cents), unit(19) * 5);
      // The same order again continues it.
      const again = add(ayanda, ayandaPackage, 5);
      assert.equal(again.payment_id, first.payment_id);
      assert.equal(again.reused, true);
      // Another number replaces the unsent order.
      const other = add(ayanda, ayandaPackage, 4);
      assert.notEqual(other.payment_id, first.payment_id);
      assert.equal(
        scalar(`select status from private.payments where id='${first.payment_id}';`),
        "cancelled"
      );
      const snapshot = json(
        `select snapshot from private.payments where id='${other.payment_id}';`
      );
      assert.equal(snapshot.category, "slot_package_add");
      assert.equal(snapshot.package_id, ayandaPackage);
      assert.equal(snapshot.cooling_off_consent.wording_version, "package-add-starts-now-v1");
      assert.equal(
        snapshot.invoice_description,
        "Multi-listing package: 4 slots added for 19 days"
      );
      const settled = settle(ayanda, other.payment_id);
      assert.equal(settled.fulfillment_status, "fulfilled", JSON.stringify(settled));
      const grant = grantOf(other.payment_id);
      const main = grantOf(ayandaPayment);
      assert.equal(grant.package, ayandaPackage);
      assert.equal(grant.capacity, 4);
      assert.equal(grant.activations, 16);
      assert.ok(
        truth(`'${grant.ends}'::timestamptz='${main.ends}'::timestamptz`),
        "ends with the package"
      );
      assert.equal(count(`private.slot_packages where owner_id='${ayanda.id}'`), 1);
      const held = mine(ayanda);
      assert.equal(held.places, 9);
      assert.equal(held.slots_bought, 5);
      assert.equal(held.new_posts_limit, 36);
      const read = offer(ayanda).package;
      assert.deepEqual(
        read.adds.map((a) => [a.payment_id, a.slots]),
        [[other.payment_id, 4]]
      );
      assert.equal(read.max_slots, 241);
      const commissions = json(`select coalesce(jsonb_agg(jsonb_build_object('base',base_cents,
          'amount',amount_cents,'line',payment_line_id)),'[]')
        from private.partner_commissions where payment_id='${other.payment_id}';`);
      assert.equal(commissions.length, 1, JSON.stringify(commissions));
      assert.equal(commissions[0].base, unit(19) * 4);
      assert.equal(commissions[0].line, grant.line);
      assert.ok(
        Math.abs(commissions[0].amount - (unit(19) * 4) / 5) <= 1,
        JSON.stringify(commissions)
      );
    }
  );

  await check("the price holds 30 minutes and an add needs 7 days left when sent to Ozow", () => {
    const sipho = packageHolder("adds-sipho").owner;
    const packageId = offer(sipho).package.id;
    const order = add(sipho, packageId, 2);
    q(
      `update private.payments set created_at=created_at-interval '31 minutes' where id='${order.payment_id}';`
    );
    fails(
      service(`select api.claim_checkout_request('${order.payment_id}','${sipho.id}');`),
      "PT409",
      /package_add_price_expired/
    );
    // Starting again replaces it at today's price.
    const fresh = add(sipho, packageId, 2);
    assert.notEqual(fresh.payment_id, order.payment_id);
    // 13 more days pass: 6 whole days left, too late to send it.
    travel(sipho, "13 days");
    fails(
      service(`select api.claim_checkout_request('${fresh.payment_id}','${sipho.id}');`),
      "PT409",
      /package_add_too_late/
    );
    assert.equal(offer(sipho).package.online_open, false);
    assert.equal(offer(sipho).package.invoice_open, false);
    fails(addSql(sipho, packageId, 2), "PT409", /package_add_too_late/);
    fails(askSql(sipho, packageId, 2), "PT409", /package_add_invoice_too_late/);
  });

  await check("by invoice only while 10 or more days are left", () => {
    const lerato = packageHolder("adds-lerato", 5, "21 days").owner;
    const read = offer(lerato).package;
    assert.equal(read.days_left, 8);
    assert.equal(read.online_open, true);
    assert.equal(read.invoice_open, false);
    fails(askSql(lerato, read.id, 30), "PT409", /package_add_invoice_too_late/);
    // Online still works within the limit.
    assert.ok(add(lerato, read.id, 2).payment_id);
  });

  await check(
    "an add paid after its package ended goes to reconciliation; staff cannot activate it",
    () => {
      const naledi = packageHolder("adds-naledi").owner;
      const order = add(naledi, offer(naledi).package.id, 3);
      ozowOpen(kit, naledi, order.payment_id);
      travel(naledi, "21 days");
      assert.equal(offer(naledi).package, null);
      const settled = json(ozowNoticeSql(kit, order.payment_id));
      assert.equal(settled.fulfillment_status, "needs_reconciliation", JSON.stringify(settled));
      assert.equal(count(`private.entitlements where payment_id='${order.payment_id}'`), 0);
      fails(
        staff(
          admin,
          `select api.activate_staff_paid_payment('${order.payment_id}','Customer asked for the slots');`
        ),
        "PT409",
        /package_ended/
      );
    }
  );

  // ------------------------------------------------------- by invoice
  let invoiceAdd;
  await check(
    "'Ask for an invoice' for added slots: the price of that moment, repeats, the queue",
    () => {
      const price = unit(19);
      const id = randomUUID();
      const asked = ask(ayanda, ayandaPackage, 20, { id });
      assert.equal(asked.kind, "add");
      assert.equal(asked.slots, 20);
      assert.equal(asked.days_left, 19);
      assert.equal(asked.unit_price_cents, price);
      assert.equal(asked.total_cents, price * 20);
      assert.equal(asked.status, "requested");
      assert.equal(asked.repeated, false);
      assert.equal(ask(ayanda, ayandaPackage, 20, { id }).repeated, true);
      fails(askSql(ayanda, ayandaPackage, 21, { id }), "PT409", /invoice_request_conflict/);
      // The same order again keeps the waiting request.
      assert.equal(ask(ayanda, ayandaPackage, 20).request_id, asked.request_id);
      fails(askSql(ayanda, ayandaPackage, 20, { expected: price * 20 - 1 }), "PT428");
      const listed = queue().items.find((item) => item.request_id === asked.request_id);
      assert.equal(listed.kind, "add");
      assert.equal(listed.package_open, true);
      const issued = issue(asked.request_id);
      assert.equal(issued.status, "issued");
      assert.equal(issued.invoice.unit_price_cents, price);
      assert.equal(issued.invoice.total_cents, price * 20);
      assert.equal(issued.invoice.description, "Multi-listing package: 20 slots added for 19 days");
      invoiceAdd = issued.invoice;
      // While it is unpaid no other add starts online.
      assert.equal(offer(ayanda).package.invoice_unpaid, true);
      fails(addSql(ayanda, ayandaPackage, 2), "PT409", /package_invoice_unpaid/);
    }
  );

  await check(
    "a bank transfer to an added-slots invoice adds them to the package (two staff members)",
    () => {
      const placesBefore = mine(ayanda).places;
      const recorded = json(transferSql(admin, invoiceAdd.invoice_number, "FNB ADD 0001"));
      const confirmed = confirm(admin2, recorded.transfer_id);
      assert.equal(confirmed.slots_started, 20);
      const grant = grantOf(confirmed.payment_id);
      assert.equal(grant.package, ayandaPackage);
      assert.equal(grant.capacity, 20);
      assert.equal(grant.amount, unit(19) * 20);
      assert.ok(
        truth(`'${grant.ends}'::timestamptz='${grantOf(ayandaPayment).ends}'::timestamptz`),
        "ends with the package"
      );
      assert.ok(truth(`'${confirmed.ends_at}'::timestamptz='${grant.ends}'::timestamptz`));
      assert.equal(mine(ayanda).places, placesBefore + 20);
      assert.equal(
        scalar(
          `select status from private.customer_invoices where invoice_number='${invoiceAdd.invoice_number}';`
        ),
        "paid"
      );
      assert.equal(offer(ayanda).package.invoice_unpaid, false);
    }
  );

  await check("Pay now pays an added-slots invoice within the online limit", () => {
    const zodwa = packageHolder("adds-zodwa").owner;
    const packageId = offer(zodwa).package.id;
    const asked = ask(zodwa, packageId, 2);
    const invoice = issue(asked.request_id).invoice;
    billing(zodwa, invoice.invoice_number);
    const started = json(
      member(
        zodwa,
        `select api.start_invoice_payment('${invoice.invoice_number}',${invoice.total_cents},true);`
      )
    );
    const snapshot = json(
      `select snapshot from private.payments where id='${started.payment_id}';`
    );
    assert.equal(snapshot.category, "slot_package_add");
    assert.equal(snapshot.package_id, packageId);
    assert.equal(settle(zodwa, started.payment_id).fulfillment_status, "fulfilled");
    assert.equal(grantOf(started.payment_id).package, packageId);
    assert.equal(mine(zodwa).places, 7);
  });

  await check(
    "money for added slots that arrives after the package ended is refused (returned in full)",
    () => {
      const vusi = packageHolder("adds-vusi").owner;
      const packageId = offer(vusi).package.id;
      const invoice = issue(ask(vusi, packageId, 20).request_id).invoice;
      travel(vusi, "20 days");
      fails(transferSql(admin, invoice.invoice_number, "FNB ADD LATE1"), "PT409", /package_ended/);
      billing(vusi, invoice.invoice_number);
      fails(
        member(
          vusi,
          `select api.start_invoice_payment('${invoice.invoice_number}',${invoice.total_cents},true);`
        ),
        "PT409",
        /package_ended/
      );
    }
  );

  await check("a package holds at most 250 slots", () => {
    const kagiso = packageHolder("adds-kagiso").owner;
    // 248 places with an invoice add, then at most 2 more.
    const packageId = offer(kagiso).package.id;
    const invoice = issue(ask(kagiso, packageId, 243).request_id).invoice;
    confirm(admin2, json(transferSql(admin, invoice.invoice_number, "FNB ADD BIG1")).transfer_id);
    assert.equal(offer(kagiso).package.max_slots, 2);
    fails(askSql(kagiso, packageId, 3), "22023", /package_slots_invalid/);
    // Online too: above 100 in all it is by invoice anyway.
    fails(addSql(kagiso, packageId, 1), "PT413", /package_invoice_required/);
  });

  // ----------------------------------------------------------- refunds
  await check("a refunded add keeps the posts that still fit; only the others end", () => {
    const holder = packageHolder("adds-thabo");
    const thabo = holder.owner;
    const mainGrant = grantOf(holder.paymentId);
    const packageId = offer(thabo).package.id;
    const order = add(thabo, packageId, 3);
    assert.equal(settle(thabo, order.payment_id).fulfillment_status, "fulfilled");
    const addGrant = grantOf(order.payment_id);
    // Seven posts in 8 places: the add's grant holds the first three, the
    // package's own grant the other four.
    const posts = Array.from({ length: 7 }, () => world.post(thabo, "listing", "market"));
    for (const id of posts) live(thabo, id);
    q(`update private.post_activations set entitlement_id=case when post_id in
           ('${posts[0]}','${posts[1]}','${posts[2]}') then '${addGrant.id}'::uuid else '${mainGrant.id}'::uuid end
         where post_id in (${posts.map((id) => `'${id}'`).join(",")}) and released_at is null;`);
    q(
      `select internal.reverse_payment_line('${addGrant.line}','refunded','Customer cancelled the added slots','${admin.id}');`
    );
    assert.equal(grantOf(order.payment_id).status, "revoked");
    assert.equal(mine(thabo).places, 5);
    // Five places: the four posts in the package's grant stay; of the three
    // on the add, the most recently approved one moves in, the others end.
    const expired = posts.filter(
      (id) => scalar(`select status from private.posts where id='${id}';`) === "expired"
    );
    assert.deepEqual(expired.sort(), [posts[0], posts[1]].sort());
    assert.equal(grantHolding(posts[2]), mainGrant.id);
    assert.ok(
      truth(`exists(select 1 from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
          where a.post_id='${posts[2]}' and a.released_at is null and a.continued and e.status='active'
            and e.package_id='${packageId}')`),
      "the most recently approved post moved into the package's grant"
    );
    assert.equal(scalar(`select status from private.posts where id='${posts[2]}';`), "live");
  });

  await check("a refunded add keeps every post when they all fit", () => {
    const holder = packageHolder("adds-nomsa");
    const nomsa = holder.owner;
    const mainGrant = grantOf(holder.paymentId);
    const packageId = offer(nomsa).package.id;
    const order = add(nomsa, packageId, 2);
    settle(nomsa, order.payment_id);
    const addGrant = grantOf(order.payment_id);
    const posts = Array.from({ length: 3 }, () => world.post(nomsa, "listing", "market"));
    for (const id of posts) live(nomsa, id);
    q(`update private.post_activations set entitlement_id=case when post_id in
           ('${posts[0]}','${posts[1]}') then '${addGrant.id}'::uuid else '${mainGrant.id}'::uuid end
         where post_id in (${posts.map((id) => `'${id}'`).join(",")}) and released_at is null;`);
    q(
      `select internal.reverse_payment_line('${addGrant.line}','refunded','Customer cancelled the added slots','${admin.id}');`
    );
    for (const id of posts)
      assert.equal(scalar(`select status from private.posts where id='${id}';`), "live", id);
    assert.equal(mine(nomsa).posts.length, 3);
    assert.ok(
      truth(`not exists(select 1 from private.post_activations a where a.entitlement_id='${addGrant.id}'
          and a.released_at is null)`)
    );
    assert.equal(
      Number(
        scalar(`select count(*) from private.post_activations a where a.post_id in
          ('${posts[0]}','${posts[1]}') and a.continued and a.released_at is null;`)
      ),
      2
    );
  });

  await check("the preflight counts the adds; the rollback refuses once slots were added", () => {
    assert.match(
      preflight()[0][1],
      /^package add slots: already applied; on sale: yes; packages running: [1-9]\d*; package invoice requests: [1-9]\d*; added-slots requests: [1-9]\d*; added-slots payments: [1-9]\d*$/
    );
    assert.match(fails(kit.rollbackSql, "55000"), /rollback precondition/);
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the added slots", () => {
      assert.equal(mine(ayanda).places, 29);
    });
  }
});
