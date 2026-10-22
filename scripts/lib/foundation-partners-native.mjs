import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import {
  decideFoundationCommission,
  readFoundationPartnerDashboard,
  recordFoundationAcquisition,
  saveFoundationPartner,
} from "../../src/lib/foundation/partners.ts";
import {
  createPostingVerifier,
  createTrustedPostingFixture,
} from "./foundation-trusted-posting-fixture.mjs";

// Synthetic local proof of partner attribution and commissions following
// real local checkout, settlement and refund commands.
export async function testPartners({
  createUser,
  rpc,
  sql,
  sqlFails,
  record,
  connection,
  fixtureAdminId,
  stage,
}) {
  stage("partners staff and people");
  const reviewer = await createPostingVerifier({ createUser, sql, fixtureAdminId });
  const fixture = createTrustedPostingFixture({ rpc, sql, reviewer });
  const commercial = await createPostingVerifier({
    createUser,
    sql,
    fixtureAdminId,
    role: "admin",
    label: "partner-staff",
  });
  const partnerUser = await createUser("partner-main");
  const unverified = await createUser("partner-unver");
  const buyer = await createUser("partner-buyer");
  const late = await createUser("partner-late");
  await fixture.ready(partnerUser);
  const typed = (user) => createFoundationAuthenticatedApi(connection, user.token);
  const call = async (name, body, user, service = false) => {
    const response = await rpc(name, body, user?.token ?? null, service);
    assert.equal(response.status, 200, "partner fixture " + name);
    return response.data;
  };
  const asStaff = async () => typed(await commercial.refresh());
  const refusedWith = (reason) => (error) =>
    // Compared by name: tsx may load the shared module twice, defeating instanceof.
    error?.name === "Error" &&
    String(error.message).startsWith("Foundation organisation request failed") &&
    error.reason === reason;
  const reason = "Synthetic partner programme setup";
  const code = "SYN" + randomBytes(3).toString("hex").toUpperCase();

  stage("partners staff management");
  await reviewer.refresh();
  await assert.rejects(
    saveFoundationPartner(typed(reviewer), {
      account_id: partnerUser.id,
      action: "create",
      code,
      reason,
    }),
    refusedWith("forbidden")
  );
  await assert.rejects(
    saveFoundationPartner(await asStaff(), {
      account_id: commercial.id,
      action: "create",
      code,
      reason,
    }),
    refusedWith("forbidden")
  );
  const partner = await saveFoundationPartner(await asStaff(), {
    account_id: partnerUser.id,
    action: "create",
    code,
    reason,
  });
  assert.deepEqual([partner.status, partner.commission_bps], ["pending", null]);
  await assert.rejects(
    saveFoundationPartner(await asStaff(), {
      account_id: partnerUser.id,
      action: "create",
      code,
      reason,
    }),
    refusedWith("conflict")
  );
  await assert.rejects(
    saveFoundationPartner(await asStaff(), {
      account_id: unverified.id,
      action: "create",
      code,
      reason,
    }),
    refusedWith("conflict")
  );
  await saveFoundationPartner(await asStaff(), {
    account_id: unverified.id,
    action: "create",
    code: code + "U",
    reason,
  });
  await assert.rejects(
    saveFoundationPartner(await asStaff(), {
      account_id: unverified.id,
      action: "activate",
      reason,
    }),
    refusedWith("verification_required")
  );
  assert.equal(
    (
      await saveFoundationPartner(await asStaff(), {
        account_id: partnerUser.id,
        action: "activate",
        reason,
      })
    ).status,
    "active"
  );
  record("native-partner-staff-only-no-self-unique-code-and-verified-activation");

  stage("partners first-touch attribution");
  const attribute = (user, extra = {}) =>
    recordFoundationAcquisition(typed(user), { partner_code: code.toLowerCase(), ...extra });
  assert.deepEqual(await attribute(partnerUser), { source: "direct", recorded: true });
  const invalid = await rpc(
    "record_my_acquisition",
    { p_utm: { utm_source: "ok", tracking_id: "x" } },
    buyer.token
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.details, "acquisition_invalid");
  assert.deepEqual(
    await attribute(buyer, { utm: { utm_source: "flyer" }, landing_path: "/pricing" }),
    { source: "partner", recorded: true }
  );
  assert.deepEqual(await attribute(buyer, { source: "social" }), {
    source: "partner",
    recorded: false,
  });
  sql(
    "update auth.users set created_at=statement_timestamp()-interval '8 days' where id='" +
      late.id +
      "';"
  );
  assert.deepEqual(await attribute(late), { source: null, recorded: false });
  assert.equal(
    sql("select count(*) from private.account_acquisitions where account_id='" + late.id + "';"),
    "0"
  );
  record("native-partner-attribution-first-touch-no-self-referral-seven-day-window");

  stage("partners commission follows settlement");
  const plan = JSON.parse(
    sql(
      "select jsonb_build_object('id',id,'amount',price_cents) from private.plan_versions where retired_at is null and is_public order by price_cents,id limit 1;"
    )
  );
  const payment = await call("start_checkout", { p_product_id: plan.id }, buyer);
  const prefix = "partner-" + randomBytes(4).toString("hex");
  await call(
    "attach_provider_request",
    { p_payment_id: payment.payment_id, p_request_id: prefix + "-request" },
    null,
    true
  );
  await call(
    "apply_provider_event",
    {
      p_event: {
        payload_sha256: createHash("sha256").update(prefix).digest("hex"),
        merchant_reference: payment.merchant_reference,
        provider_request_id: prefix + "-request",
        provider_transaction_id: prefix + "-txn",
        status: "complete",
        amount_cents: plan.amount,
        currency: "ZAR",
      },
    },
    null,
    true
  );
  const commission = JSON.parse(
    sql(
      "select jsonb_build_object('id',id,'amount',amount_cents,'rate',rate_bps,'status',status,'due',eligible_at>statement_timestamp()+interval '29 days') from private.partner_commissions where payment_id='" +
        payment.payment_id +
        "';"
    )
  );
  assert.deepEqual(
    [commission.rate, commission.amount, commission.status, commission.due],
    [2000, Math.floor((plan.amount * 2000) / 10000), "pending", true]
  );
  let dashboard = await readFoundationPartnerDashboard(typed(partnerUser));
  assert.deepEqual([dashboard.referrals, dashboard.paying_referrals], [1, 1]);
  assert.equal(dashboard.totals.pending, String(commission.amount));
  for (const hidden of [buyer.id, payment.payment_id, payment.merchant_reference])
    assert.equal(JSON.stringify(dashboard).includes(hidden), false);
  assert.equal(await readFoundationPartnerDashboard(typed(buyer)), null);
  record("native-partner-commission-on-settlement-and-referral-blind-dashboard");

  stage("partners approval, payout and reversal");
  const decide = async (body) => decideFoundationCommission(await asStaff(), body);
  await assert.rejects(
    decide({ commission_id: commission.id, action: "approve", reason }),
    refusedWith("conflict")
  );
  assert.equal(await call("approve_due_commissions", { p_limit: 100 }, null, true), 0);
  sqlFails(
    "update private.partner_commissions set amount_cents=amount_cents+1 where id='" +
      commission.id +
      "';",
    "23514"
  );
  // Synthetic clock only: the 30-day hold is moved, nothing else.
  sql(
    "alter table private.partner_commissions disable trigger partner_commissions_guard; update private.partner_commissions set eligible_at=statement_timestamp()-interval '1 second' where id='" +
      commission.id +
      "'; alter table private.partner_commissions enable trigger partner_commissions_guard;"
  );
  assert.equal(await call("approve_due_commissions", { p_limit: 100 }, null, true), 1);
  assert.equal(
    sql(
      "select count(*) from private.notifications where account_id='" +
        partnerUser.id +
        "' and kind='partner_commission_approved';"
    ),
    "1"
  );
  const noReference = await rpc(
    "staff_decide_commission",
    { p_commission: commission.id, p_action: "mark_paid", p_reason: reason },
    (await commercial.refresh()).token
  );
  assert.equal(noReference.status, 400);
  assert.equal(noReference.data.details, "commission_invalid");
  assert.equal(
    (
      await decide({
        commission_id: commission.id,
        action: "mark_paid",
        reference: "EFT synthetic 0001",
        reason,
      })
    ).status,
    "paid"
  );
  await call(
    "reverse_payment",
    {
      p_payment_id: payment.payment_id,
      p_kind: "refunded",
      p_reason: "Synthetic refund for partner proof",
    },
    null,
    true
  );
  assert.equal(
    sql(
      "select status||':'||reversal_reason||':'||(paid_at is not null) from private.partner_commissions where id='" +
        commission.id +
        "';"
    ),
    "reversed:Payment refunded:true"
  );
  assert.equal(
    sql(
      "select count(*) from private.notifications where account_id='" +
        partnerUser.id +
        "' and kind='partner_commission_reversed';"
    ),
    "1"
  );
  await assert.rejects(
    decide({ commission_id: commission.id, action: "reverse", reason }),
    refusedWith("conflict")
  );
  dashboard = await readFoundationPartnerDashboard(typed(partnerUser));
  assert.equal(dashboard.paying_referrals, 0);
  sqlFails(
    "update private.partner_events set reason='changed' where partner_id='" + partner.id + "';",
    "23514"
  );
  const listed = await rpc(
    "staff_list_commissions",
    { p_status: "reversed" },
    (await commercial.refresh()).token
  );
  assert.equal(listed.status, 200);
  assert.ok(listed.data.some((x) => x.id === commission.id));
  for (const role of [reviewer])
    assert.equal((await rpc("staff_list_partners", {}, (await role.refresh()).token)).status, 403);
  record("native-partner-due-approval-recorded-payout-refund-reversal-and-append-only-audit");
}
