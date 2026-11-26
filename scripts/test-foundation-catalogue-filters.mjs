#!/usr/bin/env node
// Behaviour checks for 20261126062428_catalogue_filters_in_database.sql: the
// public search (internal.search_posts, behind api.search_posts and
// api.search_post_cards) filters one organisation's supported posts, one of
// its programmes and its sponsored posts, finds every business with kind
// instead of an area, and returns up to 200 ids in one call with ids_only.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. The script checks the read-only preflight, a premature rollback and
// drifted bodies, applies the update and proves apply -> rollback -> apply,
// then checks through the production API commands as a visitor: the grants;
// the organisation filter (active affiliations of a listed organisation to
// public posts only; an unknown, unlisted or suspended organisation matches
// nothing); the programme filter; the sponsored filter (a running sponsorship
// by that organisation only); totals and paging in the unfiltered order;
// kind business without an area equal to the Business area and the tourism
// businesses merged in the database's order; ids_only (the same ids in the
// same order, 1 to 200, never on a card page); every request refusal; and the
// time one organisation's first page of 24 takes among 1,000 business posts.
// Posts, organisations, affiliations and sponsorships are written directly as
// the database owner; a business is public through a staff-granted slot. Any
// later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-catalogue-filters.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertDriftRefused,
  assertReadOnlyPreflight,
  executeGrants,
  openUpdateCheck,
  sqlLiteral,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261126062428_catalogue_filters_in_database.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const SEARCH = "internal.search_posts(jsonb)";
const CARDS = "internal.search_post_cards(jsonb)";
const SUMMARY = (state) =>
  new RegExp(
    `^catalogue filters: ${state}; listed organisations: \\d+; active affiliations: \\d+; running sponsorships: \\d+$`
  );

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
  const owner = syntheticMember("catalogue-owner");
  q(`-- A business post, public through a staff-granted slot, live since
    -- p_live_for ago (a draft when null).
    create or replace function vmtest.business(p_owner uuid,p_slot uuid,p_area text,p_title text,
      p_live_for interval) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cat text; begin
      select c.category_key into cat from private.post_category_contracts c
        where c.kind='business' and c.area=p_area order by c.category_key limit 1;
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
        values(pid,p_owner,'business',p_area,cat,(select a.key from private.category_activities a
          join private.categories c on c.key=a.category_key where a.category_key=cat and c.activity_required
          order by a.key limit 1),p_title,'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      insert into private.business_details(post_id) values(pid);
      if p_live_for is not null then
        insert into private.post_activations(post_id,entitlement_id,owner_id) values(pid,p_slot,p_owner);
        update private.posts set status='live',published_at=now()-p_live_for,visible_until=now()+interval '30 days'
          where id=pid;
        perform internal.write_post_projection(pid);
      end if;
      return pid;
    end$$;
    create or replace function vmtest.slot(p_owner uuid) returns uuid language sql as $$
      insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
        values(p_owner,'staff_grant',p_owner,1000,10,1,now()-interval '1 day',now()+interval '60 days') returning id $$;
    create or replace function vmtest.organisation(p_slug text,p_status text,p_public boolean) returns uuid
      language sql as $$
      insert into private.organisations(slug,name,programme_status,is_public)
        values(p_slug,'Fixture '||p_slug,p_status,p_public) returning id $$;
    create or replace function vmtest.affiliate(p_org uuid,p_post uuid,p_programme uuid,p_by uuid) returns uuid
      language sql as $$
      insert into private.organisation_affiliations(organisation_id,programme_id,post_id,confirmed_by)
        values(p_org,p_programme,p_post,p_by) returning id $$;
    -- A sponsorship of an affiliated post running from p_from to p_to.
    create or replace function vmtest.sponsor(p_affiliation uuid,p_from interval,p_to interval) returns uuid
      language plpgsql as $$
    declare a private.organisation_affiliations; sid uuid:=gen_random_uuid(); slot uuid; begin
      select * into a from private.organisation_affiliations where id=p_affiliation;
      insert into private.entitlements(owner_id,source,sponsorship_id,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
        values(a.confirmed_by,'sponsorship',sid,a.confirmed_by,1,10,1,now()+p_from,now()+p_to) returning id into slot;
      insert into private.organisation_sponsorships(id,organisation_id,affiliation_id,post_id,owner_id,sponsor_type,
          status,starts_at,ends_at,entitlement_id,requested_by)
        values(sid,a.organisation_id,a.id,a.post_id,a.confirmed_by,'founding','active',now()+p_from,now()+p_to,slot,
          a.confirmed_by);
      return sid;
    end$$;`);
  const slot = q(`select vmtest.slot('${owner.id}');`);
  let minute = 0;
  /** A live business (each one a minute older than the last), or a draft. */
  const business = (title, { area = "business", draft = false } = {}) =>
    q(
      `select vmtest.business('${owner.id}','${slot}','${area}',${sqlLiteral(title)},${draft ? "null" : `'${(minute += 1)} minutes'::interval`});`
    );
  const organisation = (slug, status = "founding_trial", visible = true) =>
    q(`select vmtest.organisation('${slug}','${status}',${visible});`);
  const programme = (org, slug) =>
    q(`insert into private.organisation_programmes(organisation_id,slug,name)
      values('${org}','${slug}','Fixture programme') returning id;`);
  const affiliate = (org, post, prog = null) =>
    q(`select vmtest.affiliate('${org}','${post}',${prog ? `'${prog}'` : "null"},'${owner.id}');`);
  const searchSql = (request) =>
    anon(`select api.search_posts(${sqlLiteral(JSON.stringify(request))}::jsonb);`);
  const cardsSql = (request) =>
    anon(`select api.search_post_cards(${sqlLiteral(JSON.stringify(request))}::jsonb);`);
  const search = (request) => json(searchSql(request));
  const ids = (request) => search({ limit: 48, ...request }).items.map((row) => row.id);

  // ------------------------------------------------------------ before
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], SUMMARY("update not applied"));
    assertReadOnlyPreflight(database, PREFLIGHT);
  });

  await check("the earlier body refuses the new keys", () => {
    for (const key of ["organisation", "programme", "kind"])
      fails(searchSql({ [key]: "x" }), "22023", /unknown search filter/);
    fails(searchSql({ ids_only: true }), "22023", /unknown search filter/);
  });

  await check("a premature rollback and drifted bodies are refused", () =>
    assertDriftRefused(
      { q, fails, fingerprint, preflightRows: preflight },
      {
        rollback: ROLLBACK,
        updateSql: step.sql,
        signatures: [SEARCH, CARDS],
        drift: /catalogue filters precondition: internal\.search_post/,
      }
    )
  );

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "catalogue filters",
    fingerprint,
    preflightRows: preflight,
    appliedSummary: SUMMARY("already applied"),
  });

  await check("grants: visitors and members only, as before", () => {
    const grants = executeGrants(json, [
      "api.search_posts(jsonb)",
      "api.search_post_cards(jsonb)",
      SEARCH,
      CARDS,
    ]);
    for (const grant of Object.values(grants))
      assert.deepEqual(grant, { anon: true, authenticated: true, service_role: false });
    fails(service(`select api.search_posts('{}');`), "42501");
    assert.equal(json(member(owner, `select api.search_posts('{}');`)).total, 0);
  });

  // The small world: two listed organisations, one unlisted, one suspended.
  const local = organisation("local-org");
  const other = organisation("other-org", "active_paid");
  const hidden = organisation("hidden-org", "founding_trial", false);
  const suspended = organisation("suspended-org", "suspended");
  const [first, second] = [programme(local, "first"), programme(local, "second")];
  const posts = Array.from({ length: 8 }, (_, n) => business(`Fixture shop ${n}`));
  const draft = business("Fixture draft shop", { draft: true });
  const links = {
    a0: affiliate(local, posts[0], first),
    a1: affiliate(local, posts[1], second),
    a2: affiliate(local, posts[2], first),
    a3: affiliate(local, posts[3]),
    a5: affiliate(local, posts[5]),
    other4: affiliate(other, posts[4]),
    other0: affiliate(other, posts[0]),
  };
  affiliate(local, draft);
  affiliate(hidden, posts[6]);
  affiliate(suspended, posts[7]);
  // An ended affiliation no longer counts.
  q(`update private.organisation_affiliations set status='ended',revoked_at=now(),revoked_by='${owner.id}'
    where id='${links.a5}';`);
  // Sponsorships: running (posts 0 and 2), not started (1), ran out (3), and
  // one by the other organisation (0).
  q(`select vmtest.sponsor('${links.a0}','-1 day','10 days');
    select vmtest.sponsor('${links.a2}','-1 day','10 days');
    select vmtest.sponsor('${links.a1}','1 day','10 days');
    select vmtest.sponsor('${links.a3}','-10 days','-1 day');
    select vmtest.sponsor('${links.other0}','-1 day','10 days');`);
  const everyone = ids({ area: "business" });

  await check("organisation: active affiliations of public posts, in the unfiltered order", () => {
    const local4 = [posts[0], posts[1], posts[2], posts[3]];
    const page = search({ area: "business", organisation: "local-org", limit: 48 });
    assert.deepEqual(
      page.items.map((row) => row.id),
      everyone.filter((id) => local4.includes(id))
    );
    assert.equal(page.total, 4);
    assert.deepEqual(
      ids({ area: "business", organisation: "other-org" }).sort(),
      [posts[0], posts[4]].sort()
    );
    // Paging walks the same order, with the full total on every page.
    const pages = [0, 2].map((offset) =>
      search({ area: "business", organisation: "local-org", limit: 2, offset })
    );
    assert.deepEqual(
      pages.flatMap((p) => p.items.map((row) => row.id)),
      page.items.map((row) => row.id)
    );
    assert.deepEqual(
      pages.map((p) => p.total),
      [4, 4]
    );
  });

  await check("an unknown, unlisted or suspended organisation matches nothing", () => {
    for (const slug of ["no-such-org", "hidden-org", "suspended-org"]) {
      const page = search({ area: "business", organisation: slug });
      assert.deepEqual([page.items, page.total], [[], 0], slug);
    }
  });

  await check("programme: one of the organisation's programmes", () => {
    assert.deepEqual(
      ids({ area: "business", organisation: "local-org", programme: first }).sort(),
      [posts[0], posts[2]].sort()
    );
    assert.deepEqual(ids({ area: "business", organisation: "local-org", programme: second }), [
      posts[1],
    ]);
    // Another organisation's programme, or an unknown one, matches nothing.
    assert.deepEqual(ids({ area: "business", organisation: "other-org", programme: first }), []);
    assert.deepEqual(
      ids({ area: "business", organisation: "local-org", programme: randomUUID() }),
      []
    );
  });

  await check("sponsored: a sponsorship by that organisation running now", () => {
    assert.deepEqual(
      ids({ area: "business", organisation: "local-org", sponsored: true }).sort(),
      [posts[0], posts[2]].sort()
    );
    assert.deepEqual(ids({ area: "business", organisation: "other-org", sponsored: true }), [
      posts[0],
    ]);
    assert.deepEqual(
      ids({ area: "business", organisation: "local-org", programme: second, sponsored: true }),
      []
    );
    // false is no filter.
    assert.equal(
      search({ area: "business", organisation: "local-org", sponsored: false }).total,
      4
    );
  });

  await check("cards: the website's card page carries the same filter", () => {
    const page = json(
      cardsSql({
        area: "business",
        organisation: "local-org",
        programme: first,
        sponsored: true,
        limit: 24,
        offset: 0,
        presentation: true,
        frontend_presentation: true,
      })
    );
    assert.deepEqual(page.items.map((row) => row.id).sort(), [posts[0], posts[2]].sort());
    assert.equal(page.total, 2);
  });

  await check(
    "kind business without an area: the Business area and tourism businesses merged",
    () => {
      const lodges = [
        business("Fixture lodge near the river"),
        business("Fixture lodge and spa", { area: "tourism_events" }),
        business("Fixture river lodge", { area: "tourism_events" }),
        business("Fixture lodge supplies"),
      ];
      const request = { q: "lodge", limit: 48 };
      const merged = search({ ...request, kind: "business" });
      const scopes = [
        search({ ...request, area: "business" }),
        search({ ...request, area: "tourism_events", category: "tourism_hospitality" }),
      ];
      // The website's earlier merge order: score, then newest, then id.
      const order = (a, b) =>
        Number(b.score) - Number(a.score) ||
        Date.parse(b.published_at) - Date.parse(a.published_at) ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
      assert.deepEqual(
        merged.items.map((row) => row.id),
        scopes
          .flatMap((s) => s.items)
          .sort(order)
          .map((row) => row.id)
      );
      assert.equal(merged.total, scopes[0].total + scopes[1].total);
      assert.equal(merged.total, lodges.length);
      // Without a query, kind business covers both areas and nothing else.
      assert.equal(
        search({ kind: "business" }).total,
        search({ area: "business" }).total + search({ area: "tourism_events" }).total
      );
      assert.equal(search({ kind: "listing" }).total, 0);
    }
  );

  await check("ids_only: the same ids in the same order, up to 200", () => {
    const full = search({ area: "business", limit: 48 });
    const only = search({ area: "business", limit: 48, ids_only: true });
    assert.deepEqual(
      only.items,
      full.items.map((row) => row.id)
    );
    assert.equal(only.total, full.total);
    assert.deepEqual(Object.keys(only).sort(), ["facets", "items", "next_cursor", "sort", "total"]);
    assert.ok(
      search({ area: "business", limit: 200, offset: 0, ids_only: true }).items.length <= 200
    );
    // A cursor continues an ids-only search like any other.
    const head = search({ area: "business", limit: 3, ids_only: true });
    const next = search({ area: "business", limit: 3, ids_only: true, cursor: head.next_cursor });
    assert.deepEqual(
      [...head.items, ...next.items],
      full.items.slice(0, 6).map((row) => row.id)
    );
  });

  await check("request refusals", () => {
    const refusals = [
      [{ limit: 201, ids_only: true }, /limit must be 1 to 48, or 1 to 200 with ids_only/],
      [{ limit: 49 }, /limit must be 1 to 48/],
      [{ ids_only: "true" }, /sponsored and ids_only must be true or false/],
      [{ organisation: "local-org", sponsored: 1 }, /sponsored and ids_only must be true or false/],
      [{ programme: first }, /programme and sponsored filters require an organisation/],
      [{ sponsored: true }, /programme and sponsored filters require an organisation/],
      [{ sponsored: false }, /programme and sponsored filters require an organisation/],
      [{ organisation: "Local-Org" }, /invalid organisation/],
      [{ organisation: "a".repeat(61) }, /invalid organisation/],
      [{ organisation: "local-org", programme: "first" }, /invalid programme/],
      [{ kind: "person" }, /unknown post kind/],
      [{ organisation: true }, /search filters must be strings/],
    ];
    for (const [request, reason] of refusals) fails(searchSql(request), "22023", reason);
    fails(cardsSql({ ids_only: true }), "22023", /ids_only is not a card option/);
    fails(cardsSql({ ids_only: false, limit: 1 }), "22023", /ids_only is not a card option/);
  });

  await check("one organisation's first page among 1,000 business posts (timed)", () => {
    const big = organisation("big-org");
    const volume = q(`select vmtest.slot('${owner.id}');`);
    q(`select vmtest.business('${owner.id}','${volume}','business','Fixture volume shop '||g,
        make_interval(mins => 100 + g)) from generate_series(1,1000) g;`);
    q(`select vmtest.affiliate('${big}',p.id,null,'${owner.id}') from (
        select id from private.posts where title like 'Fixture volume shop %' order by title limit 100) p;`);
    q("analyze;");
    const request = {
      area: "business",
      organisation: "big-org",
      limit: 24,
      offset: 0,
      presentation: true,
      frontend_presentation: true,
    };
    const page = json(cardsSql(request));
    assert.equal(page.items.length, 24);
    assert.equal(page.total, 100);
    const runs = [1, 2, 3].map((run) => {
      const plan = JSON.parse(
        q(
          anon(
            `explain (analyze, format json) select api.search_post_cards(${sqlLiteral(JSON.stringify(request))}::jsonb);`
          )
        )
      );
      return { run, ms: plan[0]["Execution Time"] };
    });
    const median = runs.map((r) => r.ms).sort((a, b) => a - b)[1];
    console.log(
      `TIMING one organisation's first 24 of 100 among ${search({ area: "business" }).total} business posts: ` +
        `${runs.map((r) => r.ms.toFixed(1)).join(", ")} ms (median ${median.toFixed(1)} ms)`
    );
    assert.ok(median < 1000, `median ${median} ms`);
  });

  await check("preflight after: already applied", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], SUMMARY("already applied"));
  });

  // ---------------------------------------------------------- later steps
  applySteps(database, steps.slice(index + 1));
  console.log(
    `PASS catalogue filters: ${checks.length} checks in ${Math.round((Date.now() - started) / 1000)} s`
  );
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
