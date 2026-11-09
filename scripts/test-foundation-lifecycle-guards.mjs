#!/usr/bin/env node
// Behaviour checks for database/foundation/updates/20261109073519_post_lifecycle_guards.sql.
//
// Replays database/foundation (prelude, candidate.sql, every update) into the
// throwaway, network-less Postgres 17 container used by the SQL lint gate,
// seeds synthetic members and posts before the update, applies the update
// itself, and checks the backfills, the guards and their concurrency through
// the production API commands (member calls run as `authenticated` with
// synthetic claims and a live session row; jobs as `service_role`).
//
//   node --import tsx scripts/test-foundation-lifecycle-guards.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. The
// only stand-in is internal.current_verified_identity (identity review is
// covered by its own suites), replaced after the update so free events can
// reach the fair-use branch of internal.submit_post.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { replaySteps } from "./lib/foundation-replay.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";
import { buildRestoredPostInput } from "../src/lib/foundation/restored-post-input.ts";

const UPDATE = "20261109073519_post_lifecycle_guards.sql";
const TERMS = {
  version: "posting-v1",
  document_hash: "RAXTzmTyM5iMYeLy8Xv_NvnvzqsjUKPYq5hQaqqNS1Q",
};
const checks = [];
let current = "start";

function check(id, fn) {
  current = id;
  return Promise.resolve(fn()).then(() => {
    checks.push(id);
    console.log(`PASS ${id}`);
  });
}

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps } = replaySteps();
  const index = steps.findIndex((step) => step.label === UPDATE);
  assert.ok(index > 0, `${UPDATE} is missing`);
  applySteps(database, steps.slice(0, index));

  // ---------------------------------------------------------------- helpers
  const run = (sql) => database.psql(`\\set VERBOSITY verbose\n${sql}`, ["-A", "-t"]);
  const q = (sql) => {
    const result = run(sql);
    if (result.status !== 0) throw new Error(`[${current}] SQL failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  const json = (sql) => JSON.parse(q(sql));
  const claims = (user) =>
    JSON.stringify({
      sub: user.id,
      role: "authenticated",
      session_id: user.session,
      aal: "aal1",
      is_anonymous: false,
    });
  const member = (user, sql) =>
    `\\o /dev/null\nselect set_config('request.jwt.claim.sub','${user.id}',false),set_config('request.jwt.claims','${claims(user)}',false);\n\\o\nset role authenticated;\n${sql}`;
  const service = (sql) => `set role service_role;\n${sql}`;
  const fails = (sql, state) => {
    const result = run(sql);
    assert.notEqual(result.status, 0, `[${current}] expected ${state}, the command succeeded`);
    const sqlstate = /ERROR:\s+([0-9A-Z]{5}):/.exec(result.stderr)?.[1];
    assert.equal(sqlstate, state, `[${current}] ${result.stderr}`);
    return result.stderr;
  };
  const job = () => json(service("select api.run_post_lifecycle(500);"));
  const cleanup = () => json(service("select api.claim_media_cleanup(500);"));
  const scalar = (sql) => q(sql);

  // ------------------------------------------------------- synthetic world
  q(`create schema vmtest;
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      insert into private.posting_terms_acceptances(owner_id,version,document_hash)
        values(uid,'${TERMS.version}','${TERMS.document_hash}');
      return jsonb_build_object('id',uid,'session',sid);
    end$$;
    create function vmtest.media(p_owner uuid) returns uuid language plpgsql as $$
    declare oid uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
        values(oid,p_owner,'image','media/'||oid,1024,1024,encode(sha256(convert_to(oid::text,'UTF8')),'hex'),'image/jpeg',800,600,'ready');
      return oid;
    end$$;
    -- A post in the given state, with one ready cover image and the form
    -- contact channel. Ages are days before now.
    create function vmtest.post(p_owner uuid,p_kind text,p_status text,p_status_age integer default 0,
      p_submitted_age integer default null,p_reason text default null) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cover uuid:=vmtest.media(p_owner); area text; cat text; begin
      area:=case p_kind when 'listing' then 'market' when 'business' then 'business' else 'tourism_events' end;
      cat:=case p_kind when 'listing' then 'other_items' when 'business' then 'general_other' else 'events' end;
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
        values(pid,p_owner,p_kind,area,cat,(select a.key from private.category_activities a join private.categories c on c.key=a.category_key
          where a.category_key=cat and c.activity_required order by a.key limit 1),
          'Fixture '||p_kind||' '||left(pid::text,8),'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      if p_kind='listing' then insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
      elsif p_kind='business' then insert into private.business_details(post_id) values(pid);
      else insert into private.event_details(post_id,starts_at,ends_at,timezone)
        values(pid,date_trunc('milliseconds',now()+interval '20 days'),date_trunc('milliseconds',now()+interval '21 days'),'Africa/Johannesburg'); end if;
      if p_kind<>'business' then insert into private.post_contacts(post_id,post_kind,channels) values(pid,p_kind,array['form']); end if;
      insert into private.post_media(post_id,object_id,purpose,position) values(pid,cover,'cover',0);
      if p_status in('live','expired','sold','archived','paused') then
        update private.posts set status='live',published_at=now()-interval '40 days',visible_until=now()+interval '5 days' where id=pid;
      end if;
      if p_status<>'draft' and p_status<>'live' then
        if p_status='pending_moderation' or p_submitted_age is not null then
          update private.posts set submitted_at=now()-make_interval(days=>coalesce(p_submitted_age,0)) where id=pid;
        end if;
        update private.posts set status=p_status,status_reason=p_reason where id=pid;
      end if;
      update private.posts set submitted_at=coalesce(submitted_at,case when p_submitted_age is not null then now()-make_interval(days=>p_submitted_age) end),
        status_changed_at=now()-make_interval(days=>p_status_age),content_updated_at=now()-make_interval(days=>p_status_age) where id=pid;
      return pid;
    end$$;
    -- Mirrors the staff Hide action's effect and lock order
    -- (internal.execute_frontend_report_action_v2): subject lock, post row,
    -- paused/staff_hidden with a hold state, then the hold row.
    create function vmtest.hide(p_post uuid,p_staff uuid) returns uuid language plpgsql as $$
    declare post private.posts; hold uuid:=gen_random_uuid(); begin
      select * into post from private.posts where id=p_post;
      perform internal.lock_verification_subject(post.owner_id);
      select * into post from private.posts where id=p_post for update;
      insert into private.frontend_post_hold_state(post_id,prior_status,prior_reason,hidden_revision)
        values(post.id,post.status,post.status_reason,post.revision+1) on conflict(post_id) do nothing;
      update private.posts set status='paused',status_reason='staff_hidden',revision=revision+1 where id=post.id;
      insert into private.frontend_content_holds(id,post_id,account_id,actor_id,reason,applied_at)
        values(hold,post.id,post.owner_id,p_staff,'Synthetic staff visibility hold',clock_timestamp());
      return hold;
    end$$;
    -- Mirrors the release's hold row change (internal.release_frontend_content_hold).
    create function vmtest.release(p_hold uuid,p_staff uuid) returns void language sql as $$
      update private.frontend_content_holds set version=version+1,released_at=clock_timestamp(),released_by=p_staff,
        release_reason='Synthetic review cleared' where id=p_hold;
    $$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const post = (owner, kind, status, age = 0, submitted = null, reason = null) =>
    scalar(
      `select vmtest.post('${owner.id}','${kind}','${status}',${age},${submitted ?? "null"},${reason ? `'${reason}'` : "null"});`
    );
  const row = (id) =>
    json(
      `select coalesce((select to_jsonb(p)-'title'-'description' from private.posts p where p.id='${id}'),'null'::jsonb);`
    );
  const outbox = (id, kind) =>
    Number(
      scalar(
        `select count(*) from private.outbox_events where subject_id='${id}' and kind='${kind}';`
      )
    );
  const exists = (id) =>
    scalar(`select exists(select 1 from private.posts where id='${id}');`) === "t";

  const staff = user("staff"),
    alice = user("alice"), // edit-flow owner
    bea = user("bea"), // held-post owner
    cara = user("cara"), // free events owner
    dube = user("dube"), // legal hold owner
    fikile = user("fikile"), // concurrent events owner
    gugu = user("gugu"); // concurrency hold owner

  // Edits: the restored listing form's edit payload, staged by the server and
  // consumed by the owner, exactly as the website does.
  const edit = (owner, id) => {
    const p = row(id);
    const cover = scalar(
      `select object_id from private.post_media where post_id='${id}' and purpose='cover';`
    );
    const request = randomUUID();
    const input = buildRestoredPostInput(
      "listings",
      {
        postRequestId: request,
        postingTerms: TERMS,
        expectedRevision: p.revision,
        title: "Edited fixture listing",
        description: "An edited synthetic description long enough for every rule.",
        price_zar: 150,
        category: "other_items",
        attributes: {},
        condition: "good",
        province: "Gauteng",
        city: "Johannesburg",
        images: [`https://media.verifymzansi.com/media/${cover}`],
        contactMethods: ["form"],
      },
      undefined,
      true
    );
    const bound = {
      ...input,
      target_id: id,
      media: input.media.map(({ object_key, ...item }) => {
        assert.equal(object_key, `media/${cover}`);
        return { ...item, object_id: cover };
      }),
    };
    const digest = createHash("sha256").update(JSON.stringify(bound)).digest("hex");
    q(
      service(
        `select api.stage_frontend_post_command('${owner.id}','${request}','${digest}',$payload$${JSON.stringify(bound)}$payload$::jsonb);`
      )
    );
    return json(member(owner, `select api.consume_frontend_post_command('${request}');`));
  };

  // ------------------------------------------- state before the update
  const expiredListing = post(alice, "listing", "expired", 10, 12);
  const soldListing = post(alice, "listing", "sold", 5, 40);
  const characterised = post(alice, "listing", "expired", 3, 20);
  const liveListing = post(alice, "listing", "live");
  const approvalDigest = scalar(
    `select internal.frontend_post_approval_digest('${expiredListing}')||':'||internal.frontend_post_structural_digest('${expiredListing}');`
  );
  // Free events: counted = the original formula of internal.submit_post.
  const eventAges = [
    ["live", 2],
    ["live", 4],
    ["expired", 6],
    ["expired", 9],
    ["rejected", 11],
    ["rejected", 14],
    ["draft", 16],
    ["paused", 20],
    ["expired", 25],
    ["expired", 35],
  ];
  const caraEvents = eventAges.map(([status, age]) => post(cara, "event", status, 1, age));
  const oldFormula = (owner) =>
    Number(
      scalar(
        `select count(*) from private.posts p where p.owner_id='${owner.id}' and p.kind='event' and p.edit_of is null and p.submitted_at>statement_timestamp()-interval '30 days';`
      )
    );
  const caraBefore = oldFormula(cara);
  assert.equal(caraBefore, 9);
  const fikileEvents = Array.from({ length: 9 }, (_, n) =>
    post(fikile, "event", "expired", 1, n + 1)
  );
  assert.equal(fikileEvents.length, 9);
  // A hold that is already open when the update is applied.
  const heldListing = post(bea, "listing", "live");
  const logo = scalar(`select vmtest.media('${bea.id}');`);
  q(
    `insert into private.post_presentation_media(post_id,object_id,purpose,position) values('${heldListing}','${logo}','logo',0);`
  );
  const heldCover = scalar(
    `select object_id from private.post_media where post_id='${heldListing}' and purpose='cover';`
  );
  const preexistingHold = scalar(`select vmtest.hide('${heldListing}','${staff.id}');`);

  await check("pre-update: the edit flow resets the expiry clock and re-sends post_expired", () => {
    q(service("select api.run_post_lifecycle(500);"));
    assert.equal(outbox(characterised, "post_expired"), 1);
    const before = row(characterised).status_changed_at;
    const answer = edit(alice, characterised);
    assert.equal(answer.status, "expired");
    assert.notEqual(row(characterised).status_changed_at, before);
    q(service("select api.run_post_lifecycle(500);"));
    assert.equal(outbox(characterised, "post_expired"), 2);
  });
  // Created after the old job ran: past its deletion date, not yet deleted.
  const oldExpired = post(alice, "listing", "expired", 31, 45);
  const notices = (id) => outbox(id, "post_expired");
  const expiredNoticesBefore = notices(expiredListing);
  assert.equal(expiredNoticesBefore, 1);

  // ------------------------------------------------------ apply the update
  applySteps(database, steps.slice(index));
  console.log(`Applied ${UPDATE} and any later updates.`);
  q(`create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path=pg_catalog as $$
      select 'fixture-identity'::text where exists(select 1 from private.current_account_access a where a.id=p_owner) $$;`);

  await check("backfill: ended posts keep their deletion date; others have none", () => {
    for (const id of [expiredListing, soldListing, oldExpired]) {
      const p = row(id);
      assert.equal(p.ended_at, p.status_changed_at);
      assert.equal(
        scalar(
          `select (deletes_at=status_changed_at+interval '30 days')::text from private.posts where id='${id}';`
        ),
        "true"
      );
    }
    for (const id of [liveListing, heldListing]) {
      assert.equal(row(id).ended_at, null);
      assert.equal(row(id).deletes_at, null);
    }
  });
  await check("backfill: the free-event count is unchanged for every owner", () => {
    const ledger = (owner) =>
      Number(
        scalar(
          `select count(distinct post_id) from private.event_submissions where owner_id='${owner.id}' and released_at is null and submitted_at>statement_timestamp()-interval '30 days';`
        )
      );
    assert.equal(ledger(cara), caraBefore);
    assert.equal(ledger(fikile), 9);
    assert.equal(
      Number(
        scalar(`select count(*) from private.event_submissions where post_id='${caraEvents[9]}';`)
      ),
      0,
      "a submission outside the window is not copied"
    );
  });
  await check("backfill: open holds keep the media the post showed", () => {
    assert.equal(
      scalar(
        `select string_agg(object_id::text,',' order by object_id) from private.frontend_content_hold_media where hold_id='${preexistingHold}';`
      ),
      [heldCover, logo].sort().join(",")
    );
  });
  await check("approval digests do not include the lifecycle columns", () => {
    assert.equal(
      scalar(
        `select internal.frontend_post_approval_digest('${expiredListing}')||':'||internal.frontend_post_structural_digest('${expiredListing}');`
      ),
      approvalDigest
    );
  });
  await check("access: new tables and functions are closed to API roles", () => {
    for (const table of ["private.event_submissions", "private.frontend_content_hold_media"]) {
      assert.equal(
        scalar(`select relrowsecurity from pg_class where oid='${table}'::regclass;`),
        "t"
      );
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(
          scalar(`select has_table_privilege('${role}','${table}','select,insert,update,delete');`),
          "f"
        );
      }
    }
    for (const fn of [
      "internal.post_lifecycle_clock()",
      "internal.guard_frontend_content_hold_delete()",
      "internal.snapshot_frontend_content_hold_media()",
      "internal.release_frontend_content_hold_media()",
      "internal.event_submission_guard()",
    ]) {
      for (const role of ["anon", "authenticated", "service_role", "public"]) {
        assert.equal(scalar(`select has_function_privilege('${role}','${fn}','execute');`), "f");
      }
    }
    assert.equal(
      scalar(
        `select has_function_privilege('authenticated','internal.run_post_lifecycle(integer)','execute')::text||has_function_privilege('service_role','internal.run_post_lifecycle(integer)','execute')::text;`
      ),
      "falsetrue"
    );
  });

  // -------------------------------------------------------- 2. edit clock
  await check("edit: a post past its deletion date is still deleted after an edit", () => {
    edit(alice, oldExpired);
    assert.equal(row(oldExpired).status, "expired");
    job();
    assert.equal(exists(oldExpired), false);
    assert.equal(outbox(oldExpired, "post_deleted"), 1);
  });
  await check("edit: an expired post keeps its deletion date and gets no second notice", () => {
    const before = row(expiredListing);
    const answer = edit(alice, expiredListing);
    assert.equal(answer.status, "expired");
    const after = row(expiredListing);
    assert.equal(after.status, "expired");
    assert.equal(after.ended_at, before.ended_at);
    assert.equal(after.deletes_at, before.deletes_at);
    assert.notEqual(after.content_updated_at, before.content_updated_at);
    job();
    assert.equal(notices(expiredListing), expiredNoticesBefore);
    assert.equal(outbox(expiredListing, "post_expiry_reminder"), 1, "one 7-day reminder");
    edit(alice, expiredListing);
    job();
    assert.equal(notices(expiredListing), expiredNoticesBefore);
    assert.equal(outbox(expiredListing, "post_expiry_reminder"), 1);
  });
  await check("edit: a sold post keeps its deletion date", () => {
    const before = row(soldListing);
    assert.equal(edit(alice, soldListing).status, "sold");
    const after = row(soldListing);
    assert.equal(after.status, "sold");
    assert.equal(after.ended_at, before.ended_at);
    assert.equal(after.deletes_at, before.deletes_at);
  });
  await check("lifecycle: real state changes still start and clear the clock", () => {
    const listing = post(alice, "listing", "live");
    const p = row(listing);
    q(member(alice, `select api.set_post_state('${listing}',${p.revision},'sold');`));
    const sold = row(listing);
    assert.ok(sold.ended_at);
    assert.equal(
      scalar(
        `select (deletes_at=ended_at+interval '30 days')::text from private.posts where id='${listing}';`
      ),
      "true"
    );
    q(
      `update private.posts set status='live',published_at=now(),visible_until=now()+interval '1 day' where id='${listing}';`
    );
    assert.equal(row(listing).ended_at, null);
    assert.equal(row(listing).deletes_at, null);
    q(
      `update private.posts set visible_until=now()-interval '1 second',published_at=now()-interval '1 day' where id='${listing}';`
    );
    job();
    const expired = row(listing);
    assert.equal(expired.status, "expired");
    assert.ok(expired.ended_at && expired.ended_at !== sold.ended_at);
    fails(`update private.posts set deletes_at=null where id='${listing}';`, "23514");
  });

  // ------------------------------------------------------ 1. content holds
  const idleHeld = post(bea, "listing", "paused", 61);
  const idleHold = scalar(`select vmtest.hide('${idleHeld}','${staff.id}');`);
  q(
    `update private.posts set status_changed_at=now()-interval '61 days',content_updated_at=now()-interval '61 days' where id='${idleHeld}';`
  );
  const idleFree = post(bea, "listing", "paused", 61);
  const idleFreeCover = scalar(
    `select object_id from private.post_media where post_id='${idleFree}' and purpose='cover';`
  );
  await check("hold: the lifecycle job neither deletes nor warns about a held post", () => {
    job();
    assert.equal(exists(idleHeld), true);
    assert.equal(outbox(idleHeld, "draft_deletion_warning"), 0);
    assert.equal(exists(idleFree), false, "an idle post without a hold is still deleted");
    assert.equal(outbox(idleFree, "draft_deletion_warning"), 1);
  });
  await check("hold: the owner cannot mark sold, archive or delete a held post", () => {
    const p = row(heldListing);
    for (const sql of [
      `select api.set_post_state('${heldListing}',${p.revision},'sold');`,
      `select api.set_post_state('${heldListing}',${p.revision},'archive');`,
      `select api.delete_post('${heldListing}',${p.revision});`,
      `select api.execute_my_frontend_post_action('${randomUUID()}','${heldListing}',${p.revision},'mark_sold','listing','market');`,
      `select api.execute_my_frontend_post_action('${randomUUID()}','${heldListing}',${p.revision},'delete','listing','market');`,
    ]) {
      const message = fails(member(bea, sql), "PT423");
      assert.match(message, /staff visibility hold requires independent release/);
    }
    const after = row(heldListing);
    assert.equal(after.status, "paused");
    assert.equal(after.revision, p.revision);
    assert.equal(
      scalar(
        `select count(*) from private.frontend_post_action_receipts where post_id='${heldListing}';`
      ),
      "0"
    );
  });
  await check("hold: any other delete of a held post is refused", () => {
    fails(`delete from private.posts where id='${heldListing}';`, "PT423");
    assert.equal(exists(heldListing), true);
  });
  const idleHeldCover = scalar(
    `select object_id from private.post_media where post_id='${idleHeld}' and purpose='cover';`
  );
  await check("hold: media the post showed are not cleaned while the hold is open", () => {
    // heldListing's hold predates the update (backfill); idleHeld's was placed
    // after it (trigger). The owner removes each cover while hidden.
    q(`delete from private.post_media where post_id in('${heldListing}','${idleHeld}') and purpose='cover';
       update private.media_objects set created_at=now()-interval '3 days',unlinked_at=now()-interval '25 hours'
         where id in('${heldCover}','${idleHeldCover}','${idleFreeCover}');`);
    assert.equal(
      scalar(
        `select count(*) from private.frontend_content_hold_media where hold_id='${idleHold}' and object_id='${idleHeldCover}';`
      ),
      "1"
    );
    const claimed = cleanup().map((item) => item.object_id);
    assert.ok(!claimed.includes(heldCover), "media of an earlier hold were claimed for deletion");
    assert.ok(!claimed.includes(idleHeldCover), "media of a new hold were claimed for deletion");
    assert.ok(claimed.includes(idleFreeCover), "unheld unlinked media are still cleaned");
  });
  await check("legal hold refusal is unchanged", () => {
    const listing = post(dube, "listing", "live");
    q(
      `insert into private.legal_holds(subject_id,reason,placed_by) values('${dube.id}','Synthetic legal hold','${staff.id}');`
    );
    const message = fails(
      member(dube, `select api.delete_post('${listing}',${row(listing).revision});`),
      "PT409"
    );
    assert.match(message, /posts cannot be deleted during a legal hold/);
  });
  await check("hold release: media become cleanable and the idle clock restarts", () => {
    q(`select vmtest.release('${preexistingHold}','${staff.id}');`);
    assert.equal(
      scalar(
        `select count(*) from private.frontend_content_hold_media where hold_id='${preexistingHold}';`
      ),
      "0"
    );
    const claimed = cleanup().map((item) => item.object_id);
    assert.ok(claimed.includes(heldCover));
    assert.ok(!claimed.includes(logo), "media still shown by the post are kept");
    q(`select vmtest.release('${idleHold}','${staff.id}');`);
    assert.ok(
      cleanup()
        .map((item) => item.object_id)
        .includes(idleHeldCover)
    );
    job();
    assert.equal(exists(idleHeld), true, "released post deleted at once");
    assert.equal(outbox(idleHeld, "draft_deletion_warning"), 0);
    q(
      `update private.frontend_content_holds set released_at=now()-interval '61 days' where id='${idleHold}';`
    );
    job();
    assert.equal(exists(idleHeld), false);
  });

  // ------------------------------------------------- 3. free-event ledger
  const submit = (owner, id) =>
    member(owner, `select api.submit_post('${id}',${row(id).revision});`);
  const draft = (owner) => post(owner, "event", "draft");
  await check("events: the 10th submission passes and the 11th is refused", () => {
    q(submit(cara, draft(cara)));
    fails(submit(cara, draft(cara)), "PT429");
  });
  await check("events: deletion by the lifecycle job keeps the place", () => {
    const ended = caraEvents[2];
    q(`update private.posts set deletes_at=now()-interval '1 minute' where id='${ended}';`);
    job();
    assert.equal(exists(ended), false);
    fails(submit(cara, draft(cara)), "PT429");
  });
  await check("events: any non-owner delete keeps the place", () => {
    q(`delete from private.posts where id='${caraEvents[4]}';`);
    fails(submit(cara, draft(cara)), "PT429");
  });
  await check("events: an owner deleting their own event returns the place (DEC-32)", () => {
    const own = caraEvents[5];
    q(member(cara, `select api.delete_post('${own}',${row(own).revision});`));
    assert.equal(
      scalar(`select release_reason from private.event_submissions where post_id='${own}';`),
      "owner_deleted"
    );
    q(submit(cara, draft(cara)));
    fails(submit(cara, draft(cara)), "PT429");
  });
  await check("events: resubmitting the same event does not count twice", () => {
    const rejected = caraEvents[1]; // live -> reject it, then resubmit
    q(`update private.posts set status='rejected' where id='${rejected}';`);
    q(submit(cara, rejected));
    assert.equal(
      Number(scalar(`select count(*) from private.event_submissions where post_id='${rejected}';`)),
      2
    );
    fails(submit(cara, draft(cara)), "PT429");
  });
  await check("events: the ledger is append-only and purged after the window", () => {
    const id = scalar(
      `select id from private.event_submissions where owner_id='${cara.id}' order by submitted_at desc limit 1;`
    );
    fails(
      `update private.event_submissions set submitted_at=now()-interval '40 days' where id='${id}';`,
      "23514"
    );
    fails(`update private.event_submissions set released_at=now() where id='${id}';`, "23514");
    fails(`delete from private.event_submissions where id='${id}';`, "23514");
    q(
      `insert into private.event_submissions(owner_id,post_id,submitted_at) values('${cara.id}',gen_random_uuid(),now()-interval '32 days');`
    );
    job();
    assert.equal(
      scalar(
        `select count(*) from private.event_submissions where submitted_at<=now()-interval '31 days';`
      ),
      "0"
    );
    // Erasing an account removes its recent rows with it.
    const erased = randomUUID();
    q(`insert into auth.users(id,email,email_confirmed_at) values('${erased}','erased-${erased}@example.invalid',now());
       insert into private.event_submissions(owner_id,post_id) values('${erased}',gen_random_uuid());
       delete from auth.users where id='${erased}';`);
    assert.equal(
      scalar(`select count(*) from private.event_submissions where owner_id='${erased}';`),
      "0"
    );
  });

  // ----------------------------------------------------------- concurrency
  const session = (sql) =>
    new Promise((resolve) => {
      const child = spawn(
        "docker",
        [
          "exec",
          "-i",
          database.name,
          "psql",
          "-X",
          "-q",
          "-A",
          "-t",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "postgres",
        ],
        { windowsHide: true }
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(`\\set VERBOSITY verbose\n${sql}`);
    });
  const later = (ms, sql) =>
    new Promise((resolve) => setTimeout(resolve, ms)).then(() => session(sql));

  await check("concurrency: two submissions at the limit admit exactly one", async () => {
    const [a, b] = [draft(fikile), draft(fikile)];
    const results = await Promise.all([session(submit(fikile, a)), session(submit(fikile, b))]);
    assert.deepEqual(results.map((r) => r.status).sort(), [0, 3]);
    assert.match(results.find((r) => r.status !== 0).stderr, /ERROR:\s+PT429:/);
  });
  await check("concurrency: a delete racing a hide never removes the post", async () => {
    const listing = post(gugu, "listing", "live");
    const revision = row(listing).revision;
    const [hide, remove] = await Promise.all([
      session(`begin; select vmtest.hide('${listing}','${staff.id}'); select pg_sleep(2); commit;`),
      later(700, member(gugu, `select api.delete_post('${listing}',${revision});`)),
    ]);
    assert.equal(hide.status, 0, hide.stderr);
    assert.notEqual(remove.status, 0);
    assert.match(remove.stderr, /ERROR:\s+PT4(09|23):/);
    assert.equal(exists(listing), true);
    // With the current revision the hold itself is the refusal.
    fails(member(gugu, `select api.delete_post('${listing}',${row(listing).revision});`), "PT423");
  });
  await check("concurrency: mark sold racing a hide never starts deletion", async () => {
    const listing = post(gugu, "listing", "live");
    const revision = row(listing).revision;
    const [hide, sold] = await Promise.all([
      session(`begin; select vmtest.hide('${listing}','${staff.id}'); select pg_sleep(2); commit;`),
      later(700, member(gugu, `select api.set_post_state('${listing}',${revision},'sold');`)),
    ]);
    assert.equal(hide.status, 0, hide.stderr);
    assert.notEqual(sold.status, 0);
    const after = row(listing);
    assert.equal(after.status, "paused");
    assert.equal(after.deletes_at, null);
  });
  await check("concurrency: the lifecycle job skips a post while it is being hidden", async () => {
    const idle = post(gugu, "listing", "paused", 61);
    const [hide, sweep] = await Promise.all([
      session(`begin; select vmtest.hide('${idle}','${staff.id}');
        update private.posts set status_changed_at=now()-interval '61 days',content_updated_at=now()-interval '61 days' where id='${idle}';
        select pg_sleep(2); commit;`),
      later(700, service("select api.run_post_lifecycle(500);")),
    ]);
    assert.equal(hide.status, 0, hide.stderr);
    assert.equal(sweep.status, 0, sweep.stderr);
    assert.equal(exists(idle), true);
    job();
    assert.equal(exists(idle), true);
  });
} catch (error) {
  console.error(`FAIL ${current}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Lifecycle guard checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
