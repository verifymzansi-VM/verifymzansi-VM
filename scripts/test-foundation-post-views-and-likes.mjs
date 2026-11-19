#!/usr/bin/env node
// Behaviour checks for 20261119172135_post_views_and_likes.sql: post view
// counts and likes, counted per browser through the website's service calls.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. The script runs the update's read-only preflight, checks its refusals,
// applies it, proves apply -> rollback -> apply returns the same fingerprints,
// then checks through the production API commands: the grants; one view per
// browser per post in 24 hours across the daily salt change; no view by the
// owner or by staff; the per-post hourly and daily view caps; marks and salts
// deleted by the retention job; likes per browser signed out and per account
// signed in, never touching each other's; the owner's and staff's likes never
// stored; the per-post like limit; the totals kept by triggers; only publicly
// live posts, with hidden and unknown posts answered alike; the privacy
// export; and deletion with the post and through account erasure. Any later
// updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-post-views-and-likes.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  executeGrants,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261119172135_post_views_and_likes.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const EXPORT = "internal.frontend_privacy_export_data(uuid)";
const TABLES = [
  "private.engagement_keys",
  "private.post_view_salts",
  "private.post_view_marks",
  "private.post_view_days",
  "private.post_engagement_totals",
  "private.post_likes",
];

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  fails,
  as,
  claims,
  member,
  service,
  fingerprint,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const count = (sql) => Number(q(`select count(*) from ${sql};`));
  const anon = (sql) => `set role anon;\n${sql}`;

  // ------------------------------------------------------- synthetic world
  syntheticMember("views-setup");
  q(`create or replace function vmtest.media(p_owner uuid) returns uuid language plpgsql as $$
    declare oid uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
        values(oid,p_owner,'image','media/'||oid,1024,1024,encode(sha256(convert_to(oid::text,'UTF8')),'hex'),'image/jpeg',800,600,'ready');
      return oid;
    end$$;
    -- An event with a ready cover; a live event (with its search document)
    -- is public until it ends.
    create or replace function vmtest.event(p_owner uuid,p_live boolean) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); begin
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
        values(pid,p_owner,'event','tourism_events','events',(select a.key from private.category_activities a
          join private.categories c on c.key=a.category_key where a.category_key='events' and c.activity_required
          order by a.key limit 1),'Fixture event '||left(pid::text,8),'A synthetic description long enough for every rule.',
          'gp','gp_johannesburg');
      insert into private.event_details(post_id,starts_at,ends_at,timezone)
        values(pid,date_trunc('milliseconds',now()+interval '20 days'),date_trunc('milliseconds',now()+interval '21 days'),
          'Africa/Johannesburg');
      insert into private.post_contacts(post_id,post_kind,channels) values(pid,'event',array['form']);
      insert into private.post_media(post_id,object_id,purpose,position) values(pid,vmtest.media(p_owner),'cover',0);
      if p_live then
        update private.posts set status='live',published_at=now()-interval '2 days',
          visible_until=(select e.ends_at from private.event_details e where e.post_id=pid) where id=pid;
        perform internal.write_post_projection(pid);
      end if;
      return pid;
    end$$;
    -- Thirty-one days pass for one closed account.
    create or replace function vmtest.erasure_due(p_user uuid) returns void language plpgsql as $$
    begin
      update private.account_erasures set closed_at=closed_at-interval '31 days',erase_after=erase_after-interval '31 days'
        where user_id=p_user;
      update private.account_closures set closed_at=closed_at-interval '31 days',
        evidence_delete_after=evidence_delete_after-interval '31 days' where user_id=p_user;
    end$$;`);
  const event = (owner, live = true) => q(`select vmtest.event('${owner.id}',${live});`);
  const ids = (list) => `array[${list.map((id) => `'${id}'`).join(",")}]::uuid[]`;
  const views = (posts, device, account = null) =>
    json(
      service(
        `select api.record_post_views(${ids(posts)},'${device}',${account ? `'${account.id}'` : "null"});`
      )
    ).counted;
  const like = (post, device, account = null, liked = null) =>
    json(
      service(
        `select api.set_post_like('${post}','${device}',${account ? `'${account.id}'` : "null"},${liked === null ? "null" : liked});`
      )
    );
  const totals = (posts) =>
    json(anon(`select api.get_post_engagement(${ids(posts)});`)).items.map((row) => [
      row.post_id,
      Number(row.views),
      Number(row.likes),
    ]);
  const likesOf = (post) => totals([post])[0][2];
  const viewsOf = (post) => totals([post])[0][1];
  /** The like total equals the like rows of every post. */
  const totalsMatchRows = () =>
    assert.equal(
      count(`private.post_engagement_totals t where t.likes<>(select count(*) from private.post_likes l
        where l.post_id=t.post_id)`),
      0
    );
  /** Moves the view clock: today's salt becomes yesterday's and every mark
   * ages by `hours`, as if that much time had passed across midnight. */
  const nextDay = (hours) =>
    q(`update private.post_view_salts set day=day-1;
      update private.post_view_marks set seen_at=seen_at-make_interval(hours=>${hours});`);

  // ------------------------------------------------------------ before
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^post views and likes: update not applied; publicly listed posts: \d+$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(`select pg_get_functiondef('${EXPORT}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${EXPORT}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[1][1], /frontend_privacy_export_data.* is not the reviewed body/);
    assert.match(fails(step.sql, "55000"), /is not a reviewed body/);
    q(`${live};`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "post views and likes",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: /^post views and likes: already applied; likes: 0; view days: 0; views: 0$/,
  });

  const owner = syntheticMember("views-owner");
  const visitor = syntheticMember("views-visitor");
  const other = syntheticMember("views-other");
  const staffer = syntheticMember("views-staff");
  q(`insert into private.staff_roles(user_id,role) values('${staffer.id}','moderator');`);
  const post = event(owner);
  const second = event(owner);
  const draft = event(owner, false);

  await check("grants: views and likes are service only; totals are public", () => {
    const grants = executeGrants(json, [
      "api.record_post_views(uuid[],uuid,uuid)",
      "api.set_post_like(uuid,uuid,uuid,boolean)",
      "api.get_post_engagement(uuid[])",
      "internal.record_post_views(uuid[],uuid,uuid)",
      "internal.set_post_like(uuid,uuid,uuid,boolean)",
      "internal.get_post_engagement(uuid[])",
      "internal.purge_post_engagement()",
      "internal.post_likes_count()",
    ]);
    const serviceOnly = { anon: false, authenticated: false, service_role: true };
    const open = { anon: true, authenticated: true, service_role: false };
    const none = { anon: false, authenticated: false, service_role: false };
    assert.deepEqual(grants["api.record_post_views(uuid[],uuid,uuid)"], serviceOnly);
    assert.deepEqual(grants["api.set_post_like(uuid,uuid,uuid,boolean)"], serviceOnly);
    assert.deepEqual(grants["internal.record_post_views(uuid[],uuid,uuid)"], serviceOnly);
    assert.deepEqual(grants["internal.set_post_like(uuid,uuid,uuid,boolean)"], serviceOnly);
    assert.deepEqual(grants["api.get_post_engagement(uuid[])"], open);
    assert.deepEqual(grants["internal.get_post_engagement(uuid[])"], open);
    assert.deepEqual(grants["internal.purge_post_engagement()"], none);
    assert.deepEqual(grants["internal.post_likes_count()"], none);
    for (const table of TABLES)
      for (const role of ["anon", "authenticated", "service_role"])
        assert.equal(
          q(`select has_table_privilege('${role}','${table}','select,insert,update,delete');`),
          "f",
          `${role} ${table}`
        );
    fails(
      member(visitor, `select api.record_post_views(${ids([post])},'${randomUUID()}');`),
      "42501"
    );
    fails(anon(`select api.set_post_like('${post}','${randomUUID()}');`), "42501");
  });
  await check("the post is publicly live; the draft is not", () => {
    assert.equal(json(anon(`select api.get_public_post('${post}');`)).id, post);
    assert.equal(q(anon(`select api.get_public_post('${draft}') is null;`)), "t");
  });

  await check("one view per browser per post; another browser counts again", () => {
    const device = randomUUID();
    assert.deepEqual(views([post, post, second], device), [post, second].sort());
    assert.deepEqual(views([post], device), []);
    assert.deepEqual(views([post], randomUUID()), [post]);
    assert.deepEqual(
      totals([post, second]),
      [
        [post, 2, 0],
        [second, 1, 0],
      ].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    );
  });
  await check("views are deduped by browser only; no account is hashed into a mark", () => {
    const before = viewsOf(post);
    const device = randomUUID();
    assert.deepEqual(views([post], device, visitor), [post]);
    assert.deepEqual(views([post], device, null), []);
    assert.deepEqual(views([post], device, other), []);
    assert.equal(viewsOf(post), before + 1);
    const salt = q(
      `select encode(salt,'hex') from private.post_view_salts order by day desc limit 1;`
    );
    const accountMark = q(
      `select count(*) from private.post_view_marks where mark=sha256(decode('${salt}','hex')||convert_to('account:${visitor.id}|${post}','UTF8'));`
    );
    assert.equal(accountMark, "0");
  });
  await check("the owner's and staff views are not counted", () => {
    const before = viewsOf(post);
    assert.deepEqual(views([post], randomUUID(), owner), []);
    assert.deepEqual(views([post, second], randomUUID(), staffer), []);
    assert.equal(viewsOf(post), before);
  });
  await check("a post that is not publicly live is never counted", () => {
    assert.deepEqual(views([draft], randomUUID()), []);
    assert.equal(count(`private.post_view_days where post_id='${draft}'`), 0);
  });
  await check("bad view requests are refused", () => {
    const many = Array.from({ length: 6 }, () => randomUUID());
    fails(service(`select api.record_post_views(${ids(many)},'${randomUUID()}');`), "22023");
    fails(service(`select api.record_post_views(${ids([post])},null);`), "22023");
    fails(service(`select api.record_post_views('{}'::uuid[],'${randomUUID()}');`), "22023");
  });
  await check("at most 3,000 counted views per post per hour and 20,000 per day", () => {
    const capped = event(owner);
    assert.deepEqual(views([capped], randomUUID()), [capped]);
    q(`update private.post_view_days set hour_views=3000,views=3000 where post_id='${capped}';`);
    const marksBefore = count("private.post_view_marks");
    assert.deepEqual(views([capped], randomUUID()), []);
    assert.equal(count("private.post_view_marks"), marksBefore, "a capped view leaves no mark");
    q(
      `update private.post_view_days set hour_start=hour_start-interval '1 hour' where post_id='${capped}';`
    );
    assert.deepEqual(views([capped], randomUUID()), [capped]);
    q(`update private.post_view_days set views=20000,hour_views=1 where post_id='${capped}';`);
    assert.deepEqual(views([capped], randomUUID()), []);
    // The whole site: 300,000 counted views a day.
    const fresh = event(owner);
    q(`update private.post_view_salts set views=300000
      where day=(statement_timestamp() at time zone 'Africa/Johannesburg')::date;`);
    assert.deepEqual(views([fresh], randomUUID()), []);
    q(`update private.post_view_salts set views=0;`);
    assert.deepEqual(views([fresh], randomUUID()), [fresh]);
  });
  await check("24 hours across the daily salt change; the retention job forgets old marks", () => {
    const device = randomUUID();
    const fresh = event(owner);
    assert.deepEqual(views([fresh], device), [fresh]);
    // 23 hours later, after midnight: a new salt, the old mark still counts.
    nextDay(23);
    assert.deepEqual(views([fresh], device), []);
    assert.equal(count("private.post_view_salts"), 2);
    // 25 hours after the first view: counted again.
    q(`update private.post_view_marks set seen_at=seen_at-interval '2 hours';`);
    assert.deepEqual(views([fresh], device), [fresh]);
    // A view request never deletes marks: only the retention job does.
    q(`insert into private.post_view_marks(mark,seen_at)
      values(sha256('old'::bytea),statement_timestamp()-interval '30 hours');`);
    nextDay(1);
    views([post], randomUUID());
    assert.equal(count(`private.post_view_marks where mark=sha256('old'::bytea)`), 1);
    const result = json(service("select api.run_retention(100);"));
    assert.ok(result.engagement.marks >= 1, JSON.stringify(result.engagement));
    assert.equal(
      count("private.post_view_marks where seen_at<statement_timestamp()-interval '24 hours'"),
      0
    );
    // Without traffic the job still deletes salts older than yesterday.
    nextDay(1);
    nextDay(1);
    json(service("select api.run_retention(100);"));
    assert.equal(
      count(
        "private.post_view_salts where day<(statement_timestamp() at time zone 'Africa/Johannesburg')::date-1"
      ),
      0
    );
    assert.deepEqual(
      json(`select jsonb_agg(attname order by attnum) from pg_attribute
        where attrelid='private.post_view_marks'::regclass and attnum>0 and not attisdropped;`),
      ["mark", "seen_at"]
    );
  });

  await check("a signed-out browser likes, toggles and sets its like", () => {
    const device = randomUUID();
    const base = likesOf(post);
    assert.deepEqual(like(post, device), { liked: true, likes: base + 1, counted: true });
    assert.deepEqual(like(post, device), { liked: false, likes: base, counted: true });
    assert.deepEqual(like(post, device, null, true), {
      liked: true,
      likes: base + 1,
      counted: true,
    });
    assert.deepEqual(like(post, device, null, true), {
      liked: true,
      likes: base + 1,
      counted: true,
    });
    assert.equal(like(post, randomUUID(), null, true).likes, base + 2);
    assert.deepEqual(like(post, device, null, false), {
      liked: false,
      likes: base + 1,
      counted: true,
    });
    assert.equal(likesOf(post), base + 1);
    totalsMatchRows();
  });
  await check("signed in acts only on the account's like; signed out only on the browser's", () => {
    const shared = randomUUID();
    const base = likesOf(second);
    // A likes signed out on a shared browser; B signs in there and unlikes.
    assert.equal(like(second, shared, null, true).likes, base + 1);
    assert.deepEqual(like(second, shared, visitor, false), {
      liked: false,
      likes: base + 1,
      counted: true,
    });
    // B's own like is the account's, on any browser, and stores no browser.
    assert.equal(like(second, shared, visitor, true).likes, base + 2);
    assert.equal(like(second, randomUUID(), visitor, true).likes, base + 2);
    assert.equal(
      count(`private.post_likes where account_id='${visitor.id}' and device_mark is not null`),
      0
    );
    // A's signed-out like is untouched by B's unlike.
    assert.equal(like(second, randomUUID(), visitor, false).likes, base + 1);
    assert.equal(like(second, shared, null).liked, false);
    totalsMatchRows();
  });
  await check(
    "the owner's and staff likes are never stored; the owner can remove their browser's",
    () => {
      const device = randomUUID();
      const base = likesOf(post);
      assert.deepEqual(like(post, device, owner), { liked: false, likes: base, counted: false });
      assert.deepEqual(like(post, device, staffer, true), {
        liked: false,
        likes: base,
        counted: false,
      });
      // Liked while signed out, then removed by the signed-in owner.
      assert.equal(like(post, device, null, true).likes, base + 1);
      assert.deepEqual(like(post, device, owner, false), {
        liked: false,
        likes: base,
        counted: false,
      });
      totalsMatchRows();
    }
  );
  await check("an account that is not active likes as a signed-out browser", () => {
    const banned = syntheticMember("views-banned");
    q(`update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
    const device = randomUUID();
    assert.equal(like(post, device, banned, true).liked, true);
    assert.equal(count(`private.post_likes where account_id='${banned.id}'`), 0);
    like(post, device, null, false);
  });
  await check("hidden and unknown posts: refused alike, absent alike from the totals", () => {
    fails(service(`select api.set_post_like('${draft}','${randomUUID()}');`), "PT404");
    fails(service(`select api.set_post_like('${randomUUID()}','${randomUUID()}');`), "PT404");
    fails(service(`select api.set_post_like('${post}',null);`), "22023");
    // A post on hold keeps its search document but is not public.
    const held = event(owner);
    like(held, randomUUID(), null, true);
    views([held], randomUUID());
    q(`insert into private.frontend_content_holds(id,post_id,account_id,actor_id,reason,applied_at)
      values(gen_random_uuid(),'${held}','${owner.id}','${staffer.id}','Fixture hold for a report',now());`);
    assert.deepEqual(totals([held, randomUUID(), draft]), []);
    fails(service(`select api.set_post_like('${held}','${randomUUID()}');`), "PT404");
    assert.deepEqual(views([held], randomUUID()), []);
    const many = Array.from({ length: 51 }, () => randomUUID());
    fails(anon(`select api.get_post_engagement(${ids(many)});`), "22023");
  });
  await check("at most 600 new likes per post per hour, counted under the post's lock", () => {
    const busy = event(owner);
    like(busy, randomUUID(), null, true);
    q(`update private.post_engagement_totals set like_hour_count=600 where post_id='${busy}';`);
    fails(service(`select api.set_post_like('${busy}','${randomUUID()}');`), "PT429", /like_limit/);
    // Unliking is never limited.
    q(`update private.post_engagement_totals set like_hour_start=like_hour_start-interval '1 hour'
      where post_id='${busy}';`);
    assert.equal(like(busy, randomUUID()).likes, 2);
  });
  await check("the privacy export lists the latest 2,000 signed-in likes and their number", () => {
    const liker = syntheticMember("views-export");
    like(second, randomUUID(), liker, true);
    let data = json(`select internal.frontend_privacy_export_data('${liker.id}');`);
    assert.deepEqual(
      data.post_likes.map((row) => row.post_id),
      [second]
    );
    assert.deepEqual(Object.keys(data.post_likes[0]).sort(), ["created_at", "post_id"]);
    assert.equal(Number(data.post_likes_summary[0].total), 1);
    q(`insert into private.post_likes(post_id,account_id)
      select vmtest.event('${owner.id}',false),'${liker.id}' from generate_series(1,2600);`);
    data = json(`select internal.frontend_privacy_export_data('${liker.id}');`);
    assert.equal(data.post_likes.length, 2000);
    assert.equal(Number(data.post_likes_summary[0].total), 2601);
    totalsMatchRows();
  });
  await check("views and likes go with the post; erasure deletes the account's likes", () => {
    const doomed = event(owner);
    views([doomed], randomUUID());
    like(doomed, randomUUID());
    q(`delete from private.posts where id='${doomed}';`);
    for (const table of ["post_likes", "post_view_days", "post_engagement_totals"])
      assert.equal(count(`private.${table} where post_id='${doomed}'`), 0, table);

    const leaving = syntheticMember("views-erased");
    const now = Math.floor(Date.now() / 1000);
    assert.equal(like(post, randomUUID(), leaving, true).liked, true);
    const before = likesOf(post);
    json(
      as(
        { ...claims(leaving), amr: [{ method: "password", timestamp: now - 60 }] },
        "select api.close_my_account();"
      )
    );
    q(`select vmtest.erasure_due('${leaving.id}');`);
    const erased = json(`select internal.erase_closed_account('${leaving.id}','sweep');`);
    assert.ok(erased.erased_at, JSON.stringify(erased));
    assert.equal(count(`private.post_likes where account_id='${leaving.id}'`), 0);
    assert.equal(likesOf(post), before - 1);
    totalsMatchRows();
  });
  await check("preflight after: counts, and the rollback refuses once data exists", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^post views and likes: already applied; likes: \d+; view days: \d+; views: \d+$/
    );
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /would be lost/);
    assert.equal(fingerprint(), before);
  });

  // ---------------------------------------------------------- later steps
  applySteps(database, steps.slice(index + 1));
  console.log(
    `PASS post views and likes: ${checks.length} checks in ${Math.round((Date.now() - started) / 1000)} s`
  );
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
