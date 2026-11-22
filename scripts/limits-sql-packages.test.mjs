// Database limits from docs/testing/limits-register.json on buying slots:
// Multi-listing packages (new packages, slots added part-way, their invoices
// and checkouts), invoice payments, shared plans, raised Individual slot
// limits and Ozow refund sends. Each is driven to its bound through the real
// function on the replayed production schema (embedded Postgres, no Docker, no
// hosted database), and the next step is shown refused.
//
// Fixtures (scripts/lib/limits-sql-fixtures.mjs): a member whose ID review is
// accepted, packages on sale, a running package of N slots with D whole days
// left, and refunds sent N times. A cheap package term (1 cent a slot per day)
// is added where the real price would hide a slot rule behind the online
// payment maximum.
//
//   node --import tsx --test scripts/limits-sql-packages.test.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { lit, openLimitsDb, refused } from "./lib/limits-sql-harness.mjs";
import {
  businessPost,
  cheapPackagePlan,
  json,
  packagePlan,
  packagesOnSale,
  runningPackage,
  sentRefund,
  setPackageDaysLeft,
  verifiedMember,
  verifiedStaff,
} from "./lib/limits-sql-fixtures.mjs";

let h;
let plan30;
let cheap;
before(async () => {
  h = await openLimitsDb();
  await packagesOnSale(h, true);
  plan30 = await packagePlan(h, 30);
  cheap = await cheapPackagePlan(h);
});
after(async () => {
  await h?.db.close();
});

const PRICE_30 = 10000; // cents a slot, the 30-day package term
const buyer = (label) => verifiedMember(h, label);
const startPackage = (user, planId, slots, unit) =>
  h.asMember(
    user,
    `select api.start_package_checkout(${lit(planId)},${slots},${slots * unit},true) as r`
  );
const requestInvoice = (user, slots) =>
  h.asMember(
    user,
    `select api.request_package_invoice(${lit(plan30)},${slots},${slots * PRICE_30},true,${lit(randomUUID())}) as r`
  );
/** The current price of one added slot of `user`'s package. */
const addUnit = async (user) =>
  Number(
    await h.one(`select unit_price_cents from internal.slot_package_add_quote($1)`, [user.id])
  );
const requestAdd = async (user, pkg, slots) =>
  h.asMember(
    user,
    `select api.request_package_add_invoice(${lit(pkg.id)},${slots},${slots * (await addUnit(user))},true,${lit(randomUUID())}) as r`
  );
const startAdd = async (user, pkg, slots) =>
  h.asMember(
    user,
    `select api.start_package_add_checkout(${lit(pkg.id)},${slots},${slots * (await addUnit(user))},true) as r`
  );

describe("a new Multi-listing package", () => {
  test("LIM-F-start_package_checkout: 5 to 250 slots", async () => {
    await startPackage(await buyer("pkg-5"), plan30, 5, PRICE_30);
    // 250 passes the slot rule; at the real price it is then paid by invoice.
    await refused(
      startPackage(await buyer("pkg-250"), plan30, 250, PRICE_30),
      "PT413",
      /paid by invoice/
    );
    for (const slots of [4, 251])
      await refused(
        startPackage(await buyer(`pkg-${slots}`), plan30, slots, PRICE_30),
        "22023",
        /a package has 5 to 250 slots/
      );
  });

  test("LIM-F-start_package_checkout-2: more than 100 slots is paid by invoice", async () => {
    const unit = Number(
      await h.one(`select price_cents from private.plan_versions where id=$1`, [cheap])
    );
    await startPackage(await buyer("pkg-100"), cheap, 100, unit);
    await refused(
      startPackage(await buyer("pkg-101"), cheap, 101, unit),
      "PT413",
      /above 100 slots/
    );
    // The online payment maximum on the same line: 13 slots of R100 is R1,300.
    await startPackage(await buyer("pkg-13"), plan30, 13, PRICE_30);
    await refused(
      startPackage(await buyer("pkg-14"), plan30, 14, PRICE_30),
      "PT413",
      /paid by invoice/
    );
  });

  test("LIM-F-request_package_invoice: an invoice for 5 to 250 slots", async () => {
    for (const slots of [5, 250]) await requestInvoice(await buyer(`inv-${slots}`), slots);
    for (const slots of [4, 251])
      await refused(
        requestInvoice(await buyer(`inv-${slots}`), slots),
        "22023",
        /a package has 5 to 250 slots/
      );
  });

  test("LIM-F-request_package_invoice-2: at most 10 invoice requests a day", async () => {
    const user = await buyer("inv-flood");
    // Each other order is a new request (the waiting one is withdrawn).
    for (let n = 0; n < 10; n += 1) await requestInvoice(user, 5 + n);
    await refused(requestInvoice(user, 20), "PT429", /too many invoice requests today/);
  });
});

describe("slots added to a running package", () => {
  test("LIM-F-request_package_add_invoice: by invoice while 10 or more days are left", async () => {
    const ok = await buyer("add-inv-10");
    await requestAdd(ok, await runningPackage(h, ok, { places: 5, days: 10 }), 1);
    const late = await buyer("add-inv-9");
    await refused(
      requestAdd(late, await runningPackage(h, late, { places: 5, days: 9 }), 1),
      "PT409",
      /10 or more days of the package are left/
    );
  });

  test("LIM-F-request_package_add_invoice-2: at most 245 slots in one add and 250 in all", async () => {
    // One slot held: 245 more is allowed, 246 is over the single-add maximum
    // (247 in all is still under 250).
    const one = await buyer("add-inv-one");
    const small = await runningPackage(h, one, { places: 1, days: 20 });
    await requestAdd(one, small, 245);
    const one2 = await buyer("add-inv-one2");
    await refused(
      requestAdd(one2, await runningPackage(h, one2, { places: 1, days: 20 }), 246),
      "22023",
      /one add at most 245/
    );
    // Six held: 244 more makes 250, 245 more is over 250.
    const six = await buyer("add-inv-six");
    await requestAdd(six, await runningPackage(h, six, { places: 6, days: 20 }), 244);
    const six2 = await buyer("add-inv-six2");
    await refused(
      requestAdd(six2, await runningPackage(h, six2, { places: 6, days: 20 }), 245),
      "22023",
      /holds at most 250 slots/
    );
  });

  test("LIM-F-request_package_add_invoice-3: at most 10 add invoice requests a day", async () => {
    const user = await buyer("add-inv-flood");
    const pkg = await runningPackage(h, user, { places: 5, days: 20 });
    for (let n = 1; n <= 10; n += 1) await requestAdd(user, pkg, n);
    await refused(requestAdd(user, pkg, 11), "PT429", /too many invoice requests today/);
  });

  test("LIM-F-start_package_add_checkout: online while 7 or more days are left", async () => {
    const ok = await buyer("add-7");
    await startAdd(ok, await runningPackage(h, ok, { places: 5, days: 7 }), 1);
    const late = await buyer("add-6");
    await refused(
      startAdd(late, await runningPackage(h, late, { places: 5, days: 6 }), 1),
      "PT409",
      /7 or more days of the package are left/
    );
  });

  test("LIM-F-start_package_add_checkout-2: a package holds at most 250 slots", async () => {
    // On the cheap term: 200 + 50 = 250 passes this rule (then it is over
    // 100 in all, so by invoice); 200 + 51 is refused.
    const ok = await buyer("add-250");
    await refused(
      startAdd(ok, await runningPackage(h, ok, { places: 200, days: 20, term: 180 }), 50),
      "PT413",
      /above 100 slots in all/
    );
    const over = await buyer("add-251");
    await refused(
      startAdd(over, await runningPackage(h, over, { places: 200, days: 20, term: 180 }), 51),
      "22023",
      /holds at most 250 slots/
    );
  });

  test("LIM-F-start_package_add_checkout-3: online up to 100 slots in all", async () => {
    const ok = await buyer("add-100");
    await startAdd(ok, await runningPackage(h, ok, { places: 50, days: 20, term: 180 }), 50);
    const over = await buyer("add-101");
    await refused(
      startAdd(over, await runningPackage(h, over, { places: 50, days: 20, term: 180 }), 51),
      "PT413",
      /above 100 slots in all/
    );
  });

  test("LIM-F-slot_package_add_ok: an add is delivered only while the package stays at most 250", async () => {
    const user = await buyer("add-ok");
    const pkg = await runningPackage(h, user, { places: 200, days: 20 });
    const ok = (slots) =>
      h.one(`select internal.slot_package_add_ok($1,$2,$3)`, [user.id, pkg.id, slots]);
    assert.equal(await ok(50), true);
    assert.equal(await ok(51), false);
  });

  test("LIM-F-claim_checkout_request: an online add is sent to Ozow while 7 or more days are left", async () => {
    const user = await buyer("add-claim");
    const pkg = await runningPackage(h, user, { places: 5, days: 7 });
    const payment = (await startAdd(user, pkg, 1))[0].r.payment_id;
    const claim = () =>
      h.asService(`select api.claim_checkout_request(${lit(payment)},${lit(user.id)}) as r`);
    await claim();
    await setPackageDaysLeft(h, pkg, 6);
    await h.seed(`update private.payments set checkout_claim_until=null where id=${lit(payment)};`);
    await refused(claim(), "PT409", /7 or more days of the package are left/);
  });

  test("LIM-F-get_my_package_add_offer to -4: the add offer's slot room and open ways to pay", async () => {
    const offer = async (places, days) => {
      const user = await buyer(`offer-${places}-${days}`);
      await runningPackage(h, user, { places, days });
      return (await h.asMember(user, `select api.get_my_package_add_offer() as r`))[0].r.package;
    };
    // LIM-F-get_my_package_add_offer: at most 245 in one add, 250 in all.
    assert.equal((await offer(1, 20)).max_slots, 245);
    assert.equal((await offer(10, 20)).max_slots, 240);
    assert.equal((await offer(250, 20)).max_slots, 0);
    // LIM-F-get_my_package_add_offer-2: online up to 100 in all.
    assert.equal((await offer(10, 20)).max_online_slots, 90);
    assert.equal((await offer(120, 20)).max_online_slots, 0);
    // LIM-F-get_my_package_add_offer-3 and LIM-F-get_my_package_add_offer-4: online from 7 days left, by
    // invoice from 10.
    const at10 = await offer(5, 10);
    assert.deepEqual([at10.online_open, at10.invoice_open], [true, true]);
    const at9 = await offer(5, 9);
    assert.deepEqual([at9.online_open, at9.invoice_open], [true, false]);
    const at7 = await offer(5, 7);
    assert.deepEqual([at7.online_open, at7.invoice_open], [true, false]);
    const at6 = await offer(5, 6);
    assert.deepEqual([at6.online_open, at6.invoice_open], [false, false]);
  });

  test("LIM-F-get_my_package_add_offer-5: the 20 latest adds are listed", async () => {
    const user = await buyer("offer-adds");
    const pkg = await runningPackage(h, user, { places: 5, days: 20 });
    await h.seed(`with p as (
        insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status,fulfillment_status,completed_at,provider)
        select ${lit(user.id)},'plan',${lit(plan30)},100,'ZAR',jsonb_build_object('category','slot_package_add','package_id',${lit(pkg.id)}),
          'complete','fulfilled',now()-make_interval(mins=>n),'invoice' from generate_series(1,21) n returning id)
      insert into private.payment_lines(payment_id,line_number,plan_version_id,amount_cents,slot_count)
        select id,1,${lit(plan30)},100,1 from p;`);
    const adds = (await h.asMember(user, `select api.get_my_package_add_offer() as r`))[0].r.package
      .adds;
    assert.equal(adds.length, 20);
  });
});

describe("package invoices issued by staff", () => {
  /** An add request of `user` for `slots` (made through the real command). */
  async function addRequest(label, places, slots, days = 20) {
    const user = await buyer(label);
    const pkg = await runningPackage(h, user, { places, days });
    const id = (await requestAdd(user, pkg, slots))[0].r.request_id;
    return { user, pkg, id };
  }
  const issueCheck = (request) =>
    h.one(
      `select (internal.package_invoice_issue_check(r)).id from private.package_invoice_requests r where r.id=$1`,
      [request.id]
    );

  test("LIM-F-package_invoice_issue_check: an add is invoiced while 10 or more days are left", async () => {
    const request = await addRequest("issue-days", 5, 1, 10);
    assert.ok(await issueCheck(request));
    await setPackageDaysLeft(h, request.pkg, 9);
    await refused(issueCheck(request), "PT409", /fewer than 10 days/);
  });

  test("LIM-F-package_invoice_issue_check-2: an add is invoiced while the package stays at most 250", async () => {
    const request = await addRequest("issue-room", 5, 245);
    assert.ok(await issueCheck(request));
    await h.seed(
      `update private.entitlements set slot_capacity=6 where package_id=${lit(request.pkg.id)};`
    );
    await refused(issueCheck(request), "PT409", /more than 250 slots/);
  });

  test("LIM-F-issue_package_customer_invoice: an add is due 3 days after issue, or on the package's last day", async () => {
    const issue = async (request) => {
      const due = await h.one(
        `select (internal.issue_package_customer_invoice(r,v,(select u.id from auth.users u where u.id<>r.account_id limit 1),7,'Synthetic invoice reason')).due_on::text
           from private.package_invoice_requests r join private.plan_versions v on v.id=r.plan_version_id where r.id=$1`,
        [request.id]
      );
      const day = (sql) => h.one(`select (${sql})::text`);
      return { due, day };
    };
    const later = await addRequest("issue-due-later", 5, 1, 20);
    const a = await issue(later);
    assert.equal(a.due, await a.day(`internal.customer_invoice_day(statement_timestamp())+3`));
    // Ending in 1 day and 12 hours: due on the package's last day instead.
    const soon = await addRequest("issue-due-soon", 5, 1, 20);
    await setPackageDaysLeft(h, soon.pkg, 1);
    const b = await issue(soon);
    const lastDay = await b.day(
      `select internal.customer_invoice_day(max(ends_at)) from private.entitlements where package_id=${lit(soon.pkg.id)}`
    );
    assert.equal(b.due, lastDay);
    assert.notEqual(b.due, await b.day(`internal.customer_invoice_day(statement_timestamp())+3`));
  });

  test("LIM-F-payment_invoice_vat: a VAT rate of 0 to 10,000 basis points", async () => {
    const vat = (rate) =>
      h.one(
        `select internal.payment_invoice_vat(jsonb_populate_record(null::private.payments,
           jsonb_build_object('amount_cents',11500,'snapshot',jsonb_build_object('merchant_invoice',
             jsonb_build_object('vat_rate_bps',$1::integer,'registration_status','registered')))))`,
        [rate]
      );
    assert.equal(Number(await vat(0)), 0);
    assert.equal(Number(await vat(1500)), 1500);
    assert.equal(Number(await vat(10000)), 5750);
    for (const rate of [-1, 10001])
      await refused(vat(rate), "PT503", /invalid invoice configuration/);
  });

  test("LIM-SQL-staff-invoice-max: a staff invoice is at most R50,000", async () => {
    // No Individual slot is priced near R50,000: a newer 30-day version is
    // priced at R10,000 (the most a slot may cost) for this check, and the
    // customer's limit is raised to 5 slots, so 5 slots reach the bound.
    const staffUser = await verifiedStaff(h, "invoice-max-staff");
    const customer = await buyer("invoice-max-buyer");
    const email = await h.one(`select email from auth.users where id=$1`, [customer.id]);
    await h.seed(`insert into private.individual_slot_limits(identity_hmac,account_id,slot_limit,ends_at,reason,granted_by)
      select identity_hmac,owner_id,5,now()+interval '30 days','Synthetic slot reason',${lit(staffUser.id)}
      from private.accepted_identity_facts where owner_id=${lit(customer.id)} and revoked_at is null;`);
    const version = randomUUID();
    const price = (cents) =>
      h.seed(`update private.plan_versions set price_cents=${cents} where id=${lit(version)};`);
    await h.seed(`insert into private.plan_versions
        select (jsonb_populate_record(v, jsonb_build_object('id',${lit(version)},'version',v.version+90))).*
        from private.plan_versions v where v.plan_code='individual_30d' and v.retired_at is null order by v.version desc limit 1;`);
    const issue = () =>
      h.asStaff(
        staffUser,
        `select api.issue_staff_invoice(${lit(email)},30,5,7,'Synthetic invoice reason',${lit(randomUUID())}) as r`
      );
    try {
      await price(1000001);
      await refused(issue(), "PT413", /above R50,000/);
      await price(1000000);
      assert.equal(Number((await issue())[0].r.total_cents), 5000000);
    } finally {
      await h.seed(`update private.plan_versions set retired_at=now() where id=${lit(version)};`);
    }
  });

  test("LIM-F-start_invoice_payment: an invoice is tried at most 20 times", async () => {
    const user = await buyer("invoice-attempts");
    const invoice = randomUUID();
    const number = "VM-2097-000001";
    await h.seed(`
      insert into private.customer_invoices(id,account_id,invoice_number,invoice_year,sequence_number,plan_version_id,slots,
          unit_price_cents,total_cents,description,due_on,issued_by,issue_reason,request_id,seller,buyer_name,buyer_address,buyer_saved_at)
        values(${lit(invoice)},${lit(user.id)},${lit(number)},2097,1,${lit(plan30)},5,${PRICE_30},${5 * PRICE_30},
          'Fixture package invoice',current_date+7,gen_random_uuid(),'Synthetic invoice reason',gen_random_uuid(),'{}'::jsonb,'Fixture Buyer','1 Fixture Street, Johannesburg',now());
      with p as (insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status,created_at)
          select ${lit(user.id)},'plan',${lit(plan30)},${5 * PRICE_30},'ZAR',jsonb_build_object('attempt',n),'failed',now()-make_interval(mins=>60-n)
          from generate_series(1,19) n returning id,(snapshot->>'attempt')::integer as attempt)
        insert into private.customer_invoice_payments(payment_id,invoice_id,attempt) select id,${lit(invoice)},attempt from p;`);
    const pay = () =>
      h.asMember(
        user,
        `select api.start_invoice_payment(${lit(number)},${5 * PRICE_30},true) as r`
      );
    const twentieth = (await pay())[0].r;
    assert.equal(twentieth.reused, false);
    await h.seed(
      `update private.payments set status='failed' where id=${lit(twentieth.payment_id)};`
    );
    await refused(pay(), "PT429", /too many payment attempts/);
  });
});

describe("shared plans and raised slot limits", () => {
  test("LIM-F-manage_plan_member-2: only a paid plan of 2 or more slots is shared", async () => {
    const share = async (capacity) => {
      const owner = await buyer(`share-${capacity}`);
      const plan = await h.one(
        `select id from private.plan_versions where plan_code='individual_30d' and retired_at is null order by version desc limit 1`
      );
      const ent = randomUUID();
      await h.seed(`
        with p as (insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status,fulfillment_status,completed_at,provider)
          values(${lit(owner.id)},'plan',${lit(plan)},6900,'ZAR','{}'::jsonb,'complete','fulfilled',now(),'invoice') returning id)
        insert into private.entitlements(id,owner_id,source,payment_id,slot_capacity,max_photos,max_videos,starts_at,ends_at,status)
          select ${lit(ent)},${lit(owner.id)},'retail_paid',id,${capacity},10,1,now()-interval '1 day',now()+interval '20 days','active' from p;`);
      return h.asMember(
        owner,
        `select api.manage_plan_member(${lit(ent)},'add','nobody-${randomUUID()}@example.invalid')`
      );
    };
    await refused(share(2), "22023", /verified member unavailable/);
    await refused(share(1), "42501", /shared plan unavailable/);
  });

  describe("LIM-F-staff_set_individual_slot_limit-4 and LIM-F-staff_set_individual_slot_limit-5: above 4 slots needs a checked business, and stores the raise", () => {
    test("a raise above 4", async () => {
      const lead = await h.staff("raise-lead");
      const set = (person, limit) =>
        h.asStaff(
          lead,
          `select api.staff_set_individual_slot_limit(${lit(person.id)},${limit},${
            limit > 4 ? "now()+interval '30 days'" : "null"
          },'Synthetic slot reason') as r`
        );
      const unchecked = await buyer("raise-unchecked");
      await refused(set(unchecked, 5), "PT409", /more than 4 slots need a checked business/);
      // At 4 no business is needed and nothing is stored.
      assert.equal((await set(unchecked, 4))[0].r.slot_limit, 4);
      const stored = (person) =>
        h.one(
          `select count(*)::integer from private.individual_slot_limits where account_id=$1 and revoked_at is null`,
          [person.id]
        );
      assert.equal(await stored(unchecked), 0);
      const checked = await buyer("raise-checked");
      await businessPost(h, checked);
      assert.equal((await set(checked, 5))[0].r.slot_limit, 5);
      assert.equal(await stored(checked), 1);
    });
  });
});

describe("Ozow refund sends", () => {
  test("LIM-F-claim_ozow_refund_send: an unanswered refund is sent at most 3 times", async () => {
    const owner = await h.member("refund-send");
    const claim = async (attempts) =>
      (
        await h.asService(
          `select api.claim_ozow_refund_send(${lit(await sentRefund(h, owner, attempts))}) as r`
        )
      )[0].r;
    const second = await claim(2);
    assert.deepEqual([second.claimed, second.attempt], [true, 3]);
    assert.equal((await claim(3)).claimed, false);
  });

  test("LIM-F-list_ozow_refund_sends_due-2: a refund is listed for sending until it was sent 3 times", async () => {
    const owner = await h.member("refund-due");
    const two = await sentRefund(h, owner, 2);
    const three = await sentRefund(h, owner, 3);
    const due = (await h.asService(`select api.list_ozow_refund_sends_due(20) as r`))[0].r;
    assert.ok(due.includes(two));
    assert.ok(!due.includes(three));
  });

  test("LIM-F-claim_ozow_refund_checks-2: an unanswered refund is checked at Ozow only after its 3rd send", async () => {
    const owner = await h.member("refund-check");
    const two = await sentRefund(h, owner, 2);
    const three = await sentRefund(h, owner, 3);
    const checked = [];
    for (let n = 0; n < 10; n += 1) {
      const rows = (await h.asService(`select api.claim_ozow_refund_checks(20) as r`))[0].r;
      if (!rows.length) break;
      checked.push(...rows.map((row) => row.request_id));
    }
    assert.ok(checked.includes(three));
    assert.ok(!checked.includes(two));
  });

  test("LIM-F-record_ozow_refund_send: an unknown outcome after the 3rd send is stuck", async () => {
    const owner = await h.member("refund-record");
    const record = async (attempts) =>
      (
        await h.asService(
          `select api.record_ozow_refund_send(${lit(await sentRefund(h, owner, attempts))},${json({ outcome: "unknown" })}) as r`
        )
      )[0].r.outcome;
    assert.equal(await record(2), "unchanged");
    assert.equal(await record(3), "stuck");
  });
});
