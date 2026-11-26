#!/usr/bin/env node
// Behaviour checks for 20261126001956_video_length_checked.sql (launch
// checklist item 39, roadmap M4.4 part B): the database stores each video's
// length and checks it at submit (events 1 minute, everything else 2
// minutes), staff see it, and storage grows with paid slots.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of the staff payment checks (members and
// staff written directly as the database owner, accepted ID reviews as
// synthetic identity facts, members and staff acting through the production
// API commands with synthetic sessions). Before the update it publishes two
// events with a video and leaves a listing draft with one (videos stored
// without a length). It checks the read-only preflight, a drifted body and a
// premature rollback, applies the update and proves apply -> rollback ->
// apply, then checks: the grants; the upload server's video completion
// (stores the length, refuses 121 s, no length or a picture, replays
// idempotently, never changes it); submitting a listing with a 120.999 s
// video passes and with 121 s is refused with the length and the limit; an
// event with a 60.999 s video passes and with 61 s (a listing's video reused)
// is refused; a video without a stored length passes (a submit, and a paused
// event reactivated), while a known over-limit length is still refused at
// reactivation; an edit of the published event keeps its old video but may
// not swap in a longer one; staff holding the review claim see each length,
// nobody else does; and storage grows from 1 GB to 21 GB with 100 paid slots,
// which hold 100 two-minute videos.
//
// Limits register: LIM-APP-video-length, LIM-APP-event-video-length,
// LIM-SQL-staff-video-lengths-posts.
//
//   node --import tsx scripts/test-foundation-video-length.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { assertReadOnlyPreflight, executeGrants } from "./lib/foundation-sql-checks.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  buyPackage,
  functionBodyMd5,
  postReviewHelpers,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261126001956_video_length_checked.sql";
const GUARD = "internal.media_object_transition_guard()";
const REVIEWED = "98c0d44cf27009757ed8db343d308f0a";
const UPDATED = "c0354cb254c330c832d03ba5fdda2242";
const LABEL = "video length check";
const NOT_APPLIED =
  /^video length check: update not applied; videos stored: \d+; posts waiting with a video: \d+ \(events: \d+\)$/;
const APPLIED =
  /^video length check: already applied; videos stored: \d+; posts waiting with a video: \d+ \(events: \d+\)$/;
const COMPLETE = "api.complete_frontend_video_upload(uuid,integer,text,text,integer)";
const LENGTHS = "api.get_frontend_staff_video_lengths(uuid[])";
const MB = 1024 * 1024;

const SETUP = { update: UPDATE, label: "vlen", title: "Video length" };
await runTwoAdminUpdateCheck(SETUP, async (run) => {
  const { database, check, kit, world, admin, admin2 } = run;
  const { q, json, fails, member, staff, service, preflight } = kit;
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
  const { row, approveSql } = postReviewHelpers(kit);

  // Ready posting: the current posting terms accepted; drafts with a cover and
  // the form contact channel, written directly as the database owner; a
  // video object (a stored length only once the column exists).
  // Each event draft starts on its own day, so none is a duplicate of another.
  q(`create sequence vmtest.event_day;
    create function vmtest.terms(p_owner uuid) returns void language sql as $$
      insert into private.posting_terms_acceptances(owner_id,version,document_hash)
        select p_owner,v.version,v.document_hash from private.posting_terms_current c
          join private.posting_terms_versions v using(version) where c.singleton
      on conflict do nothing $$;
    create function vmtest.image(p_owner uuid) returns uuid language plpgsql as $$
    declare id uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
        values(id,p_owner,'image','media/'||id,1024,1024,encode(sha256(convert_to(id::text,'UTF8')),'hex'),'image/jpeg',800,600,'ready');
      return id;
    end$$;
    create function vmtest.video(p_owner uuid) returns uuid language plpgsql as $$
    declare id uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,state)
        values(id,p_owner,'video','media/'||id,2048,2048,encode(sha256(convert_to(id::text,'UTF8')),'hex'),'video/mp4','ready');
      return id;
    end$$;
    create function vmtest.draft(p_owner uuid,p_kind text,p_video uuid) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cat text; begin
      if p_kind='event' then
        insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
          values(pid,p_owner,'event','tourism_events','events',(select a.key from private.category_activities a
              join private.categories c on c.key=a.category_key where a.category_key='events' and c.activity_required
              order by a.key limit 1),
            'Video event '||left(pid::text,8),'A synthetic description long enough for every rule.','gp','gp_johannesburg');
        insert into private.event_details(post_id,starts_at,ends_at,timezone)
          values(pid,date_trunc('milliseconds',now()+make_interval(days=>20+2*nextval('vmtest.event_day')::integer)),
            date_trunc('milliseconds',now()+make_interval(days=>21+2*nextval('vmtest.event_day')::integer)),'Africa/Johannesburg');
      else
        insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id)
          values(pid,p_owner,'listing','market','other_items','Video listing '||left(pid::text,8),
            'A synthetic description long enough for every rule.','gp','gp_johannesburg');
        insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
      end if;
      insert into private.post_contacts(post_id,post_kind,channels) values(pid,p_kind,array['form']);
      insert into private.post_media(post_id,object_id,purpose,position) values(pid,vmtest.image(p_owner),'cover',0);
      if p_video is not null then
        insert into private.post_media(post_id,object_id,purpose,position) values(pid,p_video,'video',0);
      end if;
      return pid;
    end$$;`);
  // Multi-listing packages on sale for the checks; the seller holds 10 slots
  // (the free week funds one waiting post only).
  q(
    "update private.slot_package_sales set on_sale=true,changed_at=now(),reason='Fixture: switched for the checks';"
  );
  const seller = world.verified("vlen-seller", admin);
  q(`select vmtest.terms('${seller.id}');`);
  buyPackage(kit, seller, 10);
  const moderator = world.staffUser("vlen-mod", "moderator");
  world.review(moderator, admin2, "vlen-mod");
  const videoObject = (owner = seller) => q(`select vmtest.video('${owner.id}');`);
  const draft = (kind, video) =>
    q(`select vmtest.draft('${seller.id}','${kind}',${video ? `'${video}'` : "null"});`);
  const submitSql = (id) => member(seller, `select api.submit_post('${id}',${row(id).revision});`);
  const submit = (id) => json(submitSql(id));
  const approve = (id) => json(approveSql(admin2, id));

  // ------------------------------------------------------------ before
  let liveEvent;
  let liveEventVideo;
  let pausedEvent;
  let pausedEventVideo;
  let oldDraft;
  await check(
    "before the update: two events with a video go live, a listing draft holds one",
    () => {
      assert.equal(bodyMd5(GUARD), REVIEWED);
      liveEventVideo = videoObject();
      liveEvent = draft("event", liveEventVideo);
      pausedEventVideo = videoObject();
      pausedEvent = draft("event", pausedEventVideo);
      for (const id of [liveEvent, pausedEvent]) {
        assert.equal(submit(id).status, "pending_moderation");
        approve(id);
        assert.equal(row(id).status, "live");
      }
      oldDraft = draft("listing", videoObject());
    }
  );
  await check(
    "preflight: one read-only summary row before the update; early rollback and drift refused",
    () => {
      const [summary, ...problems] = preflight();
      assert.deepEqual(problems, []);
      assert.equal(summary[0], "summary");
      assert.match(summary[1], NOT_APPLIED);
      assertReadOnlyPreflight(database, kit.preflightSql);
      assertDriftRefused(kit, { label: LABEL, signatures: [GUARD], rows: 2 });
    }
  );

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: LABEL,
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  // ------------------------------------------------------------- after
  await check("only the upload server completes a video; staff read lengths", () => {
    assert.equal(bodyMd5(GUARD), UPDATED);
    assert.deepEqual(executeGrants(json, [COMPLETE, LENGTHS]), {
      [COMPLETE]: { anon: false, authenticated: false, service_role: true },
      [LENGTHS]: { anon: false, authenticated: true, service_role: false },
    });
    for (const fn of [
      "internal.complete_frontend_video_upload(uuid,integer,text,text,integer)",
      "internal.get_frontend_staff_video_lengths(uuid[])",
      "internal.guard_video_length_submission()",
    ]) {
      assert.equal(q(`select has_function_privilege('anon','${fn}','execute');`), "f", fn);
    }
  });

  await check("the stored length is for videos only, 1 to 120 999 ms", () => {
    const video = videoObject();
    const image = q(`select vmtest.image('${seller.id}');`);
    fails(
      `update private.media_objects set duration_ms=1000 where id='${image}';`,
      "23514",
      /media_objects_duration_ms_check/
    );
    fails(
      `update private.media_objects set duration_ms=121000 where id='${video}';`,
      "23514",
      /media_objects_duration_ms_check/
    );
    fails(
      `update private.media_objects set duration_ms=0 where id='${video}';`,
      "23514",
      /media_objects_duration_ms_check/
    );
    q(`update private.media_objects set duration_ms=120999 where id='${video}';`);
    fails(
      `update private.media_objects set duration_ms=1000 where id='${video}';`,
      "23514",
      /video length is immutable/
    );
    fails(
      `update private.media_objects set duration_ms=null where id='${video}';`,
      "23514",
      /video length is immutable/
    );
  });

  // A real content-bound upload: the member reserves, the server completes.
  let digestSeed = 0;
  const reserve = (owner, kind = "video", bytes = 4096) => {
    const digest = createHash("sha256").update(`vlen-${digestSeed++}`).digest("hex");
    const r = json(
      member(owner, `select api.reserve_frontend_media_upload('${kind}',${bytes},'${digest}');`)
    );
    return { id: r.object_id, digest, bytes };
  };
  const completeVideoSql = (u, ms, mime = "video/mp4") =>
    service(
      `select api.complete_frontend_video_upload('${u.id}',${u.bytes},'${u.digest}','${mime}',${ms});`
    );
  const stored = (id) =>
    json(
      `select jsonb_build_object('state',state,'duration_ms',duration_ms) from private.media_objects where id='${id}';`
    );

  await check("the server's video completion stores the length and replays idempotently", () => {
    const u = reserve(seller);
    assert.deepEqual(json(completeVideoSql(u, 95_500)), { object_id: u.id, state: "ready" });
    assert.deepEqual(stored(u.id), { state: "ready", duration_ms: 95_500 });
    assert.deepEqual(json(completeVideoSql(u, 95_500)), { object_id: u.id, state: "ready" });
    fails(completeVideoSql(u, 95_000), "PT409", /upload completion changed/);
    assert.deepEqual(stored(u.id), { state: "ready", duration_ms: 95_500 });
  });

  await check("it refuses 121 s, no length, a picture and a member caller", () => {
    const u = reserve(seller);
    for (const ms of [121_000, 0, "null"])
      assert.match(fails(completeVideoSql(u, ms), "22023"), /video_length_invalid/);
    assert.deepEqual(stored(u.id), { state: "intent", duration_ms: null });
    const picture = reserve(seller, "image");
    fails(completeVideoSql(picture, 10_000, "image/jpeg"), "22023", /video upload required/);
    fails(
      member(
        seller,
        `select api.complete_frontend_video_upload('${u.id}',${u.bytes},'${u.digest}','video/mp4',1000);`
      ),
      "42501"
    );
  });

  const withLength = (ms) => {
    const id = videoObject();
    q(`update private.media_objects set duration_ms=${ms} where id='${id}';`);
    return id;
  };
  let pendingListing;
  let listingVideo;
  await check(
    "a listing with a 120.999 s video is submitted (no stored length exceeds 2 minutes)",
    () => {
      pendingListing = draft("listing", withLength(120_999));
      assert.equal(submit(pendingListing).status, "pending_moderation");
      listingVideo = q(
        `select object_id from private.post_media where post_id='${pendingListing}' and purpose='video';`
      );
    }
  );

  await check(
    "an event with a 60.999 s video is submitted; with 61 s or a listing's 90 s video it is refused",
    () => {
      assert.equal(submit(draft("event", withLength(60_999))).status, "pending_moderation");
      const sixtyOne = draft("event", withLength(61_000));
      const refusal = fails(submitSql(sixtyOne), "22023", /longer than this post allows/);
      assert.match(refusal, /video_too_long/);
      assert.match(refusal, /HINT:\s+61\/60/);
      assert.equal(row(sixtyOne).status, "draft");
      // A listing's video reused in an event (the media reuse window).
      const reused = draft("event", withLength(90_000));
      assert.match(fails(submitSql(reused), "22023"), /HINT:\s+90\/60/);
      const listingReuse = draft("event", listingVideo);
      assert.match(fails(submitSql(listingReuse), "22023"), /HINT:\s+120\/60/);
    }
  );

  await check("a video stored before the update (no stored length) is submitted", () => {
    const oldVideo = q(
      `select object_id from private.post_media where post_id='${oldDraft}' and purpose='video';`
    );
    assert.equal(stored(oldVideo).duration_ms, null);
    assert.equal(submit(oldDraft).status, "pending_moderation");
  });

  const postAction = (id, action) =>
    member(
      seller,
      `select api.execute_my_frontend_post_action('${randomUUID()}','${id}',${row(id).revision},'${action}','event','tourism_events');`
    );
  await check(
    "a paused event with a pre-update video reactivates; with a known 75 s video it is refused",
    () => {
      assert.equal(stored(pausedEventVideo).duration_ms, null);
      json(postAction(pausedEvent, "deactivate"));
      assert.equal(row(pausedEvent).status, "paused");
      assert.equal(json(postAction(pausedEvent, "reactivate")).status, "live");
      assert.equal(row(pausedEvent).status, "live");
      // The same video, now with a known length over the event limit.
      q(`update private.media_objects set duration_ms=75000 where id='${pausedEventVideo}';`);
      json(postAction(pausedEvent, "deactivate"));
      const refusal = fails(postAction(pausedEvent, "reactivate"), "22023", /video_too_long/);
      assert.match(refusal, /HINT:\s+75\/60/);
      assert.equal(row(pausedEvent).status, "paused");
    }
  );

  await check(
    "an edit of the published event keeps its old video (no stored length) but may not swap in a longer one",
    () => {
      const edit = json(
        member(seller, `select api.create_post_edit('${liveEvent}',${row(liveEvent).revision});`)
      ).id;
      assert.equal(
        q(`select object_id from private.post_media where post_id='${edit}' and purpose='video';`),
        liveEventVideo
      );
      q(
        `update private.post_media set object_id='${withLength(75_000)}' where post_id='${edit}' and purpose='video';`
      );
      assert.match(fails(submitSql(edit), "22023"), /HINT:\s+75\/60/);
      q(
        `update private.post_media set object_id='${liveEventVideo}' where post_id='${edit}' and purpose='video';`
      );
      q(`update private.posts set title='Video event, new title' where id='${edit}';`);
      assert.equal(submit(edit).status, "pending_moderation");
    }
  );

  await check("staff holding the review claim see each length; nobody else does", () => {
    const lengthsSql = (who, ids) =>
      staff(
        who,
        `select api.get_frontend_staff_video_lengths(array[${ids.map((i) => `'${i}'::uuid`).join(",")}]);`
      );
    const unknownPending = draft("listing", null);
    assert.equal(submit(unknownPending).status, "pending_moderation");
    assert.deepEqual(json(lengthsSql(admin2, [pendingListing, oldDraft])), []);
    json(staff(admin2, `select api.claim_queue_item('post','${pendingListing}');`));
    json(staff(admin2, `select api.claim_queue_item('post','${unknownPending}');`));
    assert.deepEqual(json(lengthsSql(admin2, [pendingListing, unknownPending, oldDraft])), [
      { post_id: pendingListing, duration_ms: 120_999 },
    ]);
    // Another reviewer, without the claim, sees nothing of that post.
    assert.deepEqual(json(lengthsSql(moderator, [pendingListing])), []);
    fails(
      member(
        seller,
        `select api.get_frontend_staff_video_lengths(array['${pendingListing}'::uuid]);`
      ),
      "42501"
    );
    fails(staff(admin2, "select api.get_frontend_staff_video_lengths(array[]::uuid[]);"), "22023");
    fails(
      staff(
        admin2,
        `select api.get_frontend_staff_video_lengths(array_fill('${pendingListing}'::uuid,array[51]));`
      ),
      "22023"
    );
    fails(
      staff(admin2, "select api.get_frontend_staff_video_lengths(array[null]::uuid[]);"),
      "22023"
    );
  });

  await check("approving a submitted post is unchanged", () => {
    approve(oldDraft);
    assert.equal(row(oldDraft).status, "live");
  });

  await check("storage grows with paid slots: 1 GB without a package, 21 GB with 100 slots", () => {
    const buyer = world.verified("vlen-buyer", admin);
    q(`select vmtest.terms('${buyer.id}');`);
    const allowance = () => Number(q(`select internal.media_storage_allowance('${buyer.id}');`));
    assert.equal(allowance(), 10 * 100 * MB);
    // Without a package: 1 GB holds 41 two-minute videos (24 MB), not 42.
    q(`insert into private.media_objects(owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,state,duration_ms)
        select '${buyer.id}','video','media/'||gen_random_uuid(),${24 * MB},${24 * MB},
          encode(sha256(convert_to(g::text||'${buyer.id}','UTF8')),'hex'),'video/mp4','ready',120000
        from generate_series(1,41) g;`);
    fails(
      member(
        buyer,
        `select api.reserve_frontend_media_upload('video',${24 * MB},'${createHash("sha256").update("vlen-full").digest("hex")}');`
      ),
      "PT409",
      /storage for your package is full/
    );
    // A paid 10-slot package (the most one online payment buys) adds 2 GB.
    buyPackage(kit, buyer, 10);
    assert.equal(allowance(), (2 * 10 + 10) * 100 * MB);
    // 90 more slots (a stand-in for further paid packages, written directly as
    // the database owner) make 100: 21 GB.
    q(`insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
        values('${buyer.id}','staff_grant','${admin.id}',90,10,1,now(),now()+interval '30 days');`);
    assert.equal(allowance(), (2 * 100 + 10) * 100 * MB);
    // 100 paid slots hold 100 two-minute videos (59 more, uploaded in rounds
    // of up to 19 so the 20-unfinished-uploads limit never applies).
    let added = 0;
    while (added < 59) {
      const round = Math.min(19, 59 - added);
      const uploads = Array.from({ length: round }, () => reserve(buyer, "video", 24 * MB));
      for (const u of uploads) assert.equal(json(completeVideoSql(u, 120_000)).state, "ready");
      added += round;
    }
    assert.equal(
      q(
        `select count(*) from private.media_objects where owner_id='${buyer.id}' and kind='video' and state='ready';`
      ),
      "100"
    );
  });
});
