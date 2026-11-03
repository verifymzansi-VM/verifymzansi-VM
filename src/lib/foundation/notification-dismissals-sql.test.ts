/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
const source = readFileSync("database/foundation/candidate.sql", "utf8");
const def = (name: string) =>
  [
    ...source.matchAll(
      /create(?: or replace)? function (internal\.[a-z_]+)\([^$]*?as \$\$[\s\S]*?\$\$;/g
    ),
  ]
    .filter((m) => m[1] === name)
    .at(-1)![0];
const sql = readFileSync(
  "database/foundation/updates/20261103231355_owner_notification_dismissals.sql",
  "utf8"
);
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema private;create schema internal;create schema api;
    create role anon;create role authenticated;create role service_role;
    create table private.notifications(id uuid primary key,account_id uuid,kind text,subject_id uuid,post_id uuid,organisation_id uuid,created_at timestamptz,read_at timestamptz,unique(kind,subject_id));
    create table private.posts(id uuid,title text);create table private.organisations(id uuid,name text,slug text);
    create function internal.price_draft_actor() returns uuid language plpgsql as $$begin if current_setting('test.active',true)<>'yes' then raise insufficient_privilege;end if;return '${owner}'::uuid;end$$;
    create function internal.signal_owner_inbox(uuid) returns void language sql as $$select$$;
    ${def("internal.inbox_page_limit")}
    ${def("internal.list_my_notifications")}
    ${def("internal.notification_guard")}
    create trigger guard before update on private.notifications for each row execute function internal.notification_guard();`);
  await db.exec(sql);
}, 30000);
beforeEach(async () => {
  await db.exec(`truncate private.notifications cascade;select set_config('test.active','yes',false);
    insert into private.notifications values ('${id(1)}','${owner}','enquiry_received','${id(11)}',null,null,now()-interval '1 minute',null),('${id(2)}','${owner}','enquiry_received','${id(12)}',null,null,now()-interval '2 minutes',null),('${id(3)}','${other}','enquiry_received','${id(13)}',null,null,now(),null);`);
});
afterAll(async () => db?.close());
async function list(unread = false) {
  return (
    await db.query<{ v: { items: { id: string }[]; unread_count: number } }>(
      "select api.list_my_frontend_notifications(1,$1) v",
      [unread]
    )
  ).rows[0].v;
}
it("filters unread notifications before limiting and scopes every row to the caller", async () => {
  await db.exec(`update private.notifications set read_at=now() where id='${id(1)}'`);
  expect((await list(true)).items.map((n) => n.id)).toEqual([id(2)]);
  expect((await list()).items.map((n) => n.id)).toEqual([id(1)]);
});
it("dismisses only owned rows, preserves delivery deduplication and updates the old native list", async () => {
  await db.query("select api.dismiss_my_notifications($1::uuid[])", [[id(1), id(3)]]);
  expect((await list()).items.map((n) => n.id)).toEqual([id(2)]);
  const legacy = await db.query<{ v: { items: { id: string }[] } }>(
    "select internal.list_my_notifications(null,null,50) v"
  );
  expect(legacy.rows[0].v.items.map((n) => n.id)).toEqual([id(2)]);
  expect(
    (await db.query<{ n: number }>("select count(*)::int n from private.notifications")).rows[0].n
  ).toBe(3);
  expect(
    (
      await db.query<{ v: string }>(
        "select read_at::text v from private.notifications where id=$1",
        [id(3)]
      )
    ).rows[0].v
  ).toBeNull();
  await expect(
    db.exec(
      `insert into private.notifications(id,kind,subject_id) values ('${id(8)}','enquiry_received','${id(11)}')`
    )
  ).rejects.toThrow();
});
it("clears all owned rows idempotently and lets retention remove dismissal records with their parent", async () => {
  await db.exec("select api.dismiss_my_notifications()");
  expect((await list()).items).toEqual([]);
  const again = await db.query<{ v: { dismissed: number } }>(
    "select api.dismiss_my_notifications() v"
  );
  expect(again.rows[0].v.dismissed).toBe(0);
  await db.exec(`delete from private.notifications where account_id='${owner}'`);
  expect(
    (await db.query<{ n: number }>("select count(*)::int n from private.notification_dismissals"))
      .rows[0].n
  ).toBe(0);
});
it("refuses malformed IDs and inactive callers, and exposes neither the table nor commands to anonymous/service roles", async () => {
  await expect(db.query("select api.dismiss_my_notifications($1::uuid[])", [[]])).rejects.toThrow();
  await db.exec("select set_config('test.active','no',false)");
  await expect(list()).rejects.toThrow();
  for (const role of ["anon", "service_role"]) {
    const r = await db.query<{ ok: boolean }>(
      `select has_function_privilege('${role}','api.dismiss_my_notifications(uuid[])','execute') ok`
    );
    expect(r.rows[0].ok).toBe(false);
  }
  expect(
    (
      await db.query<{ ok: boolean }>(
        "select has_table_privilege('authenticated','private.notification_dismissals','select') ok"
      )
    ).rows[0].ok
  ).toBe(false);
});
