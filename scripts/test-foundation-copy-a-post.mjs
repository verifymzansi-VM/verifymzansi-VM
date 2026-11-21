#!/usr/bin/env node
// Behaviour checks for 20261121150309_copy_a_post.sql: a member whose
// Multi-listing package runs copies one of their own Market listings into a
// new draft (api.copy_my_post); a copy of a vehicle or property needs one new
// photo before review; reviewers see where a claimed post was copied from and
// the seller's live posts with the same photo bytes
// (api.get_frontend_staff_copy_facts); unfinished copies go after 14 days
// (internal.run_retention); the privacy export names the source.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members are written directly as the database owner (an accepted ID
// review as a synthetic identity fact); a package is bought through the
// package checkout and a synthetic Ozow notice, as the website's server does;
// listings, stored photos and claims are written as the database owner. The
// script checks the read-only preflight, a drifted body and a premature
// rollback, applies the update and proves apply -> rollback -> apply, then the
// behaviour.
//
//   node --import tsx scripts/test-foundation-copy-a-post.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { executeGrants, sqlLiteral } from "./lib/foundation-sql-checks.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  ozowSettle,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261121150309_copy_a_post.sql";
/** The Multi-listing package terms (20261114154823_slot_packages.sql). */
const K30 = { id: "5b0f4c1e-2a7d-4c43-9b51-7e0d3f6a9c11", cents: 10000 };
const COPY = "api.copy_my_post(uuid,uuid)";
const FACTS = "api.get_frontend_staff_copy_facts(uuid[])";
const INTERNAL = [
  "internal.copy_my_post(uuid,uuid)",
  "internal.get_frontend_staff_copy_facts(uuid[])",
  "internal.copy_new_photo_guard()",
  "internal.purge_copy_drafts(integer)",
];
const NOT_APPLIED = /^copy a post: update not applied; draft posts: \d+$/;
const APPLIED =
  /^copy a post: already applied; draft posts: \d+; copies: \d+; unfinished copies: \d+$/;

const SETUP = { update: UPDATE, label: "copypost", title: "Copy a post" };
await runTwoAdminUpdateCheck(SETUP, async ({ database, check, kit, world, admin }) => {
  const { q, json, fails, member, staff, service, preflight } = kit;

  // ------------------------------------------------------- synthetic world
  // A listing with stored photos (sha256 given), a video with its cover, a
  // logo, contact buttons and presentation fields, written as the owner.
  q(`create function vmtest.photo(p_owner uuid,p_sha text,p_kind text default 'image') returns uuid
      language plpgsql as $$
    declare oid uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
        values(oid,p_owner,p_kind,'media/'||gen_random_uuid(),1000,1000,p_sha,
          case p_kind when 'image' then 'image/jpeg' else 'video/mp4' end,1080,1920,'ready');
      return oid;
    end$$;
    create function vmtest.listing(p_owner uuid,p_category text,p_attrs jsonb,p_status text) returns uuid
      language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); begin
      perform set_config('session_replication_role','replica',true);
      insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id,status,
          published_at,visible_until)
        values(pid,p_owner,'listing','market',p_category,'Demo bakkie 2.4 GD-6',
          'A synthetic description long enough for every rule.','gp','gp_johannesburg',p_status,
          case when p_status='live' then now()-interval '1 day' end,
          case when p_status='live' then now()+interval '29 days' end);
      insert into private.listing_details(post_id,price_mode,price_cents,price_negotiable,attributes)
        values(pid,'amount',28990000,true,p_attrs);
      insert into private.post_contacts(post_id,post_kind,channels) values(pid,'listing',array['call','whatsapp']);
      insert into private.post_media(post_id,object_id,purpose,position,focal_x,focal_y) values
        (pid,vmtest.photo(p_owner,md5(pid::text||'a')||md5(pid::text||'A')),'cover',0,0.25,0.75),
        (pid,vmtest.photo(p_owner,md5(pid::text||'b')||md5(pid::text||'B')),'gallery',0,null,null),
        (pid,vmtest.photo(p_owner,md5(pid::text||'c')||md5(pid::text||'C')),'gallery',1,null,null),
        (pid,vmtest.photo(p_owner,md5(pid::text||'v')||md5(pid::text||'V'),'video'),'video',0,0.25,0.75);
      insert into private.post_presentations(post_id,data,contacts) values(pid,
        jsonb_build_object('location_town','Sandton','location_address','1 Synthetic Road','layout_width',1080,
          'layout_height',1920,'source_attributes',p_attrs),
        jsonb_build_object('phone','+27820000000'));
      insert into private.post_presentation_media(post_id,object_id,purpose,position) values
        (pid,vmtest.photo(p_owner,md5(pid::text||'l')||md5(pid::text||'L')),'logo',0),
        (pid,vmtest.photo(p_owner,md5(pid::text||'p')||md5(pid::text||'P')),'poster',0);
      perform set_config('session_replication_role','origin',true);
      return pid;
    end$$;`);
  const verified = (label) => world.verified(label, admin);
  const onSale = (value) =>
    q(
      `update private.slot_package_sales set on_sale=${value},changed_at=now(),reason='Fixture: switched for the checks';`
    );
  const buyPackage = (owner, slots) => {
    const quoted = json(
      member(
        owner,
        `select api.start_package_checkout('${K30.id}',${slots},${K30.cents * slots},true);`
      )
    );
    assert.equal(ozowSettle(kit, owner, quoted.payment_id).fulfillment_status, "fulfilled");
  };
  const VEHICLE = {
    make: "Toyota",
    model: "Hilux",
    year: 2019,
    mileage_km: 98000,
    transmission: "manual",
    fuel_type: "diesel",
    service_history: "full",
  };
  const listing = (owner, category = "vehicles", attrs = VEHICLE, status = "live") =>
    q(
      `select vmtest.listing('${owner.id}','${category}',${sqlLiteral(JSON.stringify(attrs))}::jsonb,'${status}');`
    );
  const copySql = (owner, post, request = randomUUID()) =>
    member(owner, `select api.copy_my_post('${post}','${request}');`);
  const copy = (owner, post, request) => json(copySql(owner, post, request));
  const row = (sql) => json(`select coalesce((${sql}),'null'::jsonb);`);
  const submit = (post) =>
    `update private.posts set status='pending_moderation',submitted_at=now() where id='${post}';`;
  const addPhoto = (owner, post, sha, position = 5) =>
    q(`set session_replication_role=replica;
       insert into private.post_media(post_id,object_id,purpose,position)
         values('${post}',vmtest.photo('${owner.id}','${sha}'),'gallery',${position});`);
  const freshSha = () =>
    (randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "")).slice(0, 64);

  // ------------------------------------------------------------ before
  await check("before the update: no copy command", () => {
    assert.equal(q(`select to_regprocedure('${COPY}') is null;`), "t");
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], NOT_APPLIED);
  });
  await check("drift and a premature rollback are refused", () => {
    assertDriftRefused(kit, {
      label: "copy a post",
      signatures: [
        "internal.run_retention(integer)",
        "internal.frontend_privacy_export_data(uuid)",
      ],
      rows: 2,
    });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "copy a post",
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  await check("grants: both commands for members only; helpers for nobody", () => {
    const grants = executeGrants(json, [COPY, FACTS, ...INTERNAL]);
    for (const fn of [COPY, FACTS, ...INTERNAL.slice(0, 2)])
      assert.deepEqual(grants[fn], { anon: false, authenticated: true, service_role: false }, fn);
    for (const fn of INTERNAL.slice(2))
      assert.deepEqual(grants[fn], { anon: false, authenticated: false, service_role: false }, fn);
    for (const fn of [COPY, FACTS])
      assert.equal(
        q(`select prosecdef from pg_proc where oid='${fn}'::regprocedure;`),
        "f",
        `${fn} is security invoker`
      );
    assert.equal(
      q(`select relrowsecurity from pg_class where oid='private.post_copies'::regclass;`),
      "t"
    );
    fails(member(world.user("copy-nobody"), "select * from private.post_copies;"), "42501");
  });

  // ------------------------------------------------------------- world
  onSale(true);
  const sipho = verified("copy-sipho");
  buyPackage(sipho, 10);
  // The current posting terms, accepted (every move into review checks them).
  q(`insert into private.posting_terms_acceptances(owner_id,version,document_hash)
     select '${sipho.id}',c.version,v.document_hash from private.posting_terms_current c
       join private.posting_terms_versions v on v.version=c.version;`);
  const bakkie = listing(sipho);

  await check(
    "a copy is a draft with the listing's fields, buttons, photos and logo, no video",
    () => {
      const request = randomUUID();
      const made = copy(sipho, bakkie, request);
      assert.equal(made.status, "draft");
      assert.equal(made.source_id, bakkie);
      assert.ok(made.id !== bakkie);
      const fields = (id) =>
        row(`select to_jsonb(x) from (select p.owner_id,p.kind,p.area,p.category_key,p.activity_key,p.title,p.description,
          p.province_id,p.city_id,p.locality_label,d.price_mode,d.price_cents,d.price_negotiable,d.attributes,
          d.attributes_version,c.channels from private.posts p join private.listing_details d on d.post_id=p.id
          join private.post_contacts c on c.post_id=p.id where p.id='${id}') x`);
      assert.deepEqual(fields(made.id), fields(bakkie));
      assert.equal(
        q(`select status||' '||(edit_of is null) from private.posts where id='${made.id}';`),
        "draft true"
      );
      // The same stored photo files and the cover's focal point; never the video.
      const media = (id) =>
        row(`select jsonb_agg(jsonb_build_array(purpose,position,object_id,focal_x,focal_y) order by purpose,position)
        from private.post_media where post_id='${id}'`);
      const source = media(bakkie);
      assert.deepEqual(
        media(made.id),
        source.filter((m) => m[0] !== "video")
      );
      assert.equal(source.length, 4);
      // The logo, not the video cover; no contact numbers; no video layout.
      assert.deepEqual(
        row(
          `select jsonb_agg(purpose) from private.post_presentation_media where post_id='${made.id}'`
        ),
        ["logo"]
      );
      assert.equal(
        q(`select object_id from private.post_presentation_media where post_id='${made.id}';`),
        q(
          `select object_id from private.post_presentation_media where post_id='${bakkie}' and purpose='logo';`
        )
      );
      const presentation = row(
        `select to_jsonb(p) from private.post_presentations p where post_id='${made.id}'`
      );
      assert.deepEqual(presentation.contacts, {});
      assert.equal(presentation.data.layout_width, null);
      assert.equal(presentation.data.layout_height, null);
      assert.equal(presentation.data.location_town, "Sandton");
      assert.equal(
        q(`select source_post_id from private.post_copies where post_id='${made.id}';`),
        bakkie
      );
      // A repeated request answers with the same copy; another post with it is refused.
      assert.deepEqual(copy(sipho, bakkie, request), made);
      assert.equal(
        q(`select count(*) from private.post_copies where request_id='${request}';`),
        "1"
      );
      fails(copySql(sipho, listing(sipho), request), "PT409", /copy request changed/);
    }
  );

  await check("only the owner's own submitted Market listing, while the package runs", () => {
    const other = verified("copy-other");
    fails(copySql(other, bakkie), "42501", /owned post unavailable/);
    fails(
      `set role anon;\nselect api.copy_my_post('${bakkie}','${randomUUID()}');`,
      "42501",
      /permission denied/
    );
    fails(
      copySql(sipho, listing(sipho, "vehicles", VEHICLE, "draft")),
      "22023",
      /submitted Market/
    );
    fails(copySql(sipho, world.post(sipho, "business", "business")), "22023", /submitted Market/);
    // Held by staff.
    const held = listing(sipho);
    q(`set session_replication_role=replica;
       insert into private.frontend_content_holds(id,post_id,account_id,reason,applied_at)
         values(gen_random_uuid(),'${held}','${sipho.id}','Fixture hold',now());`);
    fails(copySql(sipho, held), "PT423", /staff visibility hold/);
    // No running package (an Individual member or none at all).
    const solo = verified("copy-solo");
    fails(copySql(solo, listing(solo)), "PT402", /Multi-listing package/);
    // The draft allowance of the existing draft path (5 plus the package's places).
    const allowance = Number(q(`select internal.draft_allowance('${sipho.id}');`));
    const drafts = () =>
      Number(
        q(
          `select count(*) from private.posts where owner_id='${sipho.id}' and status='draft' and edit_of is null;`
        )
      );
    assert.ok(allowance >= 15, String(allowance));
    while (drafts() < allowance) copy(sipho, bakkie);
    fails(copySql(sipho, bakkie), "PT429", /draft limit/);
    q(`delete from private.posts where owner_id='${sipho.id}' and status='draft'
         and id in (select post_id from private.post_copies) and id not in (select post_id from private.post_copies
         where source_post_id='${bakkie}' order by created_at limit 1);`);
  });

  await check("a vehicle or property copy needs one new photo before review", () => {
    const made = copy(sipho, bakkie);
    fails(submit(made.id), "22023", /new photo/);
    // The same bytes uploaded again are not a new photo.
    const sameSha = q(
      `select m.sha256 from private.post_media pm join private.media_objects m on m.id=pm.object_id
        where pm.post_id='${bakkie}' and pm.purpose='cover';`
    );
    addPhoto(sipho, made.id, sameSha);
    fails(submit(made.id), "22023", /new photo/);
    addPhoto(sipho, made.id, freshSha(), 6);
    q(submit(made.id));
    assert.equal(
      q(`select status from private.posts where id='${made.id}';`),
      "pending_moderation"
    );
    // Property too; other categories need none.
    const house = listing(sipho, "property", {
      property_type: "house",
      listing_intent: "sale",
      bedrooms: 3,
    });
    fails(submit(copy(sipho, house).id), "22023", /new photo/);
    const phone = listing(sipho, "electronics", {});
    const phoneCopy = copy(sipho, phone);
    q(submit(phoneCopy.id));
    // With the source deleted there is nothing to compare with.
    const gone = copy(sipho, listing(sipho));
    q(
      `delete from private.posts where id=(select source_post_id from private.post_copies where post_id='${gone.id}');`
    );
    assert.equal(
      q(`select source_post_id is null from private.post_copies where post_id='${gone.id}';`),
      "t"
    );
    q(submit(gone.id));
    // A post that is not a copy is never checked.
    q(submit(listing(sipho, "vehicles", VEHICLE, "draft")));
  });

  await check("deleting either post keeps the other's photos", () => {
    const source = listing(sipho);
    const made = copy(sipho, source);
    const shared = q(
      `select object_id from private.post_media where post_id='${made.id}' and purpose='cover';`
    );
    q(`delete from private.posts where id='${source}';`);
    assert.equal(q(`select internal.media_object_in_use('${shared}');`), "t");
    // The cleanup claims nothing in use, even a day after the unlink.
    q(`update private.media_objects set created_at=now()-interval '3 days',unlinked_at=now()-interval '2 days'
         where id='${shared}';`);
    const claimed = json(service(`select api.claim_media_cleanup(500);`));
    assert.ok(!claimed.some((c) => c.object_id === shared));
    const back = copy(sipho, listing(sipho));
    const keep = q(
      `select object_id from private.post_media where post_id='${back.source_id}' and purpose='cover';`
    );
    q(`delete from private.posts where id='${back.id}';`);
    assert.equal(q(`select internal.media_object_in_use('${keep}');`), "t");
  });

  await check("reviewers see the source and identical photos of claimed posts only", () => {
    const moderator = world.staffUser("copy-moderator", "moderator");
    const source = listing(sipho);
    const made = copy(sipho, source);
    addPhoto(sipho, made.id, freshSha(), 6);
    q(submit(made.id));
    const facts = (posts, who = moderator) =>
      json(
        staff(
          who,
          `select api.get_frontend_staff_copy_facts(array[${posts.map((p) => `'${p}'`).join(",")}]::uuid[]);`
        )
      );
    // LIM-SQL-copy-facts-posts (at most 25 posts) and LIM-SQL-copy-facts-same-photos
    // (at most 10 live posts per reviewed post) are checked below.
    // Not claimed: nothing.
    assert.deepEqual(facts([made.id]), { items: [] });
    q(`insert into private.queue_claims(post_id,claimed_by,claim_generation,claim_nonce,claimed_at,claim_expires_at)
       values('${made.id}','${moderator.id}',1,gen_random_uuid(),now(),now()+interval '15 minutes')
       on conflict(post_id) do update set claimed_by=excluded.claimed_by,claim_generation=excluded.claim_generation,
         claim_nonce=excluded.claim_nonce,claimed_at=excluded.claimed_at,claim_expires_at=excluded.claim_expires_at;`);
    const seen = facts([made.id, source]);
    assert.equal(seen.items.length, 1);
    const item = seen.items[0];
    assert.equal(item.post_id, made.id);
    assert.deepEqual(item.copied_from, {
      id: source,
      title: "Demo bakkie 2.4 GD-6",
      status: "live",
    });
    // The source and every other live post of the seller sharing a photo.
    const shared = item.same_photos.find((p) => p.id === source);
    assert.equal(shared.photos, 3);
    assert.equal(shared.title, "Demo bakkie 2.4 GD-6");
    assert.ok(item.same_photos.length <= 10);
    assert.ok(item.same_photos.every((p) => p.id !== made.id));
    // An expired claim shows nothing; members and anon are refused.
    q(`update private.queue_claims set claimed_at=now()-interval '1 hour',claim_expires_at=now()-interval '1 minute'
         where post_id='${made.id}';`);
    assert.deepEqual(facts([made.id]), { items: [] });
    fails(
      member(sipho, `select api.get_frontend_staff_copy_facts(array['${made.id}']::uuid[]);`),
      "42501"
    );
    fails(
      `set role anon;\nselect api.get_frontend_staff_copy_facts(array['${made.id}']::uuid[]);`,
      "42501"
    );
    const many = Array.from({ length: 26 }, () => randomUUID());
    assert.match(
      fails(
        staff(
          moderator,
          `select api.get_frontend_staff_copy_facts(array[${many.map((p) => `'${p}'`).join(",")}]::uuid[]);`
        ),
        "22023"
      ),
      /up to 25 posts/
    );
    // A stale authenticator code is refused like every staff read.
    fails(
      staff(
        moderator,
        `select api.get_frontend_staff_copy_facts(array['${made.id}']::uuid[]);`,
        Math.floor(Date.now() / 1000) - 13 * 3600
      ),
      "42501"
    );
  });

  await check("unfinished copies go 14 days after their last change", () => {
    q(`delete from private.posts where owner_id='${sipho.id}' and status='draft';`);
    const old = copy(sipho, listing(sipho));
    const recent = copy(sipho, listing(sipho));
    const plainDraft = listing(sipho, "vehicles", VEHICLE, "draft");
    const submitted = copy(sipho, listing(sipho, "electronics", {}));
    q(submit(submitted.id));
    q(`update private.posts set content_updated_at=now()-interval '15 days'
         where id in ('${old.id}','${plainDraft}','${submitted.id}');
       update private.posts set content_updated_at=now()-interval '13 days' where id='${recent.id}';`);
    // LIM-F-purge_copy_drafts (1 to 5000) and LIM-SQL-copy-draft-age (14 days).
    fails(`select internal.purge_copy_drafts(0);`, "22023", /limit 1 to 5000/);
    fails(`select internal.purge_copy_drafts(5001);`, "22023", /limit 1 to 5000/);
    // During a legal hold nothing of the member's goes.
    q(`insert into private.legal_holds(subject_id,reason,placed_by)
         values('${sipho.id}','Fixture legal hold for the checks','${admin.id}');`);
    assert.equal(json(service(`select api.run_retention(100);`)).copy_drafts, 0);
    q(
      `update private.legal_holds set released_at=now(),released_by='${admin.id}' where subject_id='${sipho.id}';`
    );
    const result = json(service(`select api.run_retention(100);`));
    assert.equal(result.copy_drafts, 1);
    const left = (id) => q(`select count(*) from private.posts where id='${id}';`);
    assert.equal(left(old.id), "0");
    assert.equal(left(recent.id), "1");
    assert.equal(left(plainDraft), "1", "a draft that is not a copy stays");
    assert.equal(left(submitted.id), "1", "a submitted copy stays");
    assert.equal(left(old.source_id), "1", "the source stays");
    assert.equal(json(service(`select api.run_retention(100);`)).copy_drafts, 0);
  });

  await check("the privacy export names the source of each copy", () => {
    const made = copy(sipho, bakkie);
    const exported = json(`select internal.frontend_privacy_export_data('${sipho.id}');`);
    const posts = new Map(exported.posts.map((p) => [p.id, p]));
    assert.equal(posts.get(made.id).copied_from, bakkie);
    assert.equal(posts.get(bakkie).copied_from, null);
    assert.equal(Object.keys(exported).length, 42, "no new dataset");
  });

  await check("the preflight counts copies after the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"]
    );
    assert.match(rows[0][1], APPLIED);
    assert.match(rows[0][1], /copies: [1-9]/);
  });
});
