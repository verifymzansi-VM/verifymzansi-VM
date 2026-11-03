/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
const baseline = readFileSync("database/foundation/candidate.sql", "utf8");
const definition = (name: string) =>
  [
    ...baseline.matchAll(
      /create(?: or replace)? function (internal\.[a-z_]+)\([^$]*?as \$\$[\s\S]*?\$\$;/g
    ),
  ]
    .filter((m) => m[1] === name)
    .at(-1)![0];
const sql = readFileSync(
  "database/foundation/updates/20261103182231_restored_profile_update.sql",
  "utf8"
);
const owner = "11111111-1111-4111-8111-111111111111";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema private;create schema internal;create schema api;
    create role anon;create role authenticated;create role service_role; grant usage on schema api,internal to authenticated;
    create table private.profiles(account_id uuid primary key,revision integer default 1,display_name text,bio text,updated_at timestamptz default now(),legal_name_locked_at timestamptz);
    create table private.cities(id text,province_id text); insert into private.cities values ('jhb','gp'),('pta','gp');
    create table private.verification_localities(owner_id uuid primary key,province_id text,city_id text,confirmed_at timestamptz default now());
    create function internal.price_draft_actor() returns uuid language plpgsql as $$begin
      if current_setting('test.active',true)='no' then raise insufficient_privilege;end if;
      return '${owner}'::uuid;end$$;
    create function internal.lock_verification_subject(uuid) returns void language sql as $$select$$;
    create function internal.person_name_valid(text) returns boolean language sql as $$select length($1) between 2 and 50$$;
    create function internal.person_name_reserved(text) returns boolean language sql as $$select lower($1)='admin'$$;
    create function internal.profile_bio_valid(text) returns boolean language sql as $$select length($1)<=300$$;
    create function internal.owner_profile_dto(p private.profiles) returns jsonb language sql as $$select to_jsonb(p)$$;
    ${definition("internal.lock_owner_profile")}
    ${definition("internal.save_my_profile")}
    ${definition("internal.confirm_verification_locality")}`);
  await db.exec(sql);
}, 30000);
beforeEach(async () => {
  await db.exec(`truncate private.profiles,private.verification_localities;
    select set_config('test.active','yes',false);
    insert into private.profiles(account_id,display_name,bio) values ('${owner}','Thando','Original bio');`);
});
afterAll(async () => db?.close());
async function save(
  revision: number,
  name: string | null,
  bio: string,
  province: string | null = null,
  city: string | null = null
) {
  return db.query("select api.save_my_frontend_profile($1,$2,$3,$4,$5)", [
    revision,
    name,
    bio,
    province,
    city,
  ]);
}
async function profile() {
  return (
    await db.query<{ display_name: string; bio: string; revision: number }>(
      "select display_name,bio,revision from private.profiles"
    )
  ).rows[0];
}
it("saves profile and canonical locality atomically through the native commands", async () => {
  await save(1, "Thando Dlamini", "New bio", "gp", "jhb");
  expect(await profile()).toMatchObject({
    display_name: "Thando Dlamini",
    bio: "New bio",
    revision: 2,
  });
  expect((await db.query("select city_id from private.verification_localities")).rows).toEqual([
    { city_id: "jhb" },
  ]);
});
it("rolls back name and bio if a confirmed locality rejects the change", async () => {
  await db.exec(`insert into private.verification_localities values ('${owner}','gp','jhb',now())`);
  await expect(save(1, "Changed Name", "Changed bio", "gp", "pta")).rejects.toThrow();
  expect(await profile()).toEqual({ display_name: "Thando", bio: "Original bio", revision: 1 });
});
it("fences stale revisions and advances revision for a locality-only save", async () => {
  await save(1, "Thando", "Original bio", "gp", "jhb");
  expect((await profile()).revision).toBe(2);
  await expect(save(1, "Stale Name", "Stale bio")).rejects.toThrow();
  await save(2, "Thando", "Original bio", "gp", "jhb");
  expect((await profile()).revision).toBe(2);
});
it("keeps verified name locks and native reserved-name checks", async () => {
  await db.exec("update private.profiles set legal_name_locked_at=now()");
  await expect(save(1, "Changed Name", "New bio")).rejects.toThrow();
  await save(1, null, "Allowed bio");
  expect(await profile()).toMatchObject({ display_name: "Thando", bio: "Allowed bio" });
  await db.exec("update private.profiles set legal_name_locked_at=null");
  await expect(save(2, "admin", "Not saved")).rejects.toThrow();
});
it("rejects inactive callers and malformed location pairs without writes", async () => {
  await expect(save(1, "Changed Name", "New bio", "gp", null)).rejects.toThrow();
  await db.exec("select set_config('test.active','no',false)");
  await expect(save(1, "Changed Name", "New bio")).rejects.toThrow();
  expect((await profile()).revision).toBe(1);
});
it("does not expose the command to public/service callers or accept a caller-selected subject", async () => {
  for (const role of ["anon", "service_role"]) {
    const r = await db.query<{ allowed: boolean }>(
      `select has_function_privilege('${role}','api.save_my_frontend_profile(integer,text,text,text,text)','execute') allowed`
    );
    expect(r.rows[0].allowed).toBe(false);
  }
  const r = await db.query<{ names: string[] }>(
    "select proargnames names from pg_proc where oid='api.save_my_frontend_profile(integer,text,text,text,text)'::regprocedure"
  );
  expect(r.rows[0].names).not.toContain("p_user");
});
