#!/usr/bin/env node
// Behaviour checks for 20261119172135_post_views_and_likes.sql: post view
// counts and likes, counted per browser through the website's service calls.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. The script runs the update's read-only preflight, checks its refusals,
// applies it, proves apply -> rollback -> apply returns the same fingerprints,
// then checks through the production API commands: the grants; one view per
// browser (and account) per post in 24 hours across the daily salt change;
// no view by the owner or by staff; marks forgotten after 48 hours; likes
// toggled and set per browser and per account; the owner's own like never
// stored; the per-post like limit; only publicly live posts; the public
// totals; the privacy export; and deletion with the post and the Auth user.
// Any later updates are applied at the end.
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
    repeatRollback: false,
  });

  const owner = syntheticMember("views-owner");
  const visitor = syntheticMember("views-visitor");
  const staffer = syntheticMember("views-staff");
  q(`insert into private.staff_roles(user_id,role) values('${staffer.id}','moderator');`);
  const post = event(owner);
  const other = event(owner);
  const draft = event(owner, false);

  await check("grants: views and likes are service only; totals are public", () => {
    const grants = executeGrants(json, [
      "api.record_post_views(uuid[],uuid,uuid)",
      "api.set_post_like(uuid,uuid,uuid,boolean)",
      "api.get_post_engagement(uuid[])",
      "internal.record_post_views(uuid[],uuid,uuid)",
      "internal.set_post_like(uuid,uuid,uuid,boolean)",
      "internal.get_post_engagement(uuid[])",
    ]);
    const service = { anon: false, authenticated: false, service_role: true };
    const open = { anon: true, authenticated: true, service_role: false };
    assert.deepEqual(grants["api.record_post_views(uuid[],uuid,uuid)"], service);
    assert.deepEqual(grants["api.set_post_like(uuid,uuid,uuid,boolean)"], service);
    assert.deepEqual(grants["internal.record_post_views(uuid[],uuid,uuid)"], service);
    assert.deepEqual(grants["internal.set_post_like(uuid,uuid,uuid,boolean)"], service);
    assert.deepEqual(grants["api.get_post_engagement(uuid[])"], open);
    assert.deepEqual(grants["internal.get_post_engagement(uuid[])"], open);
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
    assert.deepEqual(views([post, post, other], device), [post, other].sort());
    assert.deepEqual(views([post], device), []);
    assert.deepEqual(views([post], randomUUID()), [post]);
    assert.deepEqual(
      totals([post, other]),
      [
        [post, 2, 0],
        [other, 1, 0],
      ].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    );
  });
  await check("a signed-in view counts once per account, on any browser", () => {
    const before = totals([post])[0][1];
    assert.deepEqual(views([post], randomUUID(), visitor), [post]);
    assert.deepEqual(views([post], randomUUID(), visitor), []);
    assert.equal(totals([post])[0][1], before + 1);
  });
  await check("the owner's and staff views are not counted", () => {
    const before = totals([post])[0][1];
    assert.deepEqual(views([post], randomUUID(), owner), []);
    assert.deepEqual(views([post, other], randomUUID(), staffer), []);
    assert.equal(totals([post])[0][1], before);
  });
  await check("a post that is not publicly live is never counted", () => {
    assert.deepEqual(views([draft], randomUUID()), []);
    assert.equal(count(`private.post_view_days where post_id='${draft}'`), 0);
    assert.deepEqual(totals([draft]), []);
  });
  await check("bad view requests are refused", () => {
    const many = Array.from({ length: 21 }, () => randomUUID());
    fails(service(`select api.record_post_views(${ids(many)},'${randomUUID()}');`), "22023");
    fails(service(`select api.record_post_views(${ids([post])},null);`), "22023");
    fails(service(`select api.record_post_views('{}'::uuid[],'${randomUUID()}');`), "22023");
  });
  await check("24 hours across the daily salt change; marks forgotten after 48 hours", () => {
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
    // Next midnight: salts older than yesterday and marks older than 48 hours go.
    q(`insert into private.post_view_marks(mark,seen_at)
      values(sha256('old'::bytea),statement_timestamp()-interval '49 hours');`);
    nextDay(1);
    views([post], randomUUID());
    assert.equal(count("private.post_view_salts"), 2);
    assert.equal(
      count("private.post_view_marks where seen_at<statement_timestamp()-interval '48 hours'"),
      0
    );
    assert.deepEqual(
      json(`select jsonb_agg(attname order by attnum) from pg_attribute
        where attrelid='private.post_view_marks'::regclass and attnum>0 and not attisdropped;`),
      ["mark", "seen_at"]
    );
    assert.equal(totals([fresh])[0][1], 2);
  });

  await check("a browser likes, toggles and sets its like", () => {
    const device = randomUUID();
    assert.deepEqual(like(post, device), { liked: true, likes: 1, counted: true });
    assert.deepEqual(like(post, device), { liked: false, likes: 0, counted: true });
    assert.deepEqual(like(post, device, null, true), { liked: true, likes: 1, counted: true });
    assert.deepEqual(like(post, device, null, true), { liked: true, likes: 1, counted: true });
    assert.deepEqual(like(post, randomUUID(), null, true), {
      liked: true,
      likes: 2,
      counted: true,
    });
    assert.deepEqual(like(post, device, null, false), { liked: false, likes: 1, counted: true });
    assert.deepEqual(like(post, device, null, false), { liked: false, likes: 1, counted: true });
    assert.equal(totals([post])[0][2], 1);
  });
  await check("one like per account on any browser; unliking removes it everywhere", () => {
    const first = randomUUID();
    const second = randomUUID();
    const before = totals([other])[0][2];
    assert.equal(like(other, first, visitor, true).likes, before + 1);
    // Another browser of the same account sees it liked and adds nothing.
    assert.deepEqual(like(other, second, visitor, true), {
      liked: true,
      likes: before + 1,
      counted: true,
    });
    // Signed out on the first browser: still liked there.
    assert.equal(like(other, first, null, true).likes, before + 1);
    assert.deepEqual(like(other, second, visitor), { liked: false, likes: before, counted: true });
    assert.equal(count(`private.post_likes where post_id='${other}'`), before);
  });
  await check("the owner's own like is never stored", () => {
    const before = totals([post])[0][2];
    assert.deepEqual(like(post, randomUUID(), owner), {
      liked: false,
      likes: before,
      counted: false,
    });
    assert.equal(totals([post])[0][2], before);
  });
  await check("an account that is not active likes as a signed-out browser", () => {
    const banned = syntheticMember("views-banned");
    q(`update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
    const device = randomUUID();
    assert.equal(like(post, device, banned, true).liked, true);
    assert.equal(count(`private.post_likes where account_id='${banned.id}'`), 0);
    like(post, device, null, false);
  });
  await check("likes on hidden or unknown posts and bad requests are refused", () => {
    fails(service(`select api.set_post_like('${draft}','${randomUUID()}');`), "PT404");
    fails(service(`select api.set_post_like('${randomUUID()}','${randomUUID()}');`), "PT404");
    fails(service(`select api.set_post_like('${post}',null);`), "22023");
    const many = Array.from({ length: 101 }, () => randomUUID());
    fails(anon(`select api.get_post_engagement(${ids(many)});`), "22023");
  });
  await check("at most 600 new likes per post per hour", () => {
    const busy = event(owner);
    q(`insert into private.post_likes(post_id,device_mark)
      select '${busy}',sha256(convert_to('busy'||g::text,'UTF8')) from generate_series(1,600) g;`);
    fails(service(`select api.set_post_like('${busy}','${randomUUID()}');`), "PT429", /like_limit/);
    q(
      `update private.post_likes set created_at=created_at-interval '61 minutes' where post_id='${busy}';`
    );
    assert.equal(like(busy, randomUUID()).likes, 601);
  });
  await check("the privacy export lists the account's signed-in likes", () => {
    const liker = syntheticMember("views-export");
    like(other, randomUUID(), liker, true);
    const data = json(`select internal.frontend_privacy_export_data('${liker.id}');`);
    assert.deepEqual(
      data.post_likes.map((row) => row.post_id),
      [other]
    );
    assert.deepEqual(Object.keys(data.post_likes[0]).sort(), ["created_at", "post_id"]);
  });
  await check("views and likes go with the post, a signed-in like with the Auth user", () => {
    const doomed = event(owner);
    views([doomed], randomUUID());
    like(doomed, randomUUID());
    const liker = syntheticMember("views-erased");
    like(doomed, randomUUID(), liker, true);
    q(`delete from auth.users where id='${liker.id}';`);
    assert.equal(count(`private.post_likes where account_id='${liker.id}'`), 0);
    assert.equal(count(`private.post_likes where post_id='${doomed}'`), 1);
    q(`delete from private.posts where id='${doomed}';`);
    assert.equal(count(`private.post_likes where post_id='${doomed}'`), 0);
    assert.equal(count(`private.post_view_days where post_id='${doomed}'`), 0);
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
