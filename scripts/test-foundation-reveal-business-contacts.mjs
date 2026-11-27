#!/usr/bin/env node
// Behaviour checks for 20261127055550_reveal_business_contacts.sql: the
// click-to-view command (api.reveal_post_phone, service only) answers for a
// publicly live business with the number the business chose, in +27 form
// (any South African number for a call, a mobile only for WhatsApp), while
// listings and events keep the owner's verified number for a chosen channel.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Synthetic members and posts are written directly as the database
// owner. It checks the read-only preflight (counts only), a drifted body and a
// premature rollback, applies the update and proves apply -> rollback -> apply
// (a repeated run changes nothing), then checks the answers per post and
// channel, that visitors and members still cannot run the command, and that no
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
const summary = (state) =>
  new RegExp(
    `^business contacts reveal: ${state}; live businesses with a phone number: \\d+; with a WhatsApp number: \\d+; with a number not served: \\d+$`
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
    -- p_contacts and contact choices p_channels (listings and events).
    create or replace function vmtest.post(p_owner uuid,p_slot uuid,p_kind text,p_contacts jsonb,p_channels text[],p_live boolean)
      returns uuid language plpgsql as $$
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
      insert into private.post_presentations(post_id,data,contacts) values(pid,'{}'::jsonb,p_contacts);
      if p_live then
        insert into private.post_activations(post_id,entitlement_id,owner_id) values(pid,p_slot,p_owner);
        update private.posts set status='live',published_at=now()-interval '1 minute',visible_until=now()+interval '30 days'
          where id=pid;
        perform internal.write_post_projection(pid);
      end if;
      return pid;
    end$$;`);
  const slot = q(`select vmtest.slot('${owner.id}');`);
  const post = (kind, contacts, { channels = ["form"], live = true } = {}) =>
    q(
      `select vmtest.post('${owner.id}','${slot}','${kind}',${sqlJsonb(contacts)},array[${channels
        .map((c) => `'${c}'`)
        .join(",")}]::text[],${live});`
    );
  const revealSql = (id, channel) => `select api.reveal_post_phone('${id}','${channel}');`;
  const reveal = (id, channel) => q(service(revealSql(id, channel)));

  let landline, mobile, spaced, international, landlineOnWhatsapp, odd, none, draft, listing, event;
  await check("before the update: the world, and businesses answer nothing", () => {
    landline = post("business", { phone: "0311234567", whatsapp: null });
    mobile = post("business", { phone: null, whatsapp: "0821234567" });
    spaced = post("business", { phone: "(011) 123-4567", whatsapp: "082 765 4321" });
    international = post("business", { phone: "27311234567", whatsapp: "+27721234567" });
    landlineOnWhatsapp = post("business", { phone: "0311234567", whatsapp: "0311234567" });
    odd = post("business", { phone: "0911234567", whatsapp: "12345" });
    none = post("business", { phone: "", whatsapp: null });
    draft = post("business", { phone: "0311234567", whatsapp: "0821234567" }, { live: false });
    listing = post("listing", {}, { channels: ["call", "form"] });
    event = post("event", {}, { channels: ["whatsapp", "form"] });
    for (const id of [landline, mobile, spaced])
      for (const channel of ["call", "whatsapp"]) assert.equal(reveal(id, channel), "", id);
    assert.equal(reveal(listing, "call"), OWNER_PHONE);
    assert.equal(reveal(event, "whatsapp"), OWNER_PHONE);
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
      "business contacts reveal: update not applied; live businesses with a phone number: 5; with a WhatsApp number: 5; with a number not served: 2"
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
        signatures: [REVEAL],
        drift: /business contacts reveal precondition: internal\.reveal_post_phone/,
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
    assert.deepEqual(executeGrants(json, ["api.reveal_post_phone(uuid,text)", REVEAL]), {
      "api.reveal_post_phone(uuid,text)": { anon: false, authenticated: false, service_role: true },
      [REVEAL]: { anon: false, authenticated: false, service_role: true },
    });
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
      "business contacts reveal: already applied; live businesses with a phone number: 4; with a WhatsApp number: 5; with a number not served: 2"
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
