#!/usr/bin/env node
// Behaviour checks for 20261121090305_staff_sales_and_vat.sql: the staff read
// api.get_staff_sales_summary() (rolling 12-month sales net of refunds, the
// VAT alert at R1.8 million, sales by product and term, online checkouts of
// the last 30 days), the public read api.get_vat_registration() (the VAT
// setting only), and the daily payment summary's new 'sales' field.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Staff and members are Auth rows written as the database owner; the
// payments are synthetic rows written directly as the database owner (with
// triggers off). The script runs the update's read-only preflight, checks its
// refusals, applies it, checks the rules, and proves apply -> rollback ->
// apply returns the same fingerprints. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-staff-sales-and-vat.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertDriftRefused,
  assertReadOnlyPreflight,
  executeGrants,
  installStaffPaymentWorld,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261121090305_staff_sales_and_vat.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const READ = "api.get_staff_sales_summary()";
const PUBLIC = "api.get_vat_registration()";
const DIGEST = "internal.claim_payment_digest(integer,integer)";
const HELPERS = ["internal.payment_net_cents(private.payments)", "internal.vat_sales_position()"];
const NOBODY = { anon: false, authenticated: false, service_role: false };
const PLANS = {
  individual_30d: "d6ca48e5-43be-40df-8d8c-72c98a6fda96",
  individual_90d: "6a449457-2384-457e-9434-23c2b0e73127",
  slot_package_90d: "8c3e1a52-6f0b-4d29-a7c4-2b9e5d1f7a33",
};
const BOOST = "7a8e430b-5d1f-4f3c-a207-b87bad2302cc";

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  fails,
  member,
  staff,
  service,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const world = installStaffPaymentWorld(q, json);
  const admin = world.staffUser("sales-admin", "admin");
  const moderator = world.staffUser("sales-moderator", "moderator");
  const someone = world.user("sales-member");
  const buyers = Array.from({ length: 6 }, (_, i) => world.user(`sales-buyer-${i}`));
  const read = (who = admin, totpAt) => json(staff(who, `select ${READ};`, totpAt));

  /**
   * A synthetic payment written as the database owner (triggers off):
   * `paidDaysAgo` sets completed_at for paid statuses, `createdDaysAgo` its
   * start. Returns the payment id.
   */
  const pay = ({
    buyer,
    plan,
    addon,
    cents,
    status = "complete",
    provider = "ozow",
    createdDaysAgo = 1,
    paidDaysAgo = createdDaysAgo,
    // Sent to Ozow (it has an Ozow request); false for a checkout replaced
    // before it reached Ozow.
    sent = provider === "ozow",
  }) => {
    const paid = ["complete", "refunded", "chargeback"].includes(status);
    const fulfilled = status === "complete" ? "fulfilled" : paid ? "reversed" : "unfulfilled";
    return q(`set session_replication_role = replica;
      insert into private.payments(owner_id, product_kind, plan_version_id, addon_version_id, target_post_id,
          amount_cents, currency, snapshot, status, fulfillment_status, provider, provider_request_id,
          provider_transaction_id, created_at, completed_at)
        values ('${buyer.id}', ${addon ? "'addon'" : "'plan'"}, ${plan ? `'${plan}'` : "null"},
          ${addon ? `'${addon}'` : "null"}, ${addon ? "gen_random_uuid()" : "null"}, ${cents}, 'ZAR', '{}',
          '${status}', '${fulfilled}', '${provider}', ${sent ? "'req-'||gen_random_uuid()" : "null"},
          ${paid && provider === "ozow" ? "'tx-'||gen_random_uuid()" : "null"},
          now() - interval '${createdDaysAgo} days',
          ${paid ? `now() - interval '${paidDaysAgo} days'` : "null"})
        returning id;`)
      .split("\n")
      .find((line) => /^[0-9a-f-]{36}$/.test(line));
  };
  /** Payment lines of `payment` at `cents` each; the first `reversed` are refunded. */
  const lines = (payment, plan, cents, count, reversed) => {
    for (let n = 1; n <= count; n += 1)
      q(`set session_replication_role = replica;
        insert into private.payment_lines(payment_id, line_number, plan_version_id, amount_cents, status,
          reversal_kind, reversal_reason, reversed_at)
        values ('${payment}', ${n}, '${plan}', ${cents}, ${n <= reversed ? "'reversed'" : "'open'"},
          ${n <= reversed ? "'refunded', 'Synthetic slot refund', now()" : "null, null, null"});`);
  };

  // ------------------------------------------------------------ before
  await check("before the update: none of its functions exist", () => {
    for (const sig of [READ, PUBLIC, ...HELPERS]) assert.equal(bodyMd5(sig), "missing", sig);
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(rows[0][1], "staff sales and VAT: update not applied");
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("a drifted summary command and a premature rollback are refused", () =>
    assertDriftRefused(
      { q, fails, fingerprint, preflightRows: preflight },
      {
        rollback: ROLLBACK,
        updateSql: step.sql,
        signatures: [DIGEST],
        drift: /staff sales drift: internal\.claim_payment_digest is not the reviewed body/,
      }
    )
  );

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "staff sales and VAT",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: /^staff sales and VAT: already applied; VAT setting: not_registered$/,
  });

  await check("who may run what", () => {
    const grants = executeGrants(json, [READ, PUBLIC, ...HELPERS, DIGEST]);
    assert.deepEqual(grants[READ], { anon: false, authenticated: true, service_role: false });
    assert.deepEqual(grants[PUBLIC], { anon: true, authenticated: true, service_role: false });
    for (const sig of HELPERS) assert.deepEqual(grants[sig], NOBODY, sig);
    assert.deepEqual(grants[DIGEST], { anon: false, authenticated: false, service_role: true });
  });

  await check("the rollback refuses while another function uses what it drops", () => {
    q(`create function vmtest.uses_sales() returns jsonb language sql as
      $f$ select internal.vat_sales_position() $f$;`);
    assert.match(
      fails(ROLLBACK, "55000"),
      /other functions use what the rollback drops: vmtest\.uses_sales\(\)/
    );
    q(`drop function vmtest.uses_sales();`);
  });

  await check("no sales yet: zero, no alert, the VAT setting, no checkouts", () => {
    const summary = read();
    assert.deepEqual(Object.keys(summary).sort(), ["checkouts", "products", "vat"]);
    assert.deepEqual(Object.keys(summary.vat).sort(), [
      "alert",
      "alert_cents",
      "compulsory_cents",
      "net_cents",
      "payments",
      "vat_status",
    ]);
    assert.equal(summary.vat.net_cents, 0);
    assert.equal(summary.vat.payments, 0);
    assert.equal(summary.vat.vat_status, "not_registered");
    assert.equal(summary.vat.alert_cents, 180000000);
    assert.equal(summary.vat.compulsory_cents, 230000000);
    assert.equal(summary.vat.alert, false);
    assert.deepEqual(summary.products, []);
    assert.deepEqual(summary.checkouts, {
      days: 30,
      started: 0,
      paid: 0,
      failed: 0,
      cancelled: 0,
      expired: 0,
      open: 0,
    });
  });

  // Sales of the last 12 months.
  const [a, b, c, d, e, f] = buyers;
  pay({ buyer: a, plan: PLANS.individual_30d, cents: 6900 });
  // Three slots, one refunded: R138 counts.
  const partial = pay({ buyer: b, plan: PLANS.individual_30d, cents: 20700, createdDaysAgo: 2 });
  lines(partial, PLANS.individual_30d, 6900, 3, 1);
  // A package paid then refunded in full: nothing counts.
  pay({ buyer: c, plan: PLANS.slot_package_90d, cents: 150000, status: "refunded" });
  // Paid by bank transfer 200 days ago: counts, but is not an online checkout.
  pay({
    buyer: d,
    plan: PLANS.individual_90d,
    cents: 20700,
    provider: "invoice",
    createdDaysAgo: 200,
  });
  // An add-on.
  pay({ buyer: e, addon: BOOST, cents: 1500 });
  // Paid 13 months ago: outside the 12 months.
  pay({ buyer: f, plan: PLANS.individual_30d, cents: 6900, createdDaysAgo: 400 });
  // Checkouts that did not end in a payment, one each, and one older than 30 days.
  pay({ buyer: a, plan: PLANS.individual_90d, cents: 20700, status: "failed" });
  pay({ buyer: b, plan: PLANS.individual_90d, cents: 20700, status: "cancelled" });
  pay({ buyer: c, plan: PLANS.individual_90d, cents: 20700, status: "expired" });
  pay({ buyer: d, plan: PLANS.individual_90d, cents: 20700, status: "pending" });
  pay({
    buyer: e,
    plan: PLANS.individual_90d,
    cents: 20700,
    status: "expired",
    createdDaysAgo: 40,
  });

  // Checkouts that never reached Ozow (replaced before they were sent): not
  // counted as started.
  pay({ buyer: f, plan: PLANS.individual_90d, cents: 20700, status: "expired", sent: false });
  pay({ buyer: e, plan: PLANS.individual_30d, cents: 6900, status: "pending", sent: false });

  await check("12-month sales are net of refunds and count on the day paid", () => {
    const { vat } = read();
    // 6900 + (20700 - 6900) + 0 + 20700 + 1500
    assert.equal(vat.net_cents, 42900);
    assert.equal(vat.payments, 5);
    assert.equal(vat.alert, false);
  });

  await check("sales by product and term", () => {
    assert.deepEqual(read().products, [
      { category: "individual", term_days: 30, payments: 2, net_cents: 20700 },
      { category: "individual", term_days: 90, payments: 1, net_cents: 20700 },
      { category: "add_on", term_days: null, payments: 1, net_cents: 1500 },
      { category: "package", term_days: 90, payments: 1, net_cents: 0 },
    ]);
  });

  await check("online checkouts sent to Ozow in the last 30 days and how each ended", () => {
    assert.deepEqual(read().checkouts, {
      days: 30,
      started: 8,
      paid: 4,
      failed: 1,
      cancelled: 1,
      expired: 1,
      open: 1,
    });
  });

  await check("the alert turns on at R1.8 million and off once registered for VAT", () => {
    // One cent short of the alert level, then exactly at it.
    const short = pay({ buyer: f, plan: PLANS.individual_30d, cents: 180000000 - 42900 - 1 });
    assert.equal(read().vat.alert, false);
    q(`set session_replication_role = replica;
      update private.payments set amount_cents = amount_cents + 1 where id = '${short}';`);
    const atAlert = read().vat;
    assert.equal(atAlert.net_cents, 180000000);
    assert.equal(atAlert.alert, true);
    q(`update private.invoice_merchant_config set registration_status = 'registered',
        vat_number = '4123456789', vat_rate_bps = 1500;`);
    assert.equal(read().vat.vat_status, "registered");
    assert.equal(read().vat.alert, false);
    assert.deepEqual(json(`set role anon;\nselect ${PUBLIC};`), {
      status: "registered",
      vat_number: "4123456789",
    });
    q(`update private.invoice_merchant_config set registration_status = 'not_registered',
        vat_number = null, vat_rate_bps = 0;`);
    assert.equal(read().vat.alert, true);
  });

  await check("the daily payment summary carries the same sales figures", () => {
    const digest = json(service(`select ${"api.claim_payment_digest(0, 10)"};`));
    const expected = read().vat;
    assert.equal(digest.sales.net_cents, expected.net_cents);
    assert.equal(digest.sales.alert, true);
    assert.equal(digest.sales.alert_cents, 180000000);
    assert.equal(digest.sales.compulsory_cents, 230000000);
    assert.equal(digest.sales.vat_status, "not_registered");
    // The rest of the summary keeps its fields.
    for (const key of ["day", "claim", "window_start", "window_end", "problems", "outcomes"])
      assert.ok(key in digest, key);
  });

  await check("the public read: the VAT setting only, for visitors and members", () => {
    const expected = { status: "not_registered", vat_number: null };
    assert.deepEqual(json(`set role anon;\nselect ${PUBLIC};`), expected);
    assert.deepEqual(json(member(someone, `select ${PUBLIC};`)), expected);
  });

  await check(
    "only staff with payments:view and an authenticator code of the last 12 hours read the figures",
    () => {
      fails(staff(moderator, `select ${READ};`), "42501", /capability not granted/);
      fails(member(someone, `select ${READ};`), "42501");
      // payments:view is not one of the 15-minute capabilities: a code of the
      // last 12 hours, like every staff command.
      const hoursAgo = (hours) => Math.floor(Date.now() / 1000) - hours * 3600;
      assert.equal(json(staff(admin, `select ${READ};`, hoursAgo(11))).vat.alert, true);
      fails(
        staff(admin, `select ${READ};`, hoursAgo(13)),
        "42501",
        /staff second-factor verification expired/
      );
      fails(service(`select ${READ};`), "42501");
      fails(`set role anon;\nselect ${READ};`, "42501");
      for (const sig of HELPERS)
        fails(member(someone, `select ${sig.replace("private.payments", "null")};`), "42501");
    }
  );

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the sales read", () => {
      assert.equal(read().vat.alert, true);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Staff sales and VAT checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
