/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readRestoredCollection } from "./marketplace-read";
import type { FoundationPublicApi } from "./public-api";

// Actual update SQL on isolated embedded PostgreSQL. The fixture supplies only
// the surrounding projection/auth context; it never opens a hosted connection.
const baseline = readFileSync("database/foundation/candidate.sql", "utf8");
const update = readFileSync(
  "database/foundation/updates/20261029191349_restore_public_browse_contract.sql",
  "utf8"
);
function definition(name: string) {
  const matches = [
    ...baseline.matchAll(
      /create(?: or replace)? function ((?:internal|api)\.[a-z_][a-z0-9_]*)\([^$]*?as \$\$[\s\S]*?\$\$;/g
    ),
  ].filter((match) => match[1] === name);
  if (!matches.length) throw new Error(`Missing baseline function ${name}`);
  return matches.at(-1)![0];
}
let db: PGlite;
const owner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const types = [
  "mall_store",
  "standalone_shop",
  "home_business",
  "mobile_service",
  "online_only",
  "market_stall",
];
const rpc = vi.fn(async (name: string, args: { p_request: unknown }) => {
  if (name !== "search_post_cards") throw new Error(`Unexpected RPC ${name}`);
  const result = await db.query<{ data: unknown }>("select api.search_post_cards($1::jsonb) data", [
    JSON.stringify(args.p_request),
  ]);
  return { data: result.rows[0]!.data, error: null };
});
const api = { rpc } as unknown as FoundationPublicApi;

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`
    create schema private; create schema internal; create schema api; create schema extensions;
    create extension pg_trgm with schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema internal,api to anon,authenticated;
    create table private.posts(id uuid primary key,owner_id uuid,kind text,area text,category_key text,activity_key text,status text default 'live',revision int default 1,content_updated_at timestamptz default now(),edit_of uuid,eligible boolean default true);
    create view private.public_eligible_posts as select id from private.posts where status='live' and eligible;
    create table private.business_details(post_id uuid primary key,post_kind text default 'business');
    alter table private.business_details enable row level security;
    create table private.event_details(post_id uuid primary key,starts_at timestamptz,ends_at timestamptz,timezone text);
    create table private.post_event_timezones(name text); insert into private.post_event_timezones values ('Africa/Johannesburg');
    create table private.categories(key text,area text,activity_required boolean default false);
    insert into private.categories(key,area) values ('electronics','market'),('general_other','business'),('events','tourism_events');
    create table private.category_activities(category_key text,key text);
    insert into private.category_activities values ('events','market_expo');
    create table private.provinces(id text); insert into private.provinces values ('gp');
    create table private.cities(id text,province_id text); insert into private.cities values ('gp_johannesburg','gp');
    create table private.category_fields(category_key text,key text,facet_kind text,validation jsonb);
    create table private.post_search_documents(post_id uuid primary key,kind text,area text,category_key text,activity_key text,province_id text,city_id text,locality_label text,title text,summary text,price_mode text,price_cents bigint,price_negotiable boolean default false,published_at timestamptz,visible_until timestamptz,is_visible boolean,facets jsonb default '{}',search_text text,document tsvector);
    create table private.media_objects(id uuid,state text,kind text,object_key text);
    create table private.post_media(post_id uuid,object_id uuid,purpose text,position int);
    create function internal.price_draft_actor() returns uuid language sql stable as $$select current_setting('test.actor')::uuid$$;
    create function internal.assert_post_revision(revision integer) returns void language plpgsql as $$begin if revision is null or revision<1 then raise exception 'invalid revision'; end if; end$$;
    ${definition("internal.search_posts")}
    ${definition("internal.search_post_cards")}
    ${definition("internal.save_business_event_context")}
    ${definition("api.search_post_cards")}
    revoke all on function internal.search_posts(jsonb),internal.search_post_cards(jsonb),internal.save_business_event_context(uuid,integer,jsonb),api.search_post_cards(jsonb) from public;
    grant execute on function internal.search_posts(jsonb),internal.search_post_cards(jsonb),api.search_post_cards(jsonb) to anon,authenticated;
    grant execute on function internal.save_business_event_context(uuid,integer,jsonb) to authenticated;
  `);
  await db.exec(update);
  await db.exec(update); // reviewed re-application is safe, with unchanged grants.
  for (let n = 1; n <= 100; n++) {
    await db.query(
      "insert into private.posts(id,owner_id,kind,area,category_key,activity_key) values($1,$2,'event','tourism_events','events','market_expo')",
      [id(n), owner]
    );
  }
  await db.exec(`
    insert into private.event_details select id,
      date_trunc('milliseconds',now()+case when right(id::text,12)::bigint<=10 then interval '-2 days' else interval '1 day' end),
      date_trunc('milliseconds',now()+case when right(id::text,12)::bigint<=10 then interval '-1 day' else interval '2 days' end),'Africa/Johannesburg' from private.posts;
    insert into private.post_search_documents(post_id,kind,area,category_key,activity_key,province_id,city_id,locality_label,title,summary,published_at,visible_until,is_visible,search_text,document)
      select id,kind,area,category_key,activity_key,'gp','gp_johannesburg','Johannesburg','Public event','Fixture',now()-interval '1 hour',now()+interval '365 days',true,'public event',to_tsvector('simple','public event') from private.posts;
  `);
  for (const [n, type] of types.entries()) {
    await db.query(
      "insert into private.posts(id,owner_id,kind,area,category_key) values($1,$2,'business','business','general_other')",
      [id(501 + n), owner]
    );
    await db.query("insert into private.business_details(post_id,business_type) values($1,$2)", [
      id(501 + n),
      type,
    ]);
    await db.query(
      "insert into private.post_search_documents(post_id,kind,area,category_key,province_id,city_id,locality_label,title,summary,published_at,visible_until,is_visible,search_text,document) values($1,'business','business','general_other','gp','gp_johannesburg','Johannesburg','Public business','Fixture',now()-interval '1 hour',now()+interval '365 days',true,'business',to_tsvector('simple','business'))",
      [id(501 + n)]
    );
  }
}, 30000);
beforeEach(async () => {
  await db.exec("reset role");
  rpc.mockClear();
});
afterAll(async () => {
  await db?.close();
});

it("filters and counts event dates before paging, with one RPC for twelve cards", async () => {
  await db.exec("set role anon");
  const first = await readRestoredCollection(
    api,
    "promotions",
    new URLSearchParams({ limit: "12" })
  );
  expect(first.rows).toHaveLength(12);
  expect(first.total).toBe(90);
  expect(first.rows.every((row) => row.start_date && row.end_date)).toBe(true);
  expect(rpc).toHaveBeenCalledTimes(1);
  const next = await readRestoredCollection(
    api,
    "promotions",
    new URLSearchParams({ limit: "12", page: "2" })
  );
  expect(next.rows.every((row) => !first.rows.some((firstRow) => firstRow.id === row.id))).toBe(
    true
  );
  const past = await readRestoredCollection(
    api,
    "promotions",
    new URLSearchParams({ event_state: "ended", event_order: "end_desc" })
  );
  expect(past.total).toBe(10);
});

it("supports every existing business format without inventing values", async () => {
  await db.exec("set role anon");
  for (const type of types) {
    const result = await readRestoredCollection(api, "businesses", new URLSearchParams({ type }));
    expect(result.total).toBe(1);
    expect(result.rows[0]?.business_type).toBe(type);
  }
});

it("preserves the legacy card response unless presentation is requested", async () => {
  const result = await db.query<{ data: { items: object[]; presentation_contract?: string } }>(
    'select api.search_post_cards(\'{"area":"business"}\') data'
  );
  expect(result.rows[0]!.data.presentation_contract).toBeUndefined();
  expect(result.rows[0]!.data.items[0]).not.toHaveProperty("presentation");
});

it("keeps hidden and revoked projections out of the public read", async () => {
  await db.query("update private.posts set eligible=false where id=$1", [id(501)]);
  await db.exec("set role anon");
  const result = await readRestoredCollection(
    api,
    "businesses",
    new URLSearchParams({ type: "mall_store" })
  );
  expect(result).toMatchObject({ total: 0, rows: [] });
  await expect(db.query("select business_type from private.business_details")).rejects.toThrow();
});

it("allows business format writes only for the owner and current editable revision", async () => {
  await db.query(
    "insert into private.posts(id,owner_id,kind,area,category_key,status) values($1,$2,'business','business','general_other','draft')",
    [id(600), owner]
  );
  await db.query("insert into private.business_details(post_id) values($1)", [id(600)]);
  await db.exec(`set test.actor='${other}'; set role authenticated`);
  await expect(
    db.query(
      'select internal.save_business_event_context($1,1,\'{"business_type":"online_only"}\')',
      [id(600)]
    )
  ).rejects.toThrow("business or event not found");
  await db.exec(`reset role; set test.actor='${owner}'; set role authenticated`);
  await db.query(
    'select internal.save_business_event_context($1,1,\'{"business_type":"online_only"}\')',
    [id(600)]
  );
  await expect(
    db.query(
      'select internal.save_business_event_context($1,1,\'{"business_type":"home_business"}\')',
      [id(600)]
    )
  ).rejects.toThrow("post changed");
  await db.exec("reset role; set role anon");
  await expect(
    db.query(
      'select internal.save_business_event_context($1,2,\'{"business_type":"home_business"}\')',
      [id(600)]
    )
  ).rejects.toThrow("permission denied");
});
