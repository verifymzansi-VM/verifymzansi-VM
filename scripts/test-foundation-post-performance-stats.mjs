#!/usr/bin/env node
// Behaviour checks for 20261121100028_post_performance_stats.sql: the owner's
// Performance page statistics, counted through the website's service calls.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. The script runs the update's read-only preflight, checks its refusals,
// applies it, proves apply -> rollback -> apply returns the same fingerprints,
// then checks through the production API commands: the grants; each event's
// daily counter; only publicly live posts, never the signed-in owner's own or
// staff events; the request rules; engaged views once per browser, only after
// a counted view; the owner's read (own posts only, every figure of the page,
// the showroom fair share); the clean-up as its own job (activity days older
// than 31 days, marks, the job's run record) and the retention job without
// it; deletion with the post; and the preflight and rollback afterwards. Any
// later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-post-performance-stats.mjs
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

const UPDATE = "20261121100028_post_performance_stats.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const RETENTION = "internal.run_retention(integer)";

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
  syntheticMember("stats-setup");
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
  const texts = (list) => `array[${list.map((m) => `'${m}'`).join(",")}]::text[]`;
  const nullable = (value) => (value ? `'${value}'` : "null");
  /** Records `pairs` ([post, counter]) as the website server does. */
  const activity = (pairs, { device = null, account = null } = {}) =>
    json(
      service(
        `select api.record_post_activity(${ids(pairs.map(([p]) => p))},${texts(pairs.map(([, m]) => m))},${nullable(device)},${nullable(account?.id)});`
      )
    );
  const views = (posts, device) =>
    json(service(`select api.record_post_views(${ids(posts)},'${device}');`)).counted;
  const like = (post, device) =>
    json(service(`select api.set_post_like('${post}','${device}',null,true);`));
  const performanceOf = (user) => json(member(user, "select api.get_my_post_performance();"));
  const day = (post) =>
    json(`select coalesce((select to_jsonb(a) - 'post_id' - 'day' from private.post_activity_days a
      where a.post_id='${post}' and a.day=(now() at time zone 'Africa/Johannesburg')::date),'{}'::jsonb);`);
  const engagedOf = (post) =>
    Number(
      q(
        `select coalesce((select engaged_views from private.post_engagement_totals where post_id='${post}'),0);`
      )
    );

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
      /^post performance stats: update not applied; publicly listed posts: \d+$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(`select pg_get_functiondef('${RETENTION}'::regprocedure);`);
    q(
      `do $$begin execute replace(pg_get_functiondef('${RETENTION}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[1][1], /run_retention.* is not the reviewed body/);
    assert.match(fails(step.sql, "55000"), /is not a reviewed body/);
    q(`${live};`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "post performance stats",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: /^post performance stats: already applied; activity days: 0; engaged views: 0$/,
  });

  const owner = syntheticMember("stats-owner");
  const visitor = syntheticMember("stats-visitor");
  const other = syntheticMember("stats-other");
  const staffer = syntheticMember("stats-staff");
  q(`insert into private.staff_roles(user_id,role) values('${staffer.id}','moderator');`);
  const post = event(owner);
  const second = event(owner);
  const draft = event(owner, false);
  const elsewhere = event(other);

  await check(
    "grants: recording and the clean-up are service only; the read is members only",
    () => {
      const grants = executeGrants(json, [
        "api.record_post_activity(uuid[],text[],uuid,uuid)",
        "api.get_my_post_performance()",
        "api.purge_post_engagement()",
        "internal.record_post_activity(uuid[],text[],uuid,uuid)",
        "internal.get_my_post_performance()",
        "internal.purge_post_engagement()",
      ]);
      const serviceOnly = { anon: false, authenticated: false, service_role: true };
      const members = { anon: false, authenticated: true, service_role: false };
      assert.deepEqual(grants["api.record_post_activity(uuid[],text[],uuid,uuid)"], serviceOnly);
      assert.deepEqual(
        grants["internal.record_post_activity(uuid[],text[],uuid,uuid)"],
        serviceOnly
      );
      assert.deepEqual(grants["api.purge_post_engagement()"], serviceOnly);
      assert.deepEqual(grants["internal.purge_post_engagement()"], serviceOnly);
      assert.deepEqual(grants["api.get_my_post_performance()"], members);
      assert.deepEqual(grants["internal.get_my_post_performance()"], members);
      for (const role of ["anon", "authenticated", "service_role"])
        assert.equal(
          q(
            `select has_table_privilege('${role}','private.post_activity_days','select,insert,update,delete');`
          ),
          "f",
          role
        );
      fails(
        member(visitor, `select api.record_post_activity(${ids([post])},${texts(["shares"])});`),
        "42501"
      );
      fails(anon(`select api.get_my_post_performance();`), "42501");
      fails(service(`select api.get_my_post_performance();`), "42501");
      fails(member(visitor, `select api.purge_post_engagement();`), "42501");
    }
  );

  await check("each event adds to its post's counter for the day, each pair once per call", () => {
    const result = activity([
      [post, "list_impressions"],
      [post, "list_impressions"],
      [post, "showroom_home"],
      [post, "showroom_tourism"],
      [post, "views_direct"],
      [post, "views_social"],
      [post, "whatsapp_taps"],
      [post, "shares"],
      [second, "search_appearances"],
    ]);
    assert.deepEqual(result, { posts: 2, engaged: 0 });
    activity([[post, "list_impressions"]], { account: visitor });
    const today = day(post);
    // The pair sent twice in one call added 1; the second call added 1 more.
    assert.equal(today.list_impressions, 2);
    assert.equal(today.showroom_home, 1);
    assert.equal(today.showroom_tourism, 1);
    assert.equal(today.views_direct, 1);
    assert.equal(today.views_social, 1);
    assert.equal(today.whatsapp_taps, 1);
    assert.equal(today.shares, 1);
    assert.equal(today.phone_taps, 0);
    assert.equal(day(second).search_appearances, 1);
    assert.equal(count(`private.post_activity_days where post_id in ('${post}','${second}')`), 2);
  });

  await check("never a hidden post, the owner's own events or staff events", () => {
    assert.deepEqual(activity([[draft, "shares"]]), { posts: 0, engaged: 0 });
    assert.deepEqual(activity([[randomUUID(), "shares"]]), { posts: 0, engaged: 0 });
    assert.deepEqual(activity([[post, "shares"]], { account: owner }), { posts: 0, engaged: 0 });
    assert.deepEqual(activity([[post, "shares"]], { account: staffer }), { posts: 0, engaged: 0 });
    // The owner's events on someone else's post do count.
    assert.deepEqual(activity([[elsewhere, "shares"]], { account: owner }), {
      posts: 1,
      engaged: 0,
    });
    assert.equal(day(post).shares, 1);
    assert.equal(count(`private.post_activity_days where post_id='${draft}'`), 0);
  });

  await check("request rules: 1 to 50 pairs of the same length, known counters, no nulls", () => {
    const call = (postsSql, metricsSql, device = "null") =>
      service(`select api.record_post_activity(${postsSql},${metricsSql},${device});`);
    for (const [postsSql, metricsSql, device] of [
      [ids([post]), texts([])],
      [ids([post, post]), texts(["shares"])],
      [ids([post]), texts(["likes"])],
      [ids([post]), texts(["views"])],
      [ids([post]), "array[null]::text[]"],
      ["array[null]::uuid[]", texts(["shares"])],
      ["null", texts(["shares"])],
      [ids([post]), texts(["engaged_views"])],
      [ids(Array(51).fill(post)), texts(Array(51).fill("shares"))],
    ])
      assert.match(
        fails(call(postsSql, metricsSql, device), "22023"),
        /activity details are invalid/
      );
    assert.deepEqual(json(call(ids(Array(50).fill(post)), texts(Array(50).fill("ticket_taps")))), {
      posts: 1,
      engaged: 0,
    });
    // 50 identical pairs in one call count once.
    assert.equal(day(post).ticket_taps, 1);
  });

  await check("engaged views: once per browser per post, only after its view counted", () => {
    const device = randomUUID();
    // No counted view of this post by this browser: nothing.
    assert.deepEqual(activity([[post, "engaged_views"]], { device }), { posts: 0, engaged: 0 });
    assert.deepEqual(views([post], device), [post]);
    assert.deepEqual(
      activity(
        [
          [post, "engaged_views"],
          [post, "engaged_views"],
        ],
        { device }
      ),
      {
        posts: 0,
        engaged: 1,
      }
    );
    assert.deepEqual(activity([[post, "engaged_views"]], { device }), { posts: 0, engaged: 0 });
    // Another browser's view and engaged view count too; the owner's never.
    const another = randomUUID();
    views([post], another);
    assert.equal(activity([[post, "engaged_views"]], { device: another }).engaged, 1);
    const ownDevice = randomUUID();
    views([post], ownDevice);
    assert.equal(
      activity([[post, "engaged_views"]], { device: ownDevice, account: owner }).engaged,
      0
    );
    assert.equal(engagedOf(post), 2);
    // Across the daily salt change, the engaged mark still holds for 24 hours.
    q(`update private.post_view_salts set day=day-1;
      update private.post_view_marks set seen_at=seen_at-interval '2 hours';`);
    assert.equal(activity([[post, "engaged_views"]], { device }).engaged, 0);
    assert.ok(
      engagedOf(post) <=
        Number(json(anon(`select api.get_post_engagement(${ids([post])});`)).items[0].views)
    );
  });

  await check("the owner's read: own posts only, every figure of the page", () => {
    like(post, randomUUID());
    const mine = performanceOf(owner);
    assert.deepEqual(Object.keys(mine).sort(), [
      "engaged_views",
      "last_30_days",
      "leads",
      "live_posts",
      "posts",
      "showroom_turns",
      "sources",
      "top_posts",
      "views",
    ]);
    assert.equal(mine.posts, 3);
    assert.equal(mine.live_posts, 2);
    assert.equal(mine.engaged_views, 2);
    assert.equal(
      mine.views,
      Number(
        q(
          `select sum(views) from private.post_engagement_totals where post_id in ('${post}','${second}')`
        )
      )
    );
    assert.equal(mine.leads, 0);
    const today = day(post);
    assert.deepEqual(mine.last_30_days, {
      impression: today.list_impressions,
      detail_view: today.views_direct + today.views_social,
      whatsapp_click: 1,
      phone_click: 0,
      website_click: 0,
      directions_click: 0,
      booking_click: 0,
      ticket_click: 1,
      showroom_appearance: 2,
      organisation_directory_appearance: 0,
      search_appearance: 1,
      homepage_appearance: 0,
      share: 1,
      save: 1,
      unique_viewers: Number(
        q(`select sum(views) from private.post_view_days where post_id in ('${post}','${second}')`)
      ),
    });
    assert.deepEqual(
      mine.top_posts.map((row) => row.post_id),
      [post, second]
    );
    assert.deepEqual(mine.top_posts[0], {
      post_id: post,
      title: q(`select title from private.posts where id='${post}'`),
      area: "tourism_events",
      appearances: today.list_impressions + 2,
      views: 2,
      unique_viewers: mine.last_30_days.unique_viewers,
      contacts: 2,
      saves: 1,
      shares: 1,
    });
    assert.deepEqual(mine.sources, [
      { source: "direct", views: 1 },
      { source: "social", views: 1 },
    ]);
    // Another member sees only their own post; a member with none sees zeros.
    const theirs = performanceOf(other);
    assert.equal(theirs.posts, 1);
    assert.deepEqual(
      theirs.top_posts.map((row) => row.post_id),
      [elsewhere]
    );
    const empty = performanceOf(visitor);
    assert.equal(empty.posts, 0);
    assert.deepEqual(empty.top_posts, []);
    assert.deepEqual(empty.showroom_turns, []);
    assert.equal(empty.last_30_days.impression, 0);
  });

  await check("showroom turns: each live post, home and its area, next to the fair share", () => {
    const eligible = (where) =>
      Number(
        q(`select count(*) from private.post_search_documents d join private.posts p on p.id=d.post_id
          where d.is_visible and (d.visible_until is null or d.visible_until>now())
            and exists(select 1 from private.public_eligible_posts x where x.id=p.id) ${where}`)
      );
    const homeTotal = Number(
      q(`select coalesce(sum(showroom_home),0) from private.post_activity_days
        where day>=(now() at time zone 'Africa/Johannesburg')::date-6`)
    );
    const turns = performanceOf(owner).showroom_turns;
    assert.deepEqual(
      turns.map((row) => [row.post_id, row.surface]).sort(),
      [
        [post, "home"],
        [post, "tourism"],
        [second, "home"],
        [second, "tourism"],
      ].sort()
    );
    const home = turns.find((row) => row.post_id === post && row.surface === "home");
    assert.equal(home.appearances, 1);
    assert.equal(home.eligible_posts, eligible(""));
    assert.equal(home.fair_share, Math.round((homeTotal / eligible("")) * 10) / 10);
    const tourism = turns.find((row) => row.post_id === second && row.surface === "tourism");
    assert.equal(tourism.appearances, 0);
    assert.equal(tourism.eligible_posts, eligible("and p.area='tourism_events'"));
    // Appearances older than 7 days leave the turns but stay in the 30 days.
    q(`update private.post_activity_days set day=day-8 where post_id='${post}';`);
    const later = performanceOf(owner);
    assert.equal(
      later.showroom_turns.find((row) => row.post_id === post && row.surface === "home")
        .appearances,
      0
    );
    assert.equal(later.last_30_days.showroom_appearance, 2);
    q(`update private.post_activity_days set day=day+8 where post_id='${post}';`);
  });

  await check(
    "the clean-up is its own job: old activity days and marks go; retention no longer runs it",
    () => {
      q(`insert into private.post_activity_days(post_id,day,shares)
      values('${second}',(now() at time zone 'Africa/Johannesburg')::date-31,5),
        ('${second}',(now() at time zone 'Africa/Johannesburg')::date-30,4),
        ('${second}',(now() at time zone 'Africa/Johannesburg')::date-29,3);
      insert into private.post_view_marks(mark,seen_at) values(sha256('old'::bytea),now()-interval '25 hours');`);
      // The last 30 days are today and the 29 days before it.
      assert.equal(performanceOf(owner).last_30_days.share, 1 + 3);
      const retention = json(service("select api.run_retention(100);"));
      assert.equal("engagement" in retention, false);
      assert.equal(count(`private.post_view_marks where mark=sha256('old'::bytea)`), 1);
      const purged = json(service("select api.purge_post_engagement();"));
      assert.equal(purged.activity_days, 1);
      assert.ok(purged.marks >= 1);
      assert.equal(count(`private.post_view_marks where mark=sha256('old'::bytea)`), 0);
      assert.equal(count(`private.post_activity_days where post_id='${second}'`), 3);
      assert.equal(count(`private.scheduled_job_runs where job='engagement_purge'`), 1);
      assert.equal(
        q(
          `select every||' '||late_after from internal.scheduled_job_catalogue() where job='engagement_purge'`
        ),
        "minute 00:10:00"
      );
    }
  );

  await check("activity goes with the post", () => {
    const doomed = event(owner);
    activity([[doomed, "shares"]]);
    q(`delete from private.posts where id='${doomed}';`);
    assert.equal(count(`private.post_activity_days where post_id='${doomed}'`), 0);
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
      /^post performance stats: already applied; activity days: \d+; engaged views: \d+$/
    );
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /would be lost/);
    assert.equal(fingerprint(), before);
  });

  // ---------------------------------------------------------- later steps
  applySteps(database, steps.slice(index + 1));
  console.log(
    `PASS post performance stats: ${checks.length} checks in ${Math.round((Date.now() - started) / 1000)} s`
  );
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
