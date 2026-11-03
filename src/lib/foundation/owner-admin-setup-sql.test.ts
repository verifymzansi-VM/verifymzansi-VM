/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

const baseline = readFileSync("database/foundation/candidate.sql", "utf8");
const update = readFileSync(
  "database/foundation/updates/20261103152035_owner_admin_setup.sql",
  "utf8"
);
const context = baseline.match(
  /create function internal\.get_my_account_context\(\)[\s\S]*?\$\$;/
)![0];
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth; create schema private; create schema internal;
    create role anon; create role authenticated; create role service_role;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false);
    create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),factor_type text,status text);
    create table private.profiles(account_id uuid primary key,active boolean default true);
    create view private.current_account_access as select account_id id from private.profiles where active;
    create table private.verification_phone_proofs(owner_id uuid,phone text,revoked_at timestamptz);
    create table private.staff_roles(id uuid default gen_random_uuid(),user_id uuid unique,role text,revoked_at timestamptz);
    create table private.staff_capabilities(role text,capability text);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function internal.get_my_profile() returns jsonb language plpgsql as $$begin
      if not exists(select 1 from private.current_account_access where id=auth.uid()) then
        raise insufficient_privilege; end if; return '{}'::jsonb; end$$;
    create function internal.staff_actor(text) returns uuid language plpgsql as $$begin raise insufficient_privilege; end$$;
    ${context}
  `);
  await db.exec(update);
}, 30000);
beforeEach(async () => {
  await db.exec(`truncate private.owner_admin_invitations,private.staff_roles,auth.mfa_factors,private.profiles,auth.users cascade;
    insert into auth.users(id,email,email_confirmed_at) values ('${owner}','owner@example.invalid',now()),('${other}','other@example.invalid',now());
    insert into private.profiles(account_id) values ('${owner}'),('${other}');
    insert into private.owner_admin_invitations(email) values ('owner@example.invalid');
    select set_config('request.jwt.claim.sub','${owner}',false);`);
});
afterAll(async () => db?.close());
async function value(sql: string) {
  return (await db.query<{ result: unknown }>(sql)).rows[0]?.result;
}
it("offers only authenticator setup and grants no role before verified TOTP", async () => {
  const hint = await value("select internal.get_my_account_context()->'staff' result");
  expect(hint).toEqual({ role: "admin", can_access: false, assigned_capabilities: [] });
  expect(await value("select count(*)::int result from private.staff_roles")).toBe(0);
  await db.exec(
    `insert into auth.mfa_factors(user_id,factor_type,status) values ('${owner}','totp','unverified'),('${owner}','phone','verified');`
  );
  expect(await value("select count(*)::int result from private.staff_roles")).toBe(0);
  await db.exec(
    `update auth.mfa_factors set status='verified' where user_id='${owner}' and factor_type='totp';`
  );
  expect(await value("select role result from private.staff_roles")).toBe("admin");
  expect(await value(`select claimed_by::text result from private.owner_admin_invitations`)).toBe(
    owner
  );
});
it("does not grant access to other, unconfirmed, suspended or revoked-invitation accounts", async () => {
  await db.exec(`insert into auth.mfa_factors(user_id,factor_type,status) values ('${other}','totp','verified');
    update auth.users set email_confirmed_at=null where id='${owner}';
    insert into auth.mfa_factors(user_id,factor_type,status) values ('${owner}','totp','verified');`);
  expect(await value("select count(*)::int result from private.staff_roles")).toBe(0);
  await db.exec(`update auth.users set email_confirmed_at=now(); update private.profiles set active=false;
    update auth.mfa_factors set status='verified';`);
  expect(await value("select count(*)::int result from private.staff_roles")).toBe(0);
  await db.exec(`update private.profiles set active=true; update private.owner_admin_invitations set revoked_at=now();
    update auth.mfa_factors set status='verified';`);
  expect(await value("select count(*)::int result from private.staff_roles")).toBe(0);
  expect(await value("select internal.get_my_account_context()->'staff' result")).toBeNull();
});
it("never reactivates a previously assigned role or consumes an invitation twice", async () => {
  await db.exec(`insert into private.staff_roles(user_id,role,revoked_at) values ('${owner}','moderator',now());
    insert into auth.mfa_factors(user_id,factor_type,status) values ('${owner}','totp','verified');`);
  expect(await value("select role result from private.staff_roles")).toBe("moderator");
  expect(await value("select claimed_by result from private.owner_admin_invitations")).toBeNull();
});
it("keeps invitation and trigger access private and supports repeat application", async () => {
  await db.exec(update);
  for (const role of ["anon", "authenticated", "service_role"]) {
    expect(
      await value(
        `select has_table_privilege('${role}','private.owner_admin_invitations','select') result`
      )
    ).toBe(false);
    expect(
      await value(
        `select has_function_privilege('${role}','internal.claim_owner_admin_invitation()','execute') result`
      )
    ).toBe(false);
  }
  expect(
    await value(
      "select relrowsecurity result from pg_class where oid='private.owner_admin_invitations'::regclass"
    )
  ).toBe(true);
});
