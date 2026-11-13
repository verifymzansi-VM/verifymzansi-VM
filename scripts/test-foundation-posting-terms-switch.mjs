#!/usr/bin/env node
// Behaviour checks for 20261112173841_switch_posting_terms_v4.sql: posting-v4
// becomes the current posting terms and every plan on sale is taken off sale
// (owner decision of 12 November 2026: paid plans pause until the R69 checkout).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. A member holds a slot granted before the switch (written directly, as
// the lifecycle suites do; the switch never reads entitlements). The script
// runs the read-only preflight, checks the refusals, applies the update and checks that posting-v4
// is current, nothing can be bought, the public catalogue lists no plan, the
// paid slot and the free posting paths are untouched, that neither the update
// nor its rollback overwrites a later change to internal.set_post_media, and
// that apply ->
// rollback -> apply puts exactly the same plans back on sale and returns the
// schema fingerprint to the same values each time.
//
//   node --import tsx scripts/test-foundation-posting-terms-switch.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  createChecks,
  sqlHelpers,
  updateCheckViews,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261112173841_switch_posting_terms_v4.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const CATALOGUE = JSON.parse(readFileSync("src/lib/legal/terms-documents/catalogue.json", "utf8"));
const V3 = { version: "posting-v3", document_hash: CATALOGUE.versions["posting-v3"] };
const V4 = { version: "posting-v4", document_hash: CATALOGUE.versions["posting-v4"] };

const { check, current, passed: checks } = createChecks();

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const { run, q, json, fails, member } = sqlHelpers(database, current);
  const views = updateCheckViews(database, current, { preflight: PREFLIGHT });
  const { fingerprint, syntheticMember: user } = views;
  const preflight = views.preflightRows;

  const currentTerms = () =>
    json(
      "select jsonb_build_object('version',v.version,'document_hash',v.document_hash) from private.posting_terms_current c join private.posting_terms_versions v using(version) where c.singleton;"
    );
  /** Plan versions on sale with the state the rollback must restore. */
  const onSale = () =>
    json(
      "select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',plan_code,'version',version,'price',price_cents) order by plan_code,version),'[]') from private.plan_versions where is_public and retired_at is null;"
    );
  const catalogue = () => json("set role anon;\nselect api.billing_catalogue();");
  const quoteSql = (owner, product) =>
    member(owner, `select api.start_checkout('${product}',null);`);
  const entitlementCount = () =>
    q("select count(*) from private.entitlements where status='active';");

  // ------------------------------------------------------------ before
  const buyer = user("buyer");
  const before = fingerprint();
  const sellingBefore = onSale();
  let paidSlot;
  await check("before the update: posting-v3 is current and the old plans are on sale", () => {
    assert.deepEqual(currentTerms(), V3);
    assert.ok(sellingBefore.length >= 9, `${sellingBefore.length} plans on sale`);
    assert.ok(sellingBefore.some((plan) => plan.code === "market_30d" && plan.price === 5000));
    assert.equal(catalogue().plans.length, sellingBefore.length);
    // A member who holds a slot from before the switch.
    paidSlot =
      q(`insert into private.entitlements (owner_id, source, area, granted_by, slot_capacity, starts_at,
        ends_at, activations_per_period, max_photos, max_videos, status)
      values ('${buyer.id}', 'staff_grant', 'market', '${buyer.id}', 1, now(), now() + interval '30 days',
        10, 10, 1, 'active') returning id;`).split("\n")[0];
    assert.match(paidSlot, /^[0-9a-f-]{36}$/);
  });
  const activeBefore = entitlementCount();
  await check("preflight: read only, summary only, before the update", () => {
    assertReadOnlyPreflight(database, PREFLIGHT);
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      `current posting-v3 (update not applied); plans on sale: ${sellingBefore.length}; plans taken off sale by the update: 0; pending plan payments: 0`
    );
  });
  await check("the update refuses an unexpected current version and changes nothing", () => {
    q(`update private.posting_terms_current set version='posting-v1' where singleton;`);
    assert.match(preflight()[1][1], /current posting terms are posting-v1, expected posting-v3/);
    fails(step.sql, "55000", /expected posting-v3/);
    q(`update private.posting_terms_current set version='posting-v3' where singleton;`);
    assert.deepEqual(onSale(), sellingBefore, "nothing was taken off sale");
    assert.equal(fingerprint(), before);
  });
  await check("a rollback before the update changes nothing", () => {
    applySteps(database, [{ label: "switch rollback before", sql: ROLLBACK }]);
    assert.deepEqual(currentTerms(), V3);
    assert.deepEqual(onSale(), sellingBefore);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  applySteps(database, [step]);
  const after = fingerprint();

  await check("after the update: posting-v4 is current and nothing is on sale", () => {
    assert.deepEqual(currentTerms(), V4);
    assert.deepEqual(onSale(), []);
    assert.deepEqual(catalogue().plans, []);
    // Add-on versions are untouched (the website keeps add-on sales paused).
    assert.ok(catalogue().addons.length >= 3);
    assert.equal(
      q("select count(*) from private.plan_sale_pauses where reason='posting_terms_v4_switch';"),
      String(sellingBefore.length)
    );
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      `current posting-v4 (update already applied); plans on sale: 0; plans taken off sale by the update: ${sellingBefore.length}; pending plan payments: 0`
    );
    // The record table is private: no API role can read or change it.
    for (const role of ["anon", "authenticated", "service_role"])
      fails(`set role ${role};\nselect count(*) from private.plan_sale_pauses;`, "42501");
  });
  await check("nobody can buy an old plan; paid slots already held are untouched", () => {
    const late = user("late");
    for (const plan of sellingBefore)
      fails(quoteSql(late, plan.id), "22023", /product not available/);
    assert.equal(entitlementCount(), activeBefore);
    assert.equal(
      q(`select status from private.entitlements where id='${paidSlot}';`),
      "active",
      "the paid slot keeps running"
    );
    // Catalogue rows are history: still immutable after the switch.
    fails(
      `update private.plan_versions set retired_at=null where id='${sellingBefore[0].id}';`,
      "23514"
    );
    fails(`delete from private.plan_versions where id='${sellingBefore[0].id}';`, "23514");
  });
  await check("a draft without a slot still adds up to 10 photos (the free first post)", () => {
    const poster = user("free-poster");
    // The post and its listing details go in together (a deferred detail check).
    const draft =
      q(`with post as (insert into private.posts(owner_id,kind,area,category_key,activity_key,title,
        description,province_id,city_id)
      values('${poster.id}','listing','market','other_items',(select a.key from private.category_activities a
        join private.categories c on c.key=a.category_key where a.category_key='other_items' and c.activity_required
        order by a.key limit 1),'Fixture free post','A synthetic description long enough for every rule.','gp',
        'gp_johannesburg') returning id),
      details as (insert into private.listing_details(post_id,price_mode,price_cents)
        select id,'amount',12000 from post)
      select id from post;`).split("\n")[0];
    const media = (kind, mime) =>
      q(`insert into private.media_objects(owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
        values('${poster.id}','${kind}','media/'||gen_random_uuid(),1024,1024,
          encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),'${mime}',800,600,'ready') returning id;`).split(
        "\n"
      )[0];
    const photos = Array.from({ length: 10 }, () => media("image", "image/jpeg"));
    const items = (list) => JSON.stringify(list);
    const set = (list) =>
      member(poster, `select api.set_post_media('${draft}',1,'${items(list)}'::jsonb);`);
    const allowed = [
      { object_id: photos[0], purpose: "cover", position: 0 },
      ...photos.slice(1).map((id, i) => ({ object_id: id, purpose: "gallery", position: i + 1 })),
    ];
    assert.equal(json(set(allowed)).revision, 2);
    // The free first post's allowance: 10 photos.
    const extra = media("image", "image/jpeg");
    fails(
      member(
        poster,
        `select api.set_post_media('${draft}',2,'${items([...allowed, { object_id: extra, purpose: "gallery", position: 10 }])}'::jsonb);`
      ),
      "22023",
      /exceed the current post allowance/
    );
  });
  await check("members accept posting-v4 once; posting-v3 acceptance no longer counts", () => {
    const asked = json(member(buyer, "select api.get_owner_posting_terms();"));
    assert.equal(asked.version, "posting-v4");
    assert.equal(asked.accepted_at, null);
    fails(
      member(buyer, `select api.accept_posting_terms('${V3.version}','${V3.document_hash}');`),
      "PT409",
      /posting terms changed/
    );
    const accepted = json(
      member(buyer, `select api.accept_posting_terms('${V4.version}','${V4.document_hash}');`)
    );
    assert.equal(accepted.version, "posting-v4");
  });
  await check("running the update again changes nothing, and never retires later plans", () => {
    applySteps(database, [step]);
    assert.equal(fingerprint(), after);
    // A plan published after the switch (as the R69 checkout will) stays on sale.
    const later =
      q(`insert into private.plan_versions (plan_code, version, area, label, price_cents, duration_days,
        slot_capacity, activations_per_period, max_photos, max_videos)
      values ('individual_test_30d', 1, null, 'Synthetic individual slot', 6900, 30, 1, 4, 10, 1) returning id;`).split(
        "\n"
      )[0];
    applySteps(database, [step]);
    assert.deepEqual(
      onSale().map((plan) => plan.id),
      [later]
    );
    // The rollback refuses while a plan published after the switch is on sale.
    const refused = run(ROLLBACK);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /plans published after the switch are on sale/);
    q(`update private.plan_versions set retired_at=now() where id='${later}';`);
    assert.deepEqual(onSale(), []);
  });
  await check("neither the update nor the rollback overwrites a later set_post_media", () => {
    // A later update (P2, say) changes internal.set_post_media.
    const edit = (from, to) =>
      q(`do $$begin execute replace(pg_get_functiondef('internal.set_post_media(uuid,integer,jsonb)'::regprocedure),
        '${from}','${to}'); end$$;`);
    edit("rev integer;", "rev integer; later_update integer;");
    const changed = fingerprint();
    assert.notEqual(changed, after, "the fixture changed the function");
    fails(step.sql, "55000", /set_post_media is not the reviewed body/);
    fails(
      ROLLBACK,
      "55000",
      /set_post_media was changed after the switch \([0-9a-f]{32}\); undo that update first/
    );
    assert.equal(fingerprint(), changed, "both refused without a change");
    assert.deepEqual(currentTerms(), V4);
    assert.deepEqual(onSale(), []);
    edit("rev integer; later_update integer;", "rev integer;");
    assert.equal(fingerprint(), after);
  });
  await check("apply -> rollback -> apply puts exactly the same plans back each time", () => {
    applySteps(database, [{ label: "switch rollback", sql: ROLLBACK }]);
    assert.deepEqual(currentTerms(), V3);
    assert.deepEqual(onSale(), sellingBefore, "the same plan versions are on sale again");
    assert.equal(q("select to_regclass('private.plan_sale_pauses') is null;"), "t");
    assert.equal(fingerprint(), before, "the rollback leaves the pre-update schema");
    applySteps(database, [{ label: "switch rollback again", sql: ROLLBACK }]);
    assert.deepEqual(onSale(), sellingBefore, "a repeated rollback changes nothing");
    applySteps(database, [step]);
    assert.deepEqual(currentTerms(), V4);
    assert.deepEqual(onSale(), []);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
    // The guard is back on after the rollback switched it off for one statement.
    fails(
      `update private.plan_versions set retired_at=null where id='${sellingBefore[0].id}';`,
      "23514"
    );
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep posting-v4 current", () => {
      assert.deepEqual(currentTerms(), V4);
    });
  }
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Posting terms switch checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
