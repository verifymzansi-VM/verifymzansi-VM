/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
import { readFoundationPresentedEnquiries, readFoundationEnquiries } from "./owner-inbox";
import { restoredEnquiry } from "./restored-inbox";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
const baseline = readFileSync("database/foundation/candidate.sql", "utf8");
const definition = (name: string) =>
  [
    ...baseline.matchAll(
      /create(?: or replace)? function (internal\.[a-z_]+)\([^$]*?as \$\$[\s\S]*?\$\$;/g
    ),
  ]
    .filter((m) => m[1] === name)
    .at(-1)![0];
const update = readFileSync(
  "database/foundation/updates/20261103192835_restored_enquiry_post_area.sql",
  "utf8"
);
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
let db: PGlite;
const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
  const fn =
    name === "list_my_frontend_enquiries"
      ? "api.list_my_frontend_enquiries"
      : "internal.list_my_enquiries";
  const params =
    name === "list_my_frontend_enquiries"
      ? [
          args.p_limit,
          args.p_status ?? null,
          args.p_before_created ?? null,
          args.p_before_id ?? null,
        ]
      : [
          args.p_status ?? null,
          args.p_before_created ?? null,
          args.p_before_id ?? null,
          args.p_limit,
        ];
  const r = await db.query<{ data: unknown }>(`select ${fn}($1,$2,$3,$4) data`, params);
  return { data: r.rows[0].data, error: null };
});
const api = { rpc } as unknown as FoundationAuthenticatedApi;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema private;create schema internal;create schema api;
    create role anon;create role authenticated;create role service_role;
    create function internal.price_draft_actor() returns uuid language plpgsql as $$begin if current_setting('test.active',true)<>'yes' then raise insufficient_privilege;end if;return '${owner}'::uuid;end$$;
    create table private.posts(id uuid primary key,owner_id uuid,kind text,area text,title text);
    create table private.enquiries(id uuid primary key,post_id uuid,owner_id uuid,buyer_name text,buyer_email text,buyer_phone text,email_confirmed boolean,message text,status text,created_at timestamptz,updated_at timestamptz);
    ${definition("internal.inbox_page_limit")}
    ${definition("internal.list_my_enquiries")}`);
  await db.exec(update);
}, 30000);
beforeEach(async () => {
  rpc.mockClear();
  await db.exec(
    `truncate private.posts,private.enquiries;select set_config('test.active','yes',false);`
  );
  const kinds = [
    ["listing", "market"],
    ["business", "business"],
    ["business", "tourism_events"],
    ["event", "tourism_events"],
  ];
  for (let n = 0; n < kinds.length; n++)
    await db.exec(`insert into private.posts values ('${id(n + 1)}','${owner}','${kinds[n][0]}','${kinds[n][1]}','Post ${n + 1}');
    insert into private.enquiries values ('${id(n + 11)}','${id(n + 1)}','${owner}','Buyer','buyer@example.invalid',null,true,'Please share more details','new','2026-11-03T12:00:0${n}Z','2026-11-03T12:00:0${n}Z');`);
});
afterAll(async () => db?.close());
it("produces the correct reply destination for Market, Business, Tourism and Events", async () => {
  const page = await readFoundationPresentedEnquiries(api, { limit: 50 });
  const links = new Map(page.items.map((row) => [row.post_id, restoredEnquiry(row).target_href]));
  expect(links.get(id(1))).toBe(`/listing/${id(1)}`);
  expect(links.get(id(2))).toBe(`/mzansi-business/${id(2)}`);
  expect(links.get(id(3))).toBe(`/tourism-events/${id(3)}`);
  expect(links.get(id(4))).toBe(`/tourism-events/${id(4)}`);
});
it("preserves the native cursor, count and old DTO contract", async () => {
  const first = await readFoundationPresentedEnquiries(api, { limit: 2 });
  expect(first.items).toHaveLength(2);
  expect(first.unread_count).toBe(4);
  expect(first.next_cursor).toBeTruthy();
  const next = await readFoundationPresentedEnquiries(api, {
    limit: 2,
    cursor: first.next_cursor!,
  });
  expect(new Set([...first.items, ...next.items].map((r) => r.id)).size).toBe(4);
  const legacy = await readFoundationEnquiries(api, { limit: 50 });
  expect(legacy.items[0]).not.toHaveProperty("post_area");
});
it("does not expose another account's enquiries or post metadata", async () => {
  await db.exec(`insert into private.posts values ('${id(100)}','${other}','business','business','Foreign private title');
    insert into private.enquiries values ('${id(101)}','${id(100)}','${other}','Other Buyer','other@example.invalid',null,true,'Other message','new',now(),now());`);
  expect((await readFoundationPresentedEnquiries(api, { limit: 50 })).items).toHaveLength(4);
  await db.exec(`update private.enquiries set post_id='${id(100)}' where id='${id(11)}'`);
  const r = await db.query<{ data: { items: Record<string, unknown>[] } }>(
    "select api.list_my_frontend_enquiries() data"
  );
  expect(JSON.stringify(r.rows[0].data)).not.toContain("Foreign private title");
  await expect(readFoundationPresentedEnquiries(api, { limit: 50 })).rejects.toThrow();
});
it("retains the authenticated audience and current-member guard", async () => {
  for (const role of ["anon", "service_role"]) {
    const r = await db.query<{ allowed: boolean }>(
      `select has_function_privilege('${role}','api.list_my_frontend_enquiries(integer,text,timestamptz,uuid)','execute') allowed`
    );
    expect(r.rows[0].allowed).toBe(false);
  }
  await db.exec("select set_config('test.active','no',false)");
  await expect(readFoundationPresentedEnquiries(api, { limit: 50 })).rejects.toThrow();
});
