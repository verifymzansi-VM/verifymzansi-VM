#!/usr/bin/env node
// Behaviour checks for 20261121131915_business_storefront.sql: a running
// Multi-listing package's live Market listings show on its owner's checked
// business page (search filter 'storefront', with 'make'), and the public read
// api.get_public_storefront names the business for the business and for each
// listing in it.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members are written directly as the database owner (an accepted ID
// review as a synthetic identity fact); a package is bought through the
// package checkout and a synthetic Ozow notice, as the website's server does;
// posts go live through api.activate_post; a CIPC sticker is an approved
// business check written as the owner (with the world's stand-in for the
// owner's ID review). The script checks the read-only preflight, a drifted
// body and a premature rollback, applies the update and proves apply ->
// rollback -> apply, then checks: the grants; which business has a storefront
// (live, current CIPC sticker, package running, the owner's first such
// business) and which has none (no sticker, an expired sticker, no package, a
// later checked business, a package that ended); which listings are in it
// (only live listings holding the package's slots); the read's fields for the
// business and for a listing (never for another post); and every search filter
// inside a storefront, with the 'make' filter's bounds.
//
//   node --import tsx scripts/test-foundation-business-storefront.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { executeGrants, sqlLiteral } from "./lib/foundation-sql-checks.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  buyPackage as buyPackageOf,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261121131915_business_storefront.sql";
const SEARCH = "internal.search_posts(jsonb)";
const READ = "api.get_public_storefront(uuid)";
const HELPERS = [
  "internal.storefront_package(uuid)",
  "internal.storefront_of_post(uuid)",
  "internal.get_public_storefront(uuid)",
];
const NOT_APPLIED =
  /^business storefront: update not applied; running packages: \d+; checked businesses: \d+$/;
const APPLIED =
  /^business storefront: already applied; running packages: \d+; checked businesses: \d+; storefronts: \d+$/;

const SETUP = { update: UPDATE, label: "storefront", title: "Business storefront" };
await runTwoAdminUpdateCheck(SETUP, async ({ database, check, kit, world, admin }) => {
  const { q, json, fails, member, service, preflight } = kit;
  const anon = (sql) => `set role anon;\n${sql}`;

  // ------------------------------------------------------- synthetic world
  // A post of a given category with listing attributes; a CIPC sticker; the
  // owner's ID review as the business checks read it (the world's stand-in).
  q(`create function vmtest.listing(p_owner uuid,p_category text,p_title text,p_attrs jsonb,
        p_province text,p_city text) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); begin
      perform set_config('session_replication_role','replica',true);
      insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id)
        values(pid,p_owner,'listing','market',p_category,p_title,
          'A synthetic description long enough for every rule.',p_province,p_city);
      insert into private.listing_details(post_id,price_mode,price_cents,attributes)
        values(pid,'amount',25000000,p_attrs);
      perform set_config('session_replication_role','origin',true);
      return pid;
    end$$;
    create function vmtest.cipc(p_owner uuid,p_business uuid,p_valid interval) returns uuid language plpgsql as $$
    declare cid uuid:=gen_random_uuid(); begin
      perform set_config('session_replication_role','replica',true);
      insert into private.evidence_cases(id,subject_id,kind,status) values(cid,p_owner,'business','decided');
      insert into private.frontend_business_checks(id,business_id,owner_id,kind,status,decided_at,expires_at)
        values(cid,p_business,p_owner,'cipc','approved',now()-interval '30 days',now()+p_valid);
      insert into private.frontend_cipc_reviews(check_id,registration_number,route,submitted_at)
        values(cid,'2020/'||lpad((abs(hashtext(cid::text))%1000000)::text,6,'0')||'/07','director',now()-interval '31 days');
      perform set_config('session_replication_role','origin',true);
      return cid;
    end$$;
    create or replace function internal.frontend_business_identity_reviewed(p_owner uuid) returns boolean
      language sql stable set search_path to 'pg_catalog' as $fn$
      select internal.current_verified_identity(p_owner) is not null $fn$;`);
  const verified = (label) => world.verified(label, admin);
  const buyPackage = (owner, slots) => buyPackageOf(kit, owner, slots);
  /** The post goes live on the owner's slots, as a moderator's approval does. */
  const live = (owner, id) => {
    json(member(owner, `select api.activate_post('${id}');`));
    q(`update private.posts set status='live',published_at=clock_timestamp(),
         visible_until=(select f.funded_until from internal.post_funding('${id}') f) where id='${id}';
       select internal.write_post_projection('${id}');`);
    return id;
  };
  const business = (owner) => live(owner, world.post(owner, "business", "business"));
  const listing = (owner, category, title, attrs = {}, city = "gp_johannesburg") =>
    q(
      `select vmtest.listing('${owner.id}','${category}',${sqlLiteral(title)},${sqlLiteral(JSON.stringify(attrs))}::jsonb,'${city.split("_")[0]}','${city}');`
    );
  const cipc = (owner, businessId, valid = "365 days") =>
    q(`select vmtest.cipc('${owner.id}','${businessId}','${valid}'::interval);`);
  const onSale = (value) =>
    q(
      `update private.slot_package_sales set on_sale=${value},changed_at=now(),reason='Fixture: switched for the checks';`
    );
  const VEHICLE = (make, year, transmission = "manual") => ({
    make,
    model: "Hilux",
    year,
    mileage_km: 98000,
    transmission,
    fuel_type: "diesel",
    service_history: "full",
  });
  const store = (postId, as = anon) =>
    json(as(`select coalesce(api.get_public_storefront('${postId}'),'null'::jsonb);`));
  const searchSql = (request) =>
    anon(`select api.search_post_cards(${sqlLiteral(JSON.stringify(request))}::jsonb);`);
  const search = (request) => json(searchSql(request));
  const ids = (request) =>
    search({ area: "market", limit: 48, ...request })
      .items.map((row) => row.id)
      .sort();

  // ------------------------------------------------------------ before
  await check("before the update: search has no storefront filter", () => {
    fails(searchSql({ storefront: admin.id }), "22023", /unknown search filter/);
    assert.equal(q(`select to_regprocedure('${READ}') is null;`), "t");
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], NOT_APPLIED);
  });
  await check("drift and a premature rollback are refused", () => {
    assertDriftRefused(kit, { label: "business storefront", signatures: [SEARCH], rows: 2 });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "business storefront",
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  await check("grants: the read for visitors and members only; helpers for nobody", () => {
    const grants = executeGrants(json, [READ, ...HELPERS]);
    assert.deepEqual(grants[READ], { anon: true, authenticated: true, service_role: false });
    assert.deepEqual(grants["internal.get_public_storefront(uuid)"], {
      anon: true,
      authenticated: true,
      service_role: false,
    });
    for (const helper of HELPERS.slice(0, 2))
      assert.deepEqual(grants[helper], { anon: false, authenticated: false, service_role: false });
    assert.equal(
      q(`select prosecdef from pg_proc where oid='${READ}'::regprocedure;`),
      "f",
      "the api wrapper is security invoker"
    );
  });

  // ------------------------------------------------------------- world
  onSale(true);
  const sipho = verified("storefront-sipho");
  buyPackage(sipho, 10);
  const motors = business(sipho);
  cipc(sipho, motors);
  const bakkie = live(sipho, listing(sipho, "vehicles", "Demo bakkie", VEHICLE("Toyota", 2019)));
  const hatch = live(
    sipho,
    listing(sipho, "vehicles", "Sample hatchback", VEHICLE("toyota", 2021, "automatic"))
  );
  const sedan = live(sipho, listing(sipho, "vehicles", "Test sedan", VEHICLE("Volkswagen", 2015)));
  const house = live(
    sipho,
    listing(
      sipho,
      "property",
      "Sample house",
      { property_type: "house", listing_intent: "sale", bedrooms: 3 },
      "kzn_richards_bay"
    )
  );
  const draft = listing(sipho, "vehicles", "Draft car", VEHICLE("Ford", 2018));
  const deleted = live(sipho, listing(sipho, "vehicles", "Deleted car", VEHICLE("Nissan", 2017)));
  q(`update private.post_activations set released_at=now(),release_reason='deleted'
       where post_id='${deleted}' and released_at is null;
     update private.posts set status='archived' where id='${deleted}';
     select internal.write_post_projection('${deleted}');`);
  const stock = [bakkie, hatch, sedan, house].sort();

  await check("a checked business with a running package has a storefront", () => {
    const own = store(motors);
    assert.equal(own.business_id, motors);
    assert.match(own.business_name, /^Fixture business /);
    assert.equal(own.listings, 4);
    assert.deepEqual(own.categories, { vehicles: 3, property: 1 });
    assert.deepEqual(own.makes, ["Toyota", "Volkswagen"], "makes once each, in any case");
    assert.deepEqual(own.areas, [{ province: "kzn", city: "kzn_richards_bay" }]);
    assert.deepEqual(Object.keys(own).sort(), [
      "areas",
      "business_id",
      "business_name",
      "categories",
      "listings",
      "makes",
    ]);
    // The same for a member, and from each listing in it.
    assert.deepEqual(
      store(motors, (sql) => member(sipho, sql)),
      own
    );
    for (const id of stock) assert.deepEqual(store(id), own);
    // Not from a draft, a deleted listing or an unknown post.
    for (const id of [draft, deleted, admin.id]) assert.equal(store(id), null);
  });

  await check("search: the storefront holds only its live listings, with every filter", () => {
    assert.deepEqual(ids({ storefront: motors }), stock);
    const all = search({ storefront: motors, area: "market", limit: 2, offset: 0 });
    assert.equal(all.total, 4);
    assert.equal(all.items.length, 2);
    assert.deepEqual(all.facets.categories, { vehicles: 3, property: 1 });
    assert.deepEqual(ids({ storefront: motors, make: "TOYOTA" }), [bakkie, hatch].sort());
    assert.deepEqual(ids({ storefront: motors, make: "Ford" }), []);
    assert.deepEqual(
      ids({ storefront: motors, category: "vehicles", attributes: { transmission: "automatic" } }),
      [hatch]
    );
    assert.deepEqual(
      ids({ storefront: motors, category: "vehicles", attributes: { year: { min: 2019 } } }),
      [bakkie, hatch].sort()
    );
    assert.deepEqual(ids({ storefront: motors, q: "sedan" }), [sedan]);
    assert.deepEqual(ids({ storefront: motors, province: "kzn", city: "kzn_richards_bay" }), [
      house,
    ]);
    // Without the filter, search is as before.
    assert.ok(ids({}).length >= 4);
  });

  await check("search: the storefront and make filters are refused when malformed", () => {
    fails(searchSql({ storefront: "not-a-uuid" }), "22023", /invalid storefront/);
    fails(searchSql({ make: "Toyota" }), "22023", /make filter requires a storefront/);
    // LIM-SQL-search-make-length (docs/testing/limits-register.json): 1 to 80.
    fails(
      searchSql({ storefront: motors, make: "" }),
      "22023",
      /make filter requires a storefront/
    );
    assert.deepEqual(ids({ storefront: motors, make: "x".repeat(80) }), []);
    fails(
      searchSql({ storefront: motors, make: "x".repeat(81) }),
      "22023",
      /make filter requires a storefront/
    );
    // A listing id is not a storefront: nothing matches.
    assert.deepEqual(ids({ storefront: bakkie }), []);
  });

  await check("only the owner's first checked business has the storefront", () => {
    const second = business(sipho);
    cipc(sipho, second);
    assert.equal(store(second), null);
    assert.deepEqual(ids({ storefront: second }), []);
    assert.equal(store(bakkie).business_id, motors);
  });

  await check("no storefront without a current CIPC sticker or a running package", () => {
    // A package and a business, but no sticker.
    const thandi = verified("storefront-thandi");
    buyPackage(thandi, 5);
    const shop = business(thandi);
    const car = live(thandi, listing(thandi, "vehicles", "Unchecked car", VEHICLE("Kia", 2020)));
    assert.equal(store(shop), null);
    assert.equal(store(car), null);
    assert.deepEqual(ids({ storefront: shop }), []);
    // An expired sticker.
    cipc(thandi, shop, "-1 day");
    assert.equal(store(shop), null);
    // A current one switches it on.
    cipc(thandi, shop);
    assert.equal(store(shop).listings, 1);
    assert.equal(store(car).business_id, shop);
    // A checked business without a package (its owner never bought one).
    const lindiwe = verified("storefront-lindiwe");
    const plain = world.post(lindiwe, "business", "business");
    cipc(lindiwe, plain);
    assert.equal(store(plain), null);
    assert.deepEqual(ids({ storefront: plain }), []);
  });

  await check("the storefront ends when the package ends", () => {
    q(`update private.entitlements set ends_at=now()-interval '1 second'
         where owner_id='${sipho.id}' and package_id is not null;`);
    assert.equal(store(motors), null);
    assert.equal(store(bakkie), null);
    assert.deepEqual(ids({ storefront: motors }), []);
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"]
    );
    assert.match(rows[0][1], APPLIED);
  });
  // Service-role sessions never read it (the website reads it as a visitor).
  await check("the server key cannot run the read", () => {
    fails(service(`select api.get_public_storefront('${motors}');`), "42501");
  });
});
