#!/usr/bin/env node
// Behaviour checks for 20261127055550_reveal_business_contacts.sql: the
// click-to-view command (api.reveal_post_phone, service only) answers for a
// publicly live business with the number the business chose for a ticked
// channel, in +27 form (a 01x-05x landline, a 06x, 071-074, 076-079 or
// 081-084 mobile, or an 087, 0800, 0860 or 0861 call-only number for a call;
// the mobile only for WhatsApp), while listings and events keep the owner's
// verified number for a chosen channel. The public card read
// (api.search_post_cards with presentation flags, open to visitors and
// members) carries no business number, only business_contact_options
// booleans, and the owner's own read keeps the numbers.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Synthetic members and posts are written directly as the database
// owner. It checks the read-only preflight (counts only), a drifted body and a
// premature rollback, applies the update and proves apply -> rollback -> apply
// (a repeated run changes nothing), then checks the answers per post and
// channel, the public card read as a visitor and as a member, the owner's own
// read, that visitors and members still cannot run the command, and that no
// grant changed.
//
//   node --import tsx scripts/test-foundation-reveal-business-contacts.mjs
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

const UPDATE = "20261127055550_reveal_business_contacts.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const REVEAL = "internal.reveal_post_phone(uuid,text)";
const PRESENTATION = "internal.frontend_post_presentation(uuid)";
const NUMBER = "internal.business_contact_number(jsonb,jsonb,text)";
const NOT_APPLIED =
  /^business contacts reveal: update not applied; live businesses with a phone number: \d+; with a WhatsApp number: \d+; with a number not served: \d+$/;
const APPLIED =
  /^business contacts reveal: already applied; live businesses with a phone number: \d+; with a WhatsApp number: \d+; with a number not served: \d+$/;

// A statement run as a visitor.
const anon = (sql) => `set role anon;\n${sql}`;

const harness = await openUpdateCheck(PREFLIGHT);
const { database, q, json, fails, service, member, syntheticMember, fingerprint } = harness;
const { check, current, started, passed: checks, preflightRows: preflight } = harness;
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  // ------------------------------------------------------- synthetic world
  const owner = syntheticMember("reveal-owner");
  const stranger = syntheticMember("reveal-stranger");
  const OWNER_PHONE = "+27830000001";
  q(`do $$begin
      perform set_config('session_replication_role','replica',true);
      insert into private.verification_phone_proofs(owner_id,challenge_id,phone)
        values('${owner.id}',gen_random_uuid(),'${OWNER_PHONE}');
      perform set_config('session_replication_role','origin',true);
    end$$;
    create or replace function vmtest.slot(p_owner uuid) returns uuid language sql as $$
      insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
        values(p_owner,'staff_grant',p_owner,1000,10,1,now()-interval '1 day',now()+interval '60 days') returning id $$;
    -- A post of p_kind (live unless p_live is false) with business numbers
    -- p_contacts, presentation p_data and contact choices p_channels
    -- (listings and events).
    create or replace function vmtest.post(p_owner uuid,p_slot uuid,p_kind text,p_contacts jsonb,p_channels text[],p_live boolean,
      p_data jsonb) returns uuid language plpgsql as $$
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
        insert into private.post_contacts(post_id,post_kind,channels) values(pid,'event',p_channels);
      else
        insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id)
          values(pid,p_owner,'listing','market','other_items','Fixture listing '||left(pid::text,8),
            'A synthetic description long enough for every rule.','gp','gp_johannesburg');
        insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
        insert into private.post_contacts(post_id,post_kind,channels) values(pid,'listing',p_channels);
      end if;
      insert into private.post_presentations(post_id,data,contacts) values(pid,p_data,p_contacts);
      if p_live then
        insert into private.post_activations(post_id,entitlement_id,owner_id) values(pid,p_slot,p_owner);
        update private.posts set status='live',published_at=now()-interval '1 minute',visible_until=now()+interval '30 days'
          where id=pid;
        perform internal.write_post_projection(pid);
      end if;
      return pid;
    end$$;`);
  const slot = q(`select vmtest.slot('${owner.id}');`);
  const post = (kind, contacts, { channels = ["form"], live = true, methods } = {}) =>
    q(
      `select vmtest.post('${owner.id}','${slot}','${kind}',${sqlJsonb(contacts)},array[${channels
        .map((c) => `'${c}'`)
        .join(",")}]::text[],${live},${sqlJsonb(
        methods ? { category_details: { contact_methods: methods } } : {}
      )});`
    );
  const revealSql = (id, channel) => `select api.reveal_post_phone('${id}','${channel}');`;
  const reveal = (id, channel) => q(service(revealSql(id, channel)));

  // The public card read of one post (or of every live post) as `as`.
  const cards = (as, id) =>
    json(
      as(
        `select api.search_post_cards(${sqlJsonb({
          ...(id ? { post_id: id } : {}),
          limit: 48,
          offset: 0,
          presentation: true,
          frontend_presentation: true,
        })});`
      )
    ).items;
  const options = (id) => cards(anon, id)[0].presentation.frontend.data.business_contact_options;
  // Every stored business number, as stored and as its last seven digits.
  const STORED = [];
  const shows = (text) =>
    STORED.filter(
      (value) => text.includes(value) || text.includes(value.replace(/\D/g, "").slice(-7))
    );

  let landline, mobile, spaced, international, landlineOnWhatsapp, odd, none, draft, listing, event;
  let tickedCall, tickedBoth, tollFree, callOnly;
  await check("before the update: the world, and businesses answer nothing", () => {
    landline = post("business", { phone: "0311234567", whatsapp: null });
    mobile = post("business", { phone: null, whatsapp: "0821234567" });
    spaced = post("business", { phone: "(011) 123-4567", whatsapp: "082 765 4321" });
    international = post("business", { phone: "27311234567", whatsapp: "+27721234567" });
    landlineOnWhatsapp = post("business", { phone: "0311234567", whatsapp: "0311234567" });
    odd = post("business", { phone: "0911234567", whatsapp: "12345" });
    none = post("business", { phone: "", whatsapp: null });
    draft = post("business", { phone: "0311234567", whatsapp: "0821234567" }, { live: false });
    // Contact methods ticked on the form: WhatsApp unticked, then both.
    tickedCall = post(
      "business",
      { phone: "0315550001", whatsapp: "0825550002" },
      { methods: ["call", "form"] }
    );
    tickedBoth = post(
      "business",
      { phone: "0825550003", whatsapp: "0835550004" },
      { methods: ["call", "whatsapp"] }
    );
    // 080 outside 0800 and 086 outside 0860/0861 are never served.
    tollFree = post("business", { phone: "0805550005", whatsapp: "0865550006" });
    // 0860 (share-call) and 087 (VoIP) take calls, never WhatsApp.
    callOnly = post("business", { phone: "0860 555 007", whatsapp: "0875550008" });
    STORED.push(
      ...json(`select jsonb_agg(v) from private.post_presentations d
        cross join lateral (values(d.contacts->>'phone'),(d.contacts->>'whatsapp')) n(v)
        where length(regexp_replace(coalesce(v,''),'[^0-9]','','g'))>=7;`)
    );
    listing = post("listing", {}, { channels: ["call", "form"] });
    event = post("event", {}, { channels: ["whatsapp", "form"] });
    for (const id of [landline, mobile, spaced])
      for (const channel of ["call", "whatsapp"]) assert.equal(reveal(id, channel), "", id);
    assert.equal(reveal(listing, "call"), OWNER_PHONE);
    assert.equal(reveal(event, "whatsapp"), OWNER_PHONE);
    // Before the update a visitor's card read carries the stored numbers.
    assert.ok(shows(JSON.stringify(cards(anon, tickedBoth))).length > 0);
  });

  await check("preflight: read only, summary only, counts only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    // Live businesses only; the empty phone and the draft are not counted.
    assert.equal(
      rows[0][1],
      "business contacts reveal: update not applied; live businesses with a phone number: 9; with a WhatsApp number: 9; with a number not served: 5"
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
        signatures: [REVEAL, PRESENTATION],
        drift:
          /business contacts reveal precondition: internal\.(reveal_post_phone|frontend_post_presentation)/,
      }
    )
  );

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "business contacts reveal",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: APPLIED,
  });

  // ------------------------------------------------------------- after
  await check("a business answers with its own number in +27 form", () => {
    // A landline is served for a call, never for WhatsApp.
    assert.equal(reveal(landline, "call"), "+27311234567");
    assert.equal(reveal(landline, "whatsapp"), "");
    assert.equal(reveal(landlineOnWhatsapp, "call"), "+27311234567");
    assert.equal(reveal(landlineOnWhatsapp, "whatsapp"), "");
    // A mobile WhatsApp number.
    assert.equal(reveal(mobile, "whatsapp"), "+27821234567");
    assert.equal(reveal(mobile, "call"), "");
    // Spaces, brackets, dashes and the 27 / +27 forms.
    assert.equal(reveal(spaced, "call"), "+27111234567");
    assert.equal(reveal(spaced, "whatsapp"), "+27827654321");
    assert.equal(reveal(international, "call"), "+27311234567");
    assert.equal(reveal(international, "whatsapp"), "+27721234567");
    // Not a South African number, or nothing stored.
    assert.equal(reveal(odd, "call"), "");
    assert.equal(reveal(odd, "whatsapp"), "");
    assert.equal(reveal(none, "call"), "");
    // Never the owner's verified number for a business.
    for (const id of [odd, none])
      for (const channel of ["call", "whatsapp"]) assert.notEqual(reveal(id, channel), OWNER_PHONE);
  });

  await check(
    "only ticked channels; calls: landline, mobile or call-only; WhatsApp: mobile only",
    () => {
      assert.equal(reveal(tickedCall, "call"), "+27315550001");
      assert.equal(reveal(tickedCall, "whatsapp"), "");
      assert.equal(reveal(tickedBoth, "call"), "+27825550003");
      assert.equal(reveal(tickedBoth, "whatsapp"), "+27835550004");
      assert.equal(reveal(tollFree, "call"), "");
      assert.equal(reveal(tollFree, "whatsapp"), "");
      assert.equal(reveal(callOnly, "call"), "+27860555007");
      assert.equal(reveal(callOnly, "whatsapp"), "");
      // The same rule as businessNumber in src/lib/utils/phone.ts.
      const served = (channel, number) =>
        q(
          `select coalesce(internal.business_contact_number('{}',${sqlJsonb({
            [channel === "call" ? "phone" : "whatsapp"]: number,
          })},'${channel}'),'');`
        );
      const mobiles = ["060", "069", "071", "074", "076", "079", "081", "084"];
      const neither = ["070", "075", "080", "085", "090"];
      for (const prefix of ["010", "021", "031", "041", "051", "058", ...mobiles])
        assert.equal(served("call", `${prefix}1234567`), `+27${prefix.slice(1)}1234567`, prefix);
      for (const prefix of mobiles)
        assert.equal(
          served("whatsapp", `${prefix}1234567`),
          `+27${prefix.slice(1)}1234567`,
          prefix
        );
      for (const prefix of ["011", "031", "051", ...neither])
        assert.equal(served("whatsapp", `${prefix}1234567`), "", prefix);
      for (const prefix of neither) assert.equal(served("call", `${prefix}1234567`), "", prefix);
      // 087 (VoIP), 0800 (toll-free), 0860 and 0861 (share-call): calls only.
      for (const number of [
        "0871234567",
        "087 123 4567",
        "0800123456",
        "0860123456",
        "+27861123456",
      ]) {
        const plus27 = `+27${number.replace(/[^0-9]/g, "").slice(-9)}`;
        assert.equal(served("call", number), plus27, number);
        assert.equal(served("whatsapp", number), "", number);
      }
      // Other 080 and 086 ranges (0862-0869 hold fax-to-email and premium numbers).
      for (const number of [
        "0801123456",
        "0809123456",
        "0862123456",
        "0865123456",
        "0866123456",
        "0867123456",
        "0869123456",
      ])
        for (const channel of ["call", "whatsapp"])
          assert.equal(served(channel, number), "", number);
    }
  );

  await check("the public card read carries channel booleans and no business number", () => {
    const expected = new Map([
      [landline, { call: true, whatsapp: false }],
      [mobile, { call: false, whatsapp: true }],
      [spaced, { call: true, whatsapp: true }],
      [landlineOnWhatsapp, { call: true, whatsapp: false }],
      [odd, { call: false, whatsapp: false }],
      [none, { call: false, whatsapp: false }],
      [tickedCall, { call: true, whatsapp: false }],
      [tickedBoth, { call: true, whatsapp: true }],
      [tollFree, { call: false, whatsapp: false }],
      [callOnly, { call: true, whatsapp: false }],
    ]);
    for (const [id, value] of expected) assert.deepEqual(options(id), value, id);
    // A listing has no business options.
    assert.equal(options(listing), undefined);
    for (const as of [anon, (sql) => member(stranger, sql)]) {
      const items = cards(as);
      assert.ok(items.length >= expected.size, `${items.length} cards`);
      for (const id of [...expected.keys(), undefined]) {
        const text = JSON.stringify(id ? cards(as, id) : items);
        assert.deepEqual(shows(text), [], id);
        assert.doesNotMatch(text, /(?<![0-9])(?:[+]?27|0)[1-8][0-9]{8}(?![0-9])/);
        assert.doesNotMatch(text, /business_contacts|"(?:phone|whatsapp)":"/);
      }
    }
  });

  await check("the owner's own read keeps the business's numbers", () => {
    const own = json(member(owner, `select api.get_my_frontend_post('${tickedCall}');`));
    assert.deepEqual(own.contacts, { phone: "0315550001", whatsapp: "0825550002" });
    assert.deepEqual(own.frontend.data.category_details.contact_methods, ["call", "form"]);
  });

  await check("a business that is not publicly live answers nothing", () => {
    assert.equal(reveal(draft, "call"), "");
    assert.equal(reveal(draft, "whatsapp"), "");
    q(`update private.posts set status='paused' where id='${landline}';
      select internal.write_post_projection('${landline}');`);
    assert.equal(reveal(landline, "call"), "");
  });

  await check(
    "listings and events are unchanged: the owner's number, only for a chosen channel",
    () => {
      assert.equal(reveal(listing, "call"), OWNER_PHONE);
      assert.equal(reveal(listing, "whatsapp"), "");
      assert.equal(reveal(event, "whatsapp"), OWNER_PHONE);
      assert.equal(reveal(event, "call"), "");
      assert.match(fails(service(revealSql(listing, "email")), "22023"), /invalid channel/);
    }
  );

  await check("grants unchanged; visitors and members cannot ask for a number", () => {
    const serviceOnly = { anon: false, authenticated: false, service_role: true };
    const nobody = { anon: false, authenticated: false, service_role: false };
    assert.deepEqual(
      executeGrants(json, ["api.reveal_post_phone(uuid,text)", REVEAL, PRESENTATION, NUMBER]),
      {
        "api.reveal_post_phone(uuid,text)": serviceOnly,
        [REVEAL]: serviceOnly,
        [PRESENTATION]: nobody,
        [NUMBER]: nobody,
      }
    );
    fails(anon(revealSql(mobile, "whatsapp")), "42501");
    fails(member(stranger, revealSql(mobile, "whatsapp")), "42501");
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
      "business contacts reveal: already applied; live businesses with a phone number: 8; with a WhatsApp number: 9; with a number not served: 5"
    );
  });

  await check("a business under a moderation hold, or archived, answers nothing", () => {
    // Before: both serve their numbers.
    assert.equal(reveal(spaced, "call"), "+27111234567");
    assert.equal(reveal(international, "call"), "+27311234567");
    q(`do $$begin
        perform set_config('session_replication_role','replica',true);
        insert into private.frontend_content_holds(id,post_id,account_id,reason,applied_at)
          values(gen_random_uuid(),'${spaced}','${owner.id}','Synthetic moderation hold.',now());
        update private.posts set status='archived',ended_at=now(),deletes_at=now()+interval '30 days'
          where id='${international}';
        perform set_config('session_replication_role','origin',true);
      end$$;`);
    for (const id of [spaced, international])
      for (const channel of ["call", "whatsapp"]) assert.equal(reveal(id, channel), "", id);
  });

  // ---------------------------------------------------------- later steps
  applySteps(database, steps.slice(index + 1));
  console.log(
    `PASS business contacts reveal: ${checks.length} checks in ${Math.round((Date.now() - started) / 1000)} s`
  );
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
