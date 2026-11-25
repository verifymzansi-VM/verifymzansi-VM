#!/usr/bin/env node
// Behaviour checks for 20261125044115_retire_paid_addons.sql (launch checklist
// item 37): the three add-on versions are retired, api.start_checkout then
// refuses every former add-on, and the public price list, the member's billing
// and My posts no longer return add-on fields; every other field is unchanged.
// Add-on payments already on record stay readable, a pending one still
// expires and a completed one can still be refunded.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. One synthetic member holds a slot, a post, a completed Urgent payment
// with its running window and an unpaid Boost checkout, written directly as
// the database owner (no add-on can be bought through the website). Members
// call as `authenticated` with synthetic claims and a live session row; the
// payment jobs call as `service_role`. The script runs the update's read-only
// preflight, checks its refusals, applies it, checks the rules, and proves
// apply -> rollback -> apply returns the same fingerprints. Any later updates
// are applied at the end.
//
//   node --import tsx scripts/test-foundation-retire-paid-addons.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertDriftRefused,
  assertReadOnlyPreflight,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261125044115_retire_paid_addons.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const CATALOGUE = "internal.billing_catalogue()";
const BILLING = "internal.get_my_billing()";
const POST_MANAGER = "internal.get_my_frontend_post_manager()";
const REVIEWED = {
  [CATALOGUE]: "f0c5673fcf9b37b603eac1866472e3d8",
  [BILLING]: "8c89e002e759c1f5a7c47f92ce465990",
  [POST_MANAGER]: "bf4e28d6a385e6823983ccb93f7315ad",
};
const UPDATED = {
  [CATALOGUE]: "9b88a341204050c9f58dbae7001beb7b",
  [BILLING]: "d5a162ab5bd63b0fed7d6aa0e1a45600",
  [POST_MANAGER]: "ee13e414005ffc5cdf6d4f1ba648ebfe",
};
const summary = (state, onSale, pending, complete, reversed, other, windows) =>
  `retire paid add-ons: ${state}; add-on versions on sale: ${onSale}; add-on payments: pending ${pending}, complete ${complete}, refunded or charged back ${reversed}, other ${other}; add-on windows running: ${windows}`;

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
  service,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  // ------------------------------------------------------------ the world
  const thando = syntheticMember("thando");
  const addon = (kind) =>
    q(`select id from private.addon_versions where kind='${kind}' and version=1;`);
  const [boost, featured, urgent] = ["boost", "featured", "urgent"].map(addon);
  const world = json(`begin;
    set local session_replication_role=replica;
    with post as (
      insert into private.posts(owner_id,kind,area,category_key,status,title)
      values('${thando.id}','listing','market','other','draft','Synthetic post') returning id),
    slot as (
      insert into private.entitlements(owner_id,source,area,granted_by,slot_capacity,activations_per_period,
        max_photos,max_videos,starts_at,ends_at,addon_capabilities)
      values('${thando.id}','staff_grant','market','${thando.id}',1,4,10,1,now()-interval '1 day',
        now()+interval '30 days','{urgent}') returning id),
    paid as (
      insert into private.payments(owner_id,product_kind,addon_version_id,target_post_id,amount_cents,currency,
        snapshot,status,fulfillment_status,provider_transaction_id,completed_at)
      select '${thando.id}','addon','${urgent}',post.id,1000,'ZAR',
        '{"kind":"addon","addon":"urgent","version":1,"days":7,"price_cents":1000}','complete','fulfilled',
        'tx-synthetic-urgent',now()-interval '1 hour' from post returning id,target_post_id),
    win as (
      insert into private.post_addon_windows(post_id,kind,payment_id,starts_at,ends_at)
      select target_post_id,'urgent',id,now()-interval '1 hour',now()+interval '6 days' from paid returning id),
    unpaid as (
      insert into private.payments(owner_id,product_kind,addon_version_id,target_post_id,amount_cents,currency,
        snapshot,created_at)
      select '${thando.id}','addon','${boost}',post.id,1500,'ZAR',
        '{"kind":"addon","addon":"boost","version":1,"days":7,"price_cents":1500}',now()-interval '2 hours'
      from post returning id)
    select jsonb_build_object('post',(select id from post),'slot',(select id from slot),
      'paid',(select id from paid),'window',(select id from win),'unpaid',(select id from unpaid));
    commit;`);
  const catalogue = () => json("set role anon;\nselect api.billing_catalogue();");
  const billing = () => json(member(thando, "select api.get_my_billing();"));
  const postManager = () => json(member(thando, "select api.get_my_frontend_post_manager();"));
  const payments = () => q("select count(*) from private.payments;");
  const checkoutSql = (product) =>
    member(thando, `select api.start_checkout('${product}','${world.post}');`);

  // ------------------------------------------------------------ before
  let before;
  await check("before the update: reviewed bodies, three add-ons on sale and returned", () => {
    for (const [sig, md5] of Object.entries(REVIEWED)) assert.equal(bodyMd5(sig), md5, sig);
    before = { catalogue: catalogue(), billing: billing(), postManager: postManager() };
    assert.deepEqual(before.catalogue.addons.map((a) => a.kind).sort(), [
      "boost",
      "featured",
      "urgent",
    ]);
    assert.ok(before.catalogue.plans.length > 0);
    for (const plan of before.catalogue.plans) assert.ok(Array.isArray(plan.addon_capabilities));
    const slot = before.billing.entitlements.find((e) => e.id === world.slot);
    assert.deepEqual(slot.addon_capabilities, ["urgent"]);
    assert.equal(before.postManager.addons.length, 1);
    assert.equal(before.postManager.addons[0].post_id, world.post);
    assert.ok(before.postManager.addons[0].urgent_until);
    // The add-on checkout still reads the version (and then refuses the draft).
    fails(checkoutSql(urgent), "22023", /add-ons apply to your own live post/);
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(rows[0][1], summary("update not applied", 3, 1, 1, 0, 0, 1));
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () =>
    assertDriftRefused(
      { q, fails, fingerprint, preflightRows: preflight },
      {
        rollback: ROLLBACK,
        updateSql: step.sql,
        signatures: [CATALOGUE, BILLING, POST_MANAGER],
        drift: /retire paid add-ons drift/,
      }
    )
  );
  await check("nothing was retired by the refused attempts", () => {
    assert.equal(q("select count(*) from private.addon_versions where retired_at is null;"), "3");
  });

  // ------------------------------------------------------------- apply
  await check("apply -> rollback -> apply: same fingerprints, preflight summary", () =>
    applyWithRollbackCheck(database, {
      step,
      rollback: ROLLBACK,
      label: "retire paid add-ons",
      fingerprint,
      preflightRows: preflight,
      appliedSummary: new RegExp(`^${summary("already applied", 0, 1, 1, 0, 0, 1)}$`),
    })
  );
  await check("after the update: the update's bodies, every add-on version retired once", () => {
    for (const [sig, md5] of Object.entries(UPDATED)) assert.equal(bodyMd5(sig), md5, sig);
    assert.equal(q("select count(*) from private.addon_versions;"), "3");
    assert.equal(q("select count(*) from private.addon_versions where retired_at is null;"), "0");
    assert.equal(q("select count(distinct retired_at) from private.addon_versions;"), "1");
    fails(
      "update private.addon_versions set retired_at=null;",
      "23514",
      /catalogue versions are immutable/
    );
  });
  await check("the public price list: no add-ons, plans otherwise unchanged", () => {
    const after = catalogue();
    assert.deepEqual(Object.keys(after), ["plans"]);
    assert.deepEqual(
      after.plans,
      before.catalogue.plans.map(({ addon_capabilities: _dropped, ...plan }) => plan)
    );
  });
  await check("the member's billing: no add-on capabilities, otherwise unchanged", () => {
    const after = billing();
    assert.deepEqual(after, {
      ...before.billing,
      entitlements: before.billing.entitlements.map(
        ({ addon_capabilities: _dropped, ...slot }) => slot
      ),
    });
    // The completed add-on payment is still shown.
    const paid = after.payments.find((p) => p.id === world.paid);
    assert.equal(paid.product_kind, "addon");
    assert.equal(paid.label, "Urgent add-on");
  });
  await check("My posts: no add-on dates, otherwise unchanged", () => {
    const { addons: _dropped, ...rest } = before.postManager;
    assert.deepEqual(postManager(), rest);
  });
  await check("api.start_checkout refuses every former add-on and records nothing", () => {
    const count = payments();
    for (const product of [boost, featured, urgent])
      fails(checkoutSql(product), "22023", /product not available/);
    assert.equal(payments(), count);
  });
  await check("the unpaid add-on checkout still expires", () => {
    assert.equal(json(service("select to_jsonb(api.expire_stale_checkouts(100));")), 1);
    assert.equal(q(`select status from private.payments where id='${world.unpaid}';`), "expired");
  });
  await check("the completed add-on payment can still be refunded", () => {
    const refunded = json(
      service(`select api.reverse_payment('${world.paid}','refunded','Synthetic refund check');`)
    );
    assert.equal(refunded.status, "refunded");
    assert.equal(
      q(
        `select revoked_at is not null from private.post_addon_windows where id='${world.window}';`
      ),
      "t"
    );
    assert.equal(preflight()[0][1], summary("already applied", 0, 0, 0, 1, 1, 0));
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the add-ons retired and out of the replies", () => {
      assert.equal(q("select count(*) from private.addon_versions where retired_at is null;"), "0");
      assert.equal("addons" in catalogue(), false);
      assert.equal("addons" in postManager(), false);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Retire paid add-ons checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
