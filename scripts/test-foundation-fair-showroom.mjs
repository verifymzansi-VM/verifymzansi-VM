#!/usr/bin/env node
// Behaviour checks for 20261121224857_fair_showroom.sql: the public read
// api.showroom_feed orders each showroom by turns (7-day appearances against
// the fair share), mixes 3 city / 2 province / 2 rest-of-South-Africa places
// out of every 7, caps busy posts at twice the fair share, tags and lifts new
// posts for their first 72 hours live, and nudges by video and likes per view
// without jumping the queue.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. The script runs the update's read-only preflight, checks its refusals,
// applies it, proves apply -> rollback -> apply returns the same fingerprints,
// then checks through the production API command as a visitor: the grants; the
// request rules (LIM-SQL-showroom-request-size); the places of each showroom
// (LIM-SQL-showroom-places); the 3/2/2 mix and what happens when a group runs
// out; an unknown area; deficit order; the busy-city cap
// (LIM-SQL-showroom-busy-cap); the New tag and head start
// (LIM-SQL-showroom-new-window), never again for a post approved before; the
// likes cap (LIM-SQL-showroom-like-nudge) and the video nudge; only publicly
// live posts, card fields only; and that a read stores nothing. Posts are
// events written directly as the database owner (a live event is public until
// it ends, with no plan needed); appearances, views and likes are written into
// their tables directly. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-fair-showroom.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  executeGrants,
  openUpdateCheck,
  sqlLiteral,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261121224857_fair_showroom.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const READ = "api.showroom_feed(jsonb)";
const INTERNAL = "internal.showroom_feed(jsonb)";
const CARD_KEYS = [
  "activity",
  "area",
  "category",
  "city",
  "condition",
  "id",
  "is_new",
  "kind",
  "locality",
  "preview",
  "price_cents",
  "price_mode",
  "price_negotiable",
  "province",
  "published_at",
  "summary",
  "title",
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
  const anon = (sql) => `set role anon;\n${sql}`;

  // ------------------------------------------------------- synthetic world
  syntheticMember("showroom-setup");
  q(`create or replace function vmtest.media(p_owner uuid,p_kind text) returns uuid language plpgsql as $$
    declare oid uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
        values(oid,p_owner,p_kind,'media/'||oid,1024,1024,encode(sha256(convert_to(oid::text,'UTF8')),'hex'),
          case p_kind when 'video' then 'video/mp4' else 'image/jpeg' end,800,600,'ready');
      return oid;
    end$$;
    -- An event with a ready cover in a city, live since p_live_for ago (a
    -- draft when null); a live event (with its search document) is public
    -- until it ends.
    create or replace function vmtest.event(p_owner uuid,p_city text,p_live_for interval,p_video boolean)
    returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); begin
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
        values(pid,p_owner,'event','tourism_events','events',(select a.key from private.category_activities a
          join private.categories c on c.key=a.category_key where a.category_key='events' and c.activity_required
          order by a.key limit 1),'Fixture event '||left(pid::text,8),'A synthetic description long enough for every rule.',
          split_part(p_city,'_',1),p_city);
      insert into private.event_details(post_id,starts_at,ends_at,timezone)
        values(pid,date_trunc('milliseconds',now()+interval '20 days'),date_trunc('milliseconds',now()+interval '21 days'),
          'Africa/Johannesburg');
      insert into private.post_contacts(post_id,post_kind,channels) values(pid,'event',array['form']);
      insert into private.post_media(post_id,object_id,purpose,position) values(pid,vmtest.media(p_owner,'image'),'cover',0);
      if p_video then
        insert into private.post_media(post_id,object_id,purpose,position) values(pid,vmtest.media(p_owner,'video'),'video',0);
      end if;
      if p_live_for is not null then
        update private.posts set status='live',published_at=now()-p_live_for,
          visible_until=(select e.ends_at from private.event_details e where e.post_id=pid) where id=pid;
        perform internal.write_post_projection(pid);
      end if;
      return pid;
    end$$;`);
  const owner = syntheticMember("showroom-owner");
  const made = [];
  /** A live event in `city` (live for 10 days unless `liveFor`), shown
   * `shown` times in the tourism showroom this week (and as often on home). */
  const post = (city, { shown = 0, liveFor = "10 days", video = false } = {}) => {
    const id = q(
      `select vmtest.event('${owner.id}','${city}',${liveFor === null ? "null" : `'${liveFor}'::interval`},${video});`
    );
    if (shown > 0)
      q(`insert into private.post_activity_days(post_id,day,showroom_home,showroom_tourism)
        values('${id}',(now() at time zone 'Africa/Johannesburg')::date-1,${shown},${shown});`);
    made.push(id);
    return id;
  };
  /** Removes every post of the previous check, so each check has its own world. */
  const clear = () => {
    if (made.length === 0) return;
    q(`delete from private.posts where id in (${made.map((id) => `'${id}'`).join(",")});`);
    made.length = 0;
  };
  const feedSql = (request) =>
    anon(`select api.showroom_feed(${sqlLiteral(JSON.stringify(request))}::jsonb);`);
  const feed = (request) => json(feedSql(request)).items;
  const ids = (request) => feed(request).map((card) => card.id);
  /** The places' groups for a visitor in `city`: c (the city), p (the rest of
   * its province) or r (the rest of South Africa). */
  const groups = (request) =>
    feed(request).map((card) =>
      card.city === request.city ? "c" : card.province === request.province ? "p" : "r"
    );
  /** How often `id` is first in `runs` reads (one statement). */
  const firstCount = (request, id, runs = 200) =>
    Number(
      q(
        anon(`select count(*) from generate_series(1,${runs}) g
          where api.showroom_feed(${sqlLiteral(JSON.stringify(request))}::jsonb)->'items'->0->>'id'='${id}';`)
      )
    );
  const tourism = (extra = {}) => ({ showroom: "tourism", ...extra });
  const joburg = (extra = {}) => tourism({ province: "gp", city: "gp_johannesburg", ...extra });

  // ------------------------------------------------------------ before
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], /^fair showroom: update not applied; showroom posts: \d+$/);
    assertReadOnlyPreflight(database, PREFLIGHT);
  });

  await check("a premature rollback and a half-present update are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    q(`create function api.showroom_feed(p_request jsonb) returns jsonb language sql
      set search_path to 'pg_catalog' as $$ select '{}'::jsonb $$;`);
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[0][1], /unexpected state/);
    assert.match(rows[1][1], /^api\.showroom_feed\(jsonb\) exists but is not the update's body/);
    assert.match(fails(step.sql, "55000"), /1 of 2 functions exist/);
    q(`drop function api.showroom_feed(jsonb);`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "fair showroom",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: /^fair showroom: already applied; showroom posts: \d+$/,
  });

  await check("grants: the read for visitors and members only, never the server key", () => {
    const grants = executeGrants(json, [READ, INTERNAL]);
    const visitors = { anon: true, authenticated: true, service_role: false };
    assert.deepEqual(grants[READ], visitors);
    assert.deepEqual(grants[INTERNAL], visitors);
    assert.equal(
      q(`select prosecdef from pg_proc where oid='${READ}'::regprocedure;`),
      "f",
      "the api wrapper is security invoker"
    );
    fails(service(`select api.showroom_feed('{}');`), "42501");
    assert.deepEqual(json(member(owner, `select api.showroom_feed('{}');`)), { items: [] });
  });

  await check("request rules (LIM-SQL-showroom-request-size)", () => {
    assert.deepEqual(json(feedSql({})), { items: [] }, "home when the showroom is omitted");
    fails(feedSql({ showroom: "home", limit: "5" }), "22023", /unknown showroom filter/);
    fails(feedSql({ showroom: 1 }), "22023", /unknown showroom filter/);
    fails(feedSql({ showroom: "programme" }), "22023", /unknown showroom/);
    fails(feedSql(tourism({ province: "zz" })), "22023", /unknown province/);
    fails(feedSql(tourism({ city: "gp_johannesburg" })), "22023", /city requires its province/);
    fails(
      feedSql(tourism({ province: "kzn", city: "gp_johannesburg" })),
      "22023",
      /city requires its province/
    );
    fails(anon(`select api.showroom_feed('[]');`), "22023", /invalid showroom request/);
    // 1,024 bytes at most: the padding key is refused for itself below the bound
    // and for the size above it.
    // The size is that of the stored jsonb text ('{"x": "", "showroom": "home"}').
    const empty = Number(q(`select octet_length('{"showroom":"home","x":""}'::jsonb::text);`));
    const sized = (bytes) => ({ showroom: "home", x: "a".repeat(bytes - empty) });
    fails(feedSql(sized(1024)), "22023", /unknown showroom filter/);
    fails(feedSql(sized(1025)), "22023", /invalid showroom request/);
  });

  await check("places: 15 on home, 7 in an area showroom (LIM-SQL-showroom-places)", () => {
    for (let i = 0; i < 16; i += 1) post("kzn_durban");
    assert.equal(feed({}).length, 15);
    assert.equal(feed(tourism()).length, 7);
    assert.equal(feed({ showroom: "market" }).length, 0, "events are not in the market showroom");
    assert.equal(feed({ showroom: "business" }).length, 0);
    clear();
  });

  await check("only publicly live posts, with card fields only", () => {
    const live = post("gp_johannesburg");
    const draft = post("gp_johannesburg", { liveFor: null });
    const ended = post("gp_johannesburg");
    q(`update private.posts set status='expired' where id='${ended}';
       select internal.write_post_projection('${ended}');`);
    const cards = feed(tourism());
    assert.deepEqual(
      cards.map((card) => card.id),
      [live]
    );
    assert.deepEqual(Object.keys(cards[0]).sort(), CARD_KEYS);
    assert.deepEqual(Object.keys(cards[0].preview).sort(), ["image_key", "video_key"]);
    assert.match(cards[0].preview.image_key, /^media\/[a-f0-9-]{36}$/);
    assert.equal(cards[0].preview.video_key, null);
    assert.equal(cards[0].is_new, false);
    assert.ok(!ids(tourism()).includes(draft));
    clear();
  });

  await check("the 3 / 2 / 2 mix out of every 7 places", () => {
    for (let i = 0; i < 7; i += 1) {
      post("gp_johannesburg");
      post("gp_pretoria");
      post("kzn_durban");
    }
    for (let run = 0; run < 5; run += 1)
      assert.deepEqual(groups(joburg()), ["c", "p", "r", "c", "p", "c", "r"]);
    // Home: the pattern twice, then a city place (7 near, 4 province, 4 rest).
    const home = groups({ province: "gp", city: "gp_johannesburg" });
    assert.deepEqual(home, [..."cprcpcr", ..."cprcpcr", "c"]);
    clear();
  });

  await check("a group that runs out passes its places on", () => {
    // No post in the visitor's city: its places go to the province.
    for (let i = 0; i < 6; i += 1) post("gp_pretoria");
    for (let i = 0; i < 6; i += 1) post("kzn_durban");
    assert.deepEqual(groups(joburg()), ["p", "p", "r", "p", "p", "p", "r"]);
    // A province known without a city: the same.
    assert.deepEqual(
      feed(tourism({ province: "gp" })).map((card) => card.province),
      ["gp", "gp", "kzn", "gp", "gp", "gp", "kzn"]
    );
    clear();
    // One city post and nothing else in the province: the rest fill in.
    post("gp_johannesburg");
    for (let i = 0; i < 8; i += 1) post("kzn_durban");
    assert.deepEqual(groups(joburg()), ["c", "r", "r", "r", "r", "r", "r"]);
    clear();
    // Only city posts: never short while posts are live.
    for (let i = 0; i < 7; i += 1) post("gp_johannesburg");
    assert.deepEqual(groups(joburg()), ["c", "c", "c", "c", "c", "c", "c"]);
    clear();
  });

  await check("deficit order: the posts seen least this week go first", () => {
    // Fair share 30 (120 appearances over 4 posts): the posts are 2/3 of a
    // turn apart, more than every nudge and the randomness together.
    const posts = [0, 20, 40, 60].map((shown, i) =>
      post(["gp_johannesburg", "kzn_durban", "wc_cape_town", "gp_pretoria"][i], { shown })
    );
    // An unknown area is one all-South-Africa queue: the mix plays no part.
    for (let run = 0; run < 10; run += 1) assert.deepEqual(ids(tourism()), posts);
    clear();
  });

  await check(
    "busy-city cap: over twice the fair share waits in the national queue (LIM-SQL-showroom-busy-cap)",
    () => {
      // 130 appearances over 6 posts: fair share 21.7, twice it 43.3.
      const busy = post("gp_johannesburg", { shown: 100 });
      const local = post("gp_johannesburg", { shown: 30 });
      for (let i = 0; i < 4; i += 1) post("kzn_durban");
      for (let run = 0; run < 5; run += 1) {
        const order = ids(joburg());
        assert.equal(order[0], local, "under twice the fair share it keeps its city place");
        assert.equal(order.at(-1), busy, "the busy post is last in the national queue");
      }
      clear();
      // At exactly twice the fair share it keeps its place: 40 of 80 over 4 posts.
      const edge = post("gp_johannesburg", { shown: 40 });
      post("kzn_durban", { shown: 40 });
      post("kzn_durban");
      post("kzn_durban");
      assert.equal(ids(joburg())[0], edge);
      clear();
    }
  );

  await check("New tag and head start for 72 hours, once (LIM-SQL-showroom-new-window)", () => {
    const fresh = post("kzn_durban", { liveFor: "1 hour", shown: 10 });
    const ageing = post("kzn_durban", { liveFor: "71 hours", shown: 10 });
    const old = post("kzn_durban", { liveFor: "73 hours", shown: 10 });
    const again = post("kzn_durban", { liveFor: "1 hour", shown: 10 });
    const edited = post("kzn_durban", { liveFor: "1 hour", shown: 10 });
    // `again` was approved and live 10 days ago, then approved again now; an
    // earlier approval of an edit copy does not count as going live.
    const staffer = syntheticMember("showroom-staff");
    q(`set session_replication_role=replica;
      insert into private.moderation_log(post_id,edit_id,staff_id,decision,post_revision,decided_at) values
        ('${again}',null,'${staffer.id}','approve',1,now()-interval '10 days'),
        ('${again}',null,'${staffer.id}','approve',3,now()-interval '1 hour'),
        ('${edited}','${old}','${staffer.id}','approve',1,now()-interval '10 days'),
        ('${edited}',null,'${staffer.id}','approve',1,now()-interval '1 hour');`);
    const cards = Object.fromEntries(feed(tourism()).map((card) => [card.id, card.is_new]));
    assert.deepEqual(cards, {
      [fresh]: true,
      [ageing]: true,
      [old]: false,
      [again]: false,
      [edited]: true,
    });
    // Level turns otherwise: the 1-hour-old posts lead by almost a whole turn.
    for (let run = 0; run < 5; run += 1)
      assert.deepEqual(ids(tourism()).slice(0, 2).sort(), [fresh, edited].sort());
    clear();
  });

  await check("likes help a little and never jump the queue (LIM-SQL-showroom-like-nudge)", () => {
    // Level turns: 50 likes in 50 views reach the cap (0.15 of a turn), against
    // 0.0375 without likes, so the liked post is first about 80% of the time.
    const liked = post("kzn_durban", { shown: 10 });
    const plain = post("kzn_durban", { shown: 10 });
    q(`insert into private.post_view_days(post_id,day,views)
        values('${liked}',(now() at time zone 'Africa/Johannesburg')::date-1,50);
      insert into private.post_likes(post_id,device_mark,waiting,counts_from)
        select '${liked}',sha256(convert_to(g::text||'${liked}','UTF8')),false,now()-interval '1 day'
        from generate_series(1,50) g;
      -- Likes still waiting and likes older than 30 days do not count.
      insert into private.post_likes(post_id,device_mark,waiting,counts_from)
        select '${plain}',sha256(convert_to(g::text||'${plain}','UTF8')),g<=50,now()-case when g<=50 then interval '0' else interval '40 days' end
        from generate_series(1,100) g;`);
    const firsts = firstCount(tourism(), liked);
    assert.ok(firsts > 120 && firsts < 200, `liked first ${firsts} of 200`);
    clear();
    // Half a turn behind, a farmed like count still never goes first:
    // 0.1125 (likes) + 0.3 (randomness) < 0.5. Fair share 20 (40 over 2).
    const behind = post("kzn_durban", { shown: 25 });
    const ahead = post("kzn_durban", { shown: 15 });
    q(`insert into private.post_view_days(post_id,day,views)
        values('${behind}',(now() at time zone 'Africa/Johannesburg')::date-1,1000);
      insert into private.post_likes(post_id,device_mark,waiting,counts_from)
        select '${behind}',sha256(convert_to(g::text||'${behind}','UTF8')),false,now()
        from generate_series(1,1000) g;`);
    assert.equal(firstCount(tourism(), ahead), 200);
    clear();
  });

  await check("a ready video helps a little and never jumps the queue", () => {
    const video = post("kzn_durban", { shown: 10, video: true });
    const photo = post("kzn_durban", { shown: 10 });
    const firsts = firstCount(tourism(), video);
    assert.ok(firsts > 130 && firsts < 200, `video first ${firsts} of 200`);
    assert.match(feed(tourism()).find((card) => card.id === video).preview.video_key, /^media\//);
    clear();
    const behind = post("kzn_durban", { shown: 25, video: true });
    const ahead = post("kzn_durban", { shown: 15 });
    assert.equal(firstCount(tourism(), ahead), 200);
    assert.ok(photo && behind);
    clear();
  });

  await check("a read stores nothing about the visitor", () => {
    for (let i = 0; i < 4; i += 1) post("gp_johannesburg", { shown: i });
    const counts = () =>
      q(`select string_agg(c.relname||'='||(xpath('/row/n/text()',
          query_to_xml(format('select count(*) as n from %I.%I',n.nspname,c.relname),false,true,'')))[1]::text,',' order by c.relname)
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('private','public','internal','api') and c.relkind='r';`);
    const before = counts();
    // In a read-only transaction: any write would fail with 25006.
    q(
      anon(`begin read only;
        select api.showroom_feed('{"showroom":"home","province":"gp","city":"gp_johannesburg"}');
        select api.showroom_feed('{"showroom":"tourism","province":"gp"}');
        select api.showroom_feed('{}');
        commit;`)
    );
    assert.equal(counts(), before);
    clear();
  });

  await check("preflight after: already applied", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], /^fair showroom: already applied; showroom posts: \d+$/);
  });

  // ---------------------------------------------------------- later steps
  applySteps(database, steps.slice(index + 1));
  console.log(
    `PASS fair showroom: ${checks.length} checks in ${Math.round((Date.now() - started) / 1000)} s`
  );
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
