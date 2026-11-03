/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
const update = readFileSync(
  "database/foundation/updates/20261103154538_owner_signup_access.sql",
  "utf8"
);
let db: PGlite;
// The original body hash was checked against the hosted hook. Start this
// replay from the accepted upgraded body to keep operator addresses private.
const acceptedBody = update.match(/\$body\$([\s\S]*?)\$body\$/)![1];
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema private; create schema internal;
    create role supabase_auth_admin; create role anon; create role authenticated; create role service_role;
    grant usage on schema internal to supabase_auth_admin;
    create table private.owner_admin_invitations(email text,revoked_at timestamptz);
    alter table private.owner_admin_invitations enable row level security;
    insert into private.owner_admin_invitations values ('first@example.invalid',null),('second@example.invalid',null),('revoked@example.invalid',now());
    create function internal.acceptance_signup_guard(p_event jsonb) returns jsonb language sql immutable set search_path=pg_catalog
    as $fixture$${acceptedBody}$fixture$;
  `);
  await db.exec(update);
}, 30000);
afterAll(async () => db?.close());
it("allows both invited addresses through the actual Auth role, including Google events", async () => {
  await db.exec("set role supabase_auth_admin");
  for (const email of ["first@example.invalid", "SECOND@example.invalid"]) {
    const r = await db.query<{ result: unknown }>(
      "select internal.acceptance_signup_guard($1::jsonb) result",
      [JSON.stringify({ user: { email, app_metadata: { provider: "google" } } })]
    );
    expect(r.rows[0].result).toEqual({});
  }
  await db.exec("reset role");
});
it("still refuses other/revoked/malformed applicants and metadata role claims", async () => {
  await db.exec("set role supabase_auth_admin");
  for (const event of [
    { user: { email: "other@example.invalid", user_metadata: { role: "admin" } } },
    { user: { email: "revoked@example.invalid" } },
    {},
    { user: { email: null } },
  ]) {
    const r = await db.query<{ result: unknown }>(
      "select internal.acceptance_signup_guard($1::jsonb) result",
      [JSON.stringify(event)]
    );
    expect(r.rows[0].result).toMatchObject({ error: { http_code: 403 } });
  }
  await db.exec("reset role");
});
it("keeps the hook invoker-only and unavailable to browsers and service callers", async () => {
  await db.exec(update);
  const r = await db.query<{ definer: boolean }>(
    "select prosecdef definer from pg_proc where oid='internal.acceptance_signup_guard(jsonb)'::regprocedure"
  );
  expect(r.rows[0].definer).toBe(false);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const row = await db.query<{ allowed: boolean }>(
      `select has_function_privilege('${role}','internal.acceptance_signup_guard(jsonb)','execute') allowed`
    );
    expect(row.rows[0].allowed).toBe(false);
  }
});
