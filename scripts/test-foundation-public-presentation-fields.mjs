#!/usr/bin/env node
// Behaviour checks for 20261127044054_public_presentation_display_fields.sql:
// the public card read (api.search_post_cards with frontend_presentation)
// returns only the presentation keys the public pages render, while the
// owner's read keeps the full stored presentation, and the one-off cleanup
// removes every stored email.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Synthetic members and posts are written directly as the database
// owner. Before the update it publishes a Market listing with a street
// address, Business posts with an email, an unpublished address (customer
// access without publishAddress), a published address, no customer access at
// all (saved before it existed), an event with a venue, unknown top-level and
// nested keys, an open edit copy and approval snapshots. It checks the
// read-only preflight (counts only), a drifted body and a premature rollback,
// applies the update and proves apply -> rollback -> apply (a repeated run
// changes nothing), then checks what a visitor and another member receive,
// what the owner receives, the cleanup and the snapshots it moves, and that
// no grant changed.
//
//   node --import tsx scripts/test-foundation-public-presentation-fields.mjs
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
  openUpdateCheck,
  sqlJsonb,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261127044054_public_presentation_display_fields.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const PRESENTATION = "internal.frontend_post_presentation(uuid)";
const summary = (state) =>
  new RegExp(
    `^public presentation fields: ${state}; presentations with an email: \\d+; listings with a street address: \\d+; businesses with an unpublished address: \\d+; approval snapshots of posts with an email: \\d+$`
  );
const NOT_APPLIED = summary("update not applied");
const APPLIED = summary("already applied");

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
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const anon = (sql) => `set role anon;\n${sql}`;

  // ------------------------------------------------------- synthetic world
  const owner = syntheticMember("presentation-owner");
  const stranger = syntheticMember("presentation-stranger");
  q(`create or replace function vmtest.slot(p_owner uuid) returns uuid language sql as $$
      insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
        values(p_owner,'staff_grant',p_owner,1000,10,1,now()-interval '1 day',now()+interval '60 days') returning id $$;
    -- A live post of p_kind with presentation p_data, public through p_slot.
    create or replace function vmtest.post(p_owner uuid,p_slot uuid,p_kind text,p_data jsonb) returns uuid
      language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cat text; begin
      if p_kind='business' then
        select c.category_key into cat from private.post_category_contracts c
          where c.kind='business' and c.area='business' order by c.category_key limit 1;
        insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
          values(pid,p_owner,'business','business',cat,(select a.key from private.category_activities a
            join private.categories c on c.key=a.category_key where a.category_key=cat and c.activity_required
            order by a.key limit 1),'Fixture business '||left(pid::text,8),
            'A synthetic description long enough for every rule.','gp','gp_johannesburg');
        insert into private.business_details(post_id) values(pid);
      elsif p_kind='event' then
        insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
          values(pid,p_owner,'event','tourism_events','events',(select a.key from private.category_activities a
              join private.categories c on c.key=a.category_key where a.category_key='events' and c.activity_required
              order by a.key limit 1),
            'Fixture event '||left(pid::text,8),'A synthetic description long enough for every rule.','gp','gp_johannesburg');
        insert into private.event_details(post_id,starts_at,ends_at,timezone)
          values(pid,date_trunc('milliseconds',now()+interval '20 days'),
            date_trunc('milliseconds',now()+interval '21 days'),'Africa/Johannesburg');
        insert into private.post_contacts(post_id,post_kind,channels) values(pid,'event',array['form']);
      else
        insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id)
          values(pid,p_owner,'listing','market','other_items','Fixture listing '||left(pid::text,8),
            'A synthetic description long enough for every rule.','gp','gp_johannesburg');
        insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
        insert into private.post_contacts(post_id,post_kind,channels) values(pid,'listing',array['form']);
      end if;
      insert into private.post_presentations(post_id,data,contacts)
        values(pid,p_data,case when p_kind='business' then '{"phone":"0820000001","whatsapp":null}'::jsonb else '{}'::jsonb end);
      insert into private.post_activations(post_id,entitlement_id,owner_id) values(pid,p_slot,p_owner);
      update private.posts set status='live',published_at=now()-interval '1 minute',visible_until=now()+interval '30 days'
        where id=pid;
      perform internal.write_post_projection(pid);
      return pid;
    end$$;`);
  const slot = q(`select vmtest.slot('${owner.id}');`);
  const post = (kind, data) =>
    q(`select vmtest.post('${owner.id}','${slot}','${kind}',${sqlJsonb(data)});`);
  const storedData = (id) =>
    json(`select data from private.post_presentations where post_id='${id}';`);
  const cardSql = (id) =>
    `select api.search_post_cards(${sqlJsonb({
      post_id: id,
      limit: 1,
      offset: 0,
      presentation: true,
      frontend_presentation: true,
    })});`;
  const cardAs = (wrap, id) => {
    const items = json(wrap(cardSql(id))).items;
    assert.equal(items.length, 1, `card ${id}`);
    return items[0].presentation.frontend;
  };
  const visitorData = (id) => cardAs(anon, id).data;
  const ownerRead = (id) =>
    json(member(owner, `select api.get_my_frontend_post('${id}');`)).frontend.data;

  const access = (publishAddress) => ({
    version: 2,
    methods: ["visit"],
    premises: "standalone_shop",
    ...(publishAddress === undefined ? {} : { publishAddress }),
    owner_only_note: "fixture private",
  });
  const shopDetails = {
    type: "standalone_shop",
    street_address: "1 Fixture Street",
    suite_or_unit: "Unit 2",
    suburb: "Fixture Park",
    landmark: "Next to the fixture",
    registration_secret: "fixture private",
  };
  const businessBase = {
    slug: "fixture-business",
    email: "owner@example.invalid",
    phone: "0820000001",
    whatsapp: "0820000001",
    website: "https://example.invalid",
    location_town: "Fixture Park",
    location_address: "1 Fixture Street",
    store_number: "12",
    map_directions: "https://maps.example.invalid/x",
    location_province: "Gauteng",
    location_city: "Johannesburg",
    internal_note: "fixture private",
    operating_hours: { mon: "08:00-17:00" },
    business_details: shopDetails,
    media_width: 1080,
    media_height: 1920,
  };
  const withAccess = (publishAddress) => ({
    ...businessBase,
    category_details: {
      contact_methods: ["call", "form"],
      customer_access: access(publishAddress),
      business_profile: { year_established: 2001, owner_salary: "fixture private" },
      seating_capacity: 40,
      owner_note: "fixture private",
    },
  });

  let listing, hidden, hiddenUnset, shown, legacy, event, plain, editCopy;
  await check("before the update: the world, and visitors receive every stored key", () => {
    listing = post("listing", {
      location_town: "Fixture Park",
      location_address: "9 Private Road",
      source_attributes: { brand: "Fixture" },
      layout_width: null,
      layout_height: null,
    });
    hidden = post("business", withAccess(false));
    hiddenUnset = post("business", withAccess(undefined));
    shown = post("business", withAccess(true));
    legacy = post("business", { ...businessBase, email: undefined });
    event = post("event", {
      location_town: "Fixture Park",
      location_address: "Fixture Hall, 3 Venue Road",
      event_details: {
        event_type: "festival",
        venue_name: "Fixture Hall",
        organiser_note: "private",
      },
      category_label: "Festival",
      ticket_price_cents: 5000,
      email: "events@example.invalid",
    });
    plain = post("business", { slug: "no-email", website: "https://plain.example.invalid" });
    // An open edit of `hidden`: its presentation is copied from the live post.
    editCopy =
      q(`with c as (insert into private.posts(owner_id,kind,area,category_key,activity_key,title,description,
        province_id,city_id,edit_of)
      select owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id,id
        from private.posts where id='${hidden}' returning id),
      d as (insert into private.business_details(post_id) select id from c)
      select id from c;`);
    assert.equal(storedData(editCopy).email, "owner@example.invalid");
    // Approval snapshots: `hidden` and `plain` as approved (matching), `shown`
    // approved before a later change (not matching).
    q(`insert into private.frontend_post_approval_snapshots(post_id,digest,structural_digest,approved_at)
      select id,internal.frontend_post_approval_digest(id),internal.frontend_post_structural_digest(id),now()-interval '1 day'
        from private.posts where id in('${hidden}','${plain}');
      insert into private.frontend_post_approval_snapshots(post_id,digest,structural_digest,approved_at)
        values('${shown}',repeat('a',64),repeat('b',64),now()-interval '1 day');`);
    assert.equal(visitorData(hidden).email, "owner@example.invalid");
    assert.equal(visitorData(hidden).business_details.street_address, "1 Fixture Street");
    assert.equal(visitorData(listing).location_address, undefined);
  });

  await check("preflight: read only, summary only, counts only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "public presentation fields: update not applied; presentations with an email: 5; listings with a street address: 1; businesses with an unpublished address: 3; approval snapshots of posts with an email: 2"
    );
    assert.match(rows[0][1], NOT_APPLIED);
    assertReadOnlyPreflight(database, PREFLIGHT);
  });

  await check("a premature rollback and a drifted body are refused", () =>
    assertDriftRefused(
      { q, fails, fingerprint, preflightRows: preflight },
      {
        rollback: ROLLBACK,
        updateSql: step.sql,
        signatures: [PRESENTATION],
        drift: /public presentation fields precondition: internal\.frontend_post_presentation/,
      }
    )
  );

  // ------------------------------------------------------------- apply
  const snapshot = (id) =>
    json(
      `select to_jsonb(s) from private.frontend_post_approval_snapshots s where s.post_id='${id}';`
    );
  const before = {
    data: Object.fromEntries([hidden, plain, editCopy, event].map((id) => [id, storedData(id)])),
    snapshots: Object.fromEntries([hidden, plain, shown].map((id) => [id, snapshot(id)])),
  };
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "public presentation fields",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: APPLIED,
  });

  // ------------------------------------------------------------- after
  await check("the cleanup removes every email and nothing else", () => {
    assert.equal(q(`select count(*) from private.post_presentations where data ? 'email';`), "0");
    for (const id of [hidden, editCopy, event]) {
      const { email, ...rest } = before.data[id];
      assert.ok(email, id);
      assert.deepEqual(storedData(id), rest, id);
    }
    assert.deepEqual(storedData(plain), before.data[plain]);
  });

  await check("approval snapshots: only a changed post's matching snapshot follows it", () => {
    const moved = snapshot(hidden);
    assert.notEqual(moved.digest, before.snapshots[hidden].digest);
    assert.equal(
      moved.digest,
      q(`select internal.frontend_post_approval_digest('${hidden}');`),
      "the cleaned post still matches its approval"
    );
    assert.equal(
      moved.structural_digest,
      q(`select internal.frontend_post_structural_digest('${hidden}');`)
    );
    assert.equal(moved.approved_at, before.snapshots[hidden].approved_at);
    // Unchanged post, and a changed post whose snapshot did not match.
    assert.deepEqual(snapshot(plain), before.snapshots[plain]);
    assert.deepEqual(snapshot(shown), before.snapshots[shown]);
  });

  const DISPLAY_ONLY = (data) => {
    for (const key of [
      "email",
      "phone",
      "whatsapp",
      "internal_note",
      "location_province",
      "location_city",
    ])
      assert.equal(Object.hasOwn(data, key), false, key);
  };
  for (const [who, wrap] of [
    ["a visitor", anon],
    ["another member", (sql) => member(stranger, sql)],
  ]) {
    await check(`${who} receives display fields only`, () => {
      const read = (id) => cardAs(wrap, id);
      const listingData = read(listing).data;
      assert.deepEqual(listingData, {
        location_town: "Fixture Park",
        source_attributes: { brand: "Fixture" },
        layout_width: null,
        layout_height: null,
      });

      for (const id of [hidden, hiddenUnset]) {
        const frontend = read(id);
        const data = frontend.data;
        DISPLAY_ONLY(data);
        for (const key of ["location_address", "store_number", "map_directions"])
          assert.equal(Object.hasOwn(data, key), false, key);
        assert.deepEqual(data.business_details, {
          type: "standalone_shop",
          suburb: "Fixture Park",
          landmark: "Next to the fixture",
        });
        assert.deepEqual(data.category_details, {
          contact_methods: ["call", "form"],
          customer_access: {
            version: 2,
            methods: ["visit"],
            premises: "standalone_shop",
            ...(id === hidden ? { publishAddress: false } : {}),
          },
          business_profile: { year_established: 2001 },
          seating_capacity: 40,
        });
        assert.equal(data.location_town, "Fixture Park");
        assert.equal(data.website, "https://example.invalid");
        assert.deepEqual(data.operating_hours, { mon: "08:00-17:00" });
        assert.equal(data.media_width, 1080);
        assert.deepEqual(frontend.business_contacts, { phone: "0820000001", whatsapp: null });
      }

      for (const id of [shown, legacy]) {
        const data = read(id).data;
        DISPLAY_ONLY(data);
        assert.equal(data.location_address, "1 Fixture Street");
        assert.equal(data.store_number, "12");
        assert.equal(data.map_directions, "https://maps.example.invalid/x");
        assert.deepEqual(data.business_details, {
          type: "standalone_shop",
          street_address: "1 Fixture Street",
          suite_or_unit: "Unit 2",
          suburb: "Fixture Park",
          landmark: "Next to the fixture",
        });
      }

      const eventData = read(event).data;
      assert.deepEqual(eventData, {
        location_town: "Fixture Park",
        location_address: "Fixture Hall, 3 Venue Road",
        event_details: { event_type: "festival", venue_name: "Fixture Hall" },
        category_label: "Festival",
        ticket_price_cents: 5000,
      });
    });
  }

  await check("the owner's read keeps the full stored presentation", () => {
    assert.equal(ownerRead(listing).location_address, "9 Private Road");
    const hiddenData = ownerRead(hidden);
    assert.equal(hiddenData.location_address, "1 Fixture Street");
    assert.equal(hiddenData.business_details.street_address, "1 Fixture Street");
    assert.equal(hiddenData.business_details.registration_secret, "fixture private");
    assert.equal(hiddenData.category_details.owner_note, "fixture private");
    assert.equal(hiddenData.internal_note, "fixture private");
    // A website that still saves an email (before the form change): the owner
    // sees it, a visitor never does.
    q(`update private.post_presentations set data=data||'{"email":"later@example.invalid"}'
      where post_id='${hidden}';`);
    assert.equal(ownerRead(hidden).email, "later@example.invalid");
    assert.equal(Object.hasOwn(visitorData(hidden), "email"), false);
    q(`update private.post_presentations set data=data-'email' where post_id='${hidden}';`);
  });

  await check("grants unchanged; the new functions run only inside the card read", () => {
    assert.deepEqual(executeGrants(json, ["api.search_post_cards(jsonb)"]), {
      "api.search_post_cards(jsonb)": { anon: true, authenticated: true, service_role: false },
    });
    assert.deepEqual(
      executeGrants(json, [
        PRESENTATION,
        "internal.public_post_presentation_data(text,jsonb)",
        "internal.json_object_keys_only(jsonb,text[])",
      ]),
      Object.fromEntries(
        [
          PRESENTATION,
          "internal.public_post_presentation_data(text,jsonb)",
          "internal.json_object_keys_only(jsonb,text[])",
        ].map((f) => [f, { anon: false, authenticated: false, service_role: false }])
      )
    );
    fails(anon(`select internal.public_post_presentation_data('listing','{}');`), "42501");
    fails(service(cardSql(listing)), "42501");
  });

  await check("preflight after the update: summary only, no email left", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "public presentation fields: already applied; presentations with an email: 0; listings with a street address: 1; businesses with an unpublished address: 3; approval snapshots of posts with an email: 0"
    );
  });

  // ---------------------------------------------------------- later steps
  applySteps(database, steps.slice(index + 1));
  console.log(
    `PASS public presentation fields: ${checks.length} checks in ${Math.round((Date.now() - started) / 1000)} s`
  );
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
