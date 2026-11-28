#!/usr/bin/env node
// Behaviour checks for 20261128012529_posting_form_display_fields.sql: the
// public card read (api.search_post_cards with frontend_presentation) returns
// the new display keys the posting forms now save (Business visitor features,
// Tourism "From" price, stay sizes, backup power and water, cancellation days
// and opening hours, Event doors-open time, refunds and ticket sales), while
// unknown keys stay hidden and nothing else changes.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Synthetic members and posts are written directly as the database
// owner. It checks the read-only preflight (counts only), a drifted body and a
// premature rollback, proves apply -> rollback -> apply, then checks what a
// visitor receives and that no grant changed.
//
//   node --import tsx scripts/test-foundation-posting-form-display-fields.mjs
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

const UPDATE = "20261128012529_posting_form_display_fields.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const ALLOW_LIST = "internal.public_post_presentation_data(text,jsonb)";
const NOT_APPLIED =
  /^posting form display fields: update not applied; presentations with a new display key: \d+$/;
const APPLIED =
  /^posting form display fields: already applied; presentations with a new display key: \d+$/;

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  fails,
  service,
  fingerprint,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const anon = (sql) => `set role anon;\n${sql}`;

  const owner = syntheticMember("display-fields-owner");
  q(`create or replace function vmtest.slot(p_owner uuid) returns uuid language sql as $$
      insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
        values(p_owner,'staff_grant',p_owner,1000,10,1,now()-interval '1 day',now()+interval '60 days') returning id $$;
    -- A live post of p_kind (business in p_area, or event) with presentation p_data.
    create or replace function vmtest.post(p_owner uuid,p_slot uuid,p_kind text,p_area text,p_data jsonb) returns uuid
      language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cat text; begin
      if p_kind='business' then
        select c.category_key into cat from private.post_category_contracts c
          where c.kind='business' and c.area=p_area order by c.category_key limit 1;
        insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
          values(pid,p_owner,'business',p_area,cat,(select a.key from private.category_activities a
            join private.categories c on c.key=a.category_key where a.category_key=cat and c.activity_required
            order by a.key limit 1),'Fixture business '||left(pid::text,8),
            'A synthetic description long enough for every rule.','gp','gp_johannesburg');
        insert into private.business_details(post_id) values(pid);
      else
        insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
          values(pid,p_owner,'event','tourism_events','events',(select a.key from private.category_activities a
              join private.categories c on c.key=a.category_key where a.category_key='events' and c.activity_required
              order by a.key limit 1),
            'Fixture event '||left(pid::text,8),'A synthetic description long enough for every rule.','gp','gp_johannesburg');
        insert into private.event_details(post_id,starts_at,ends_at,timezone)
          values(pid,date_trunc('milliseconds',now()+interval '20 days'),
            date_trunc('milliseconds',now()+interval '21 days'),'Africa/Johannesburg');
        insert into private.post_contacts(post_id,post_kind,channels) values(pid,'event',array['form']);
      end if;
      insert into private.post_presentations(post_id,data,contacts)
        values(pid,p_data,case when p_kind='business' then '{"phone":null,"whatsapp":null}'::jsonb else '{}'::jsonb end);
      insert into private.post_activations(post_id,entitlement_id,owner_id) values(pid,p_slot,p_owner);
      update private.posts set status='live',published_at=now()-interval '1 minute',visible_until=now()+interval '30 days'
        where id=pid;
      perform internal.write_post_projection(pid);
      return pid;
    end$$;`);
  const slot = q(`select vmtest.slot('${owner.id}');`);
  const post = (kind, area, data) =>
    q(`select vmtest.post('${owner.id}','${slot}','${kind}','${area}',${sqlJsonb(data)});`);
  const visitorData = (id) => {
    const items = json(
      anon(
        `select api.search_post_cards(${sqlJsonb({
          post_id: id,
          limit: 1,
          offset: 0,
          presentation: true,
          frontend_presentation: true,
        })});`
      )
    ).items;
    assert.equal(items.length, 1, `card ${id}`);
    return items[0].presentation.frontend.data;
  };

  const tourismDetails = {
    price_from_cents: 45000,
    price_unit: "night",
    sleeps: 4,
    bedrooms: 2,
    beds: 3,
    bathrooms: 1,
    backup_utilities: ["inverter_solar", "water_tanks"],
    cancellation_policy: "free_until_days",
    cancellation_free_days: 7,
    opening_hours: "Daily 08:00 - 17:00",
    owner_note: "fixture private",
  };
  const eventDetails = {
    event_type: "festival",
    doors_open: "17:30",
    refund_policy: "full_until_days",
    refund_days: 3,
    ticket_sales: "both",
    gate_payment: ["cash", "card"],
    organiser_note: "fixture private",
  };
  const visit = {
    type: "standalone_shop",
    walk_in_policy: "walk_ins_welcome",
    visitor_features: ["parking", "kid_friendly"],
    registration_secret: "fixture private",
  };

  let business, stay, event;
  await check("before the update: the new keys are stored but not shown to visitors", () => {
    business = post("business", "business", {
      business_details: visit,
      category_details: { booking_url: "https://book.example.invalid" },
    });
    stay = post("business", "tourism_events", { category_details: tourismDetails });
    event = post("event", "tourism_events", { event_details: eventDetails });
    assert.deepEqual(visitorData(business).business_details, {
      type: "standalone_shop",
      walk_in_policy: "walk_ins_welcome",
    });
    assert.deepEqual(visitorData(stay).category_details, {
      cancellation_policy: "free_until_days",
    });
    assert.deepEqual(visitorData(event).event_details, { event_type: "festival" });
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
      "posting form display fields: update not applied; presentations with a new display key: 3"
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
        signatures: [ALLOW_LIST],
        drift: /posting form display fields precondition: internal\.public_post_presentation_data/,
      }
    )
  );

  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "posting form display fields",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: APPLIED,
  });

  await check("a visitor receives the new display keys, never unknown ones", () => {
    assert.deepEqual(visitorData(business).business_details, {
      type: "standalone_shop",
      walk_in_policy: "walk_ins_welcome",
      visitor_features: ["parking", "kid_friendly"],
    });
    assert.deepEqual(visitorData(business).category_details, {
      booking_url: "https://book.example.invalid",
    });
    const { owner_note: _ownerNote, ...shownTourism } = tourismDetails;
    assert.deepEqual(visitorData(stay).category_details, shownTourism);
    const { organiser_note: _organiserNote, ...shownEvent } = eventDetails;
    assert.deepEqual(visitorData(event).event_details, shownEvent);
  });

  await check("grants unchanged", () => {
    assert.deepEqual(executeGrants(json, ["api.search_post_cards(jsonb)", ALLOW_LIST]), {
      "api.search_post_cards(jsonb)": { anon: true, authenticated: true, service_role: false },
      [ALLOW_LIST]: { anon: false, authenticated: false, service_role: false },
    });
    fails(anon(`select internal.public_post_presentation_data('event','{}');`), "42501");
    fails(service(`select internal.public_post_presentation_data('event','{}');`), "42501");
  });

  await check("preflight after the update: summary only", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "posting form display fields: already applied; presentations with a new display key: 3"
    );
  });

  applySteps(database, steps.slice(index + 1));
  console.log(
    `PASS posting form display fields: ${checks.length} checks in ${Math.round((Date.now() - started) / 1000)} s`
  );
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
