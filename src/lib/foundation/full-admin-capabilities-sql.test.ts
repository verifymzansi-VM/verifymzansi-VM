/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
const source = readFileSync("database/foundation/candidate.sql", "utf8");
const actor = [
  ...source.matchAll(
    /create(?: or replace)? function internal.staff_actor\(p_capability text\)[\s\S]*?\$\$;/g
  ),
].at(-1)![0];
const migration = readFileSync(
  "database/foundation/updates/20261104001222_restore_full_admin_capabilities.sql",
  "utf8"
);
const owner = "11111111-1111-4111-8111-111111111111",
  session = "22222222-2222-4222-8222-222222222222";
const capabilities = [
  "case:claim",
  "queue:claim",
  "evidence:view",
  "verification:decide_routine",
  "post:moderate",
  "report:resolve",
];
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema private;create schema auth;create schema internal;
    create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims')::jsonb$$;
    create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
    create table auth.sessions(id uuid,user_id uuid,aal text,not_after timestamptz);
    create table auth.mfa_factors(user_id uuid,factor_type text,status text);
    create table private.profiles(id uuid,active boolean);
    create view private.current_account_access as select id from private.profiles where active;
    create table private.staff_roles(user_id uuid,role text,revoked_at timestamptz);
    create table private.staff_capabilities(role text,capability text,requires_recent_mfa boolean,primary key(role,capability));
    ${actor}`);
  await db.exec(migration);
}, 30000);
beforeEach(async () => {
  await db.exec(`truncate auth.sessions,auth.mfa_factors,private.profiles,private.staff_roles;
    insert into auth.sessions values ('${session}','${owner}','aal2',null);
    insert into auth.mfa_factors values ('${owner}','totp','verified');
    insert into private.profiles values ('${owner}',true);
    insert into private.staff_roles values ('${owner}','admin',null);`);
  await claims(0);
});
afterAll(async () => db?.close());
async function claims(minutes: number, aal = "aal2") {
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: owner,
      role: "authenticated",
      session_id: session,
      aal,
      amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) - minutes * 60 }],
    }),
  ]);
}
it("grants each native routine capability to a currently authenticated full administrator", async () => {
  for (const cap of capabilities)
    expect(
      (await db.query<{ actor: string }>("select internal.staff_actor($1) actor", [cap])).rows[0]
        .actor
    ).toBe(owner);
  await db.exec(migration);
  expect(
    (await db.query<{ n: number }>("select count(*)::int n from private.staff_capabilities"))
      .rows[0].n
  ).toBe(6);
});
it("keeps recent authenticator verification mandatory for evidence and decisions", async () => {
  await claims(16);
  expect(
    (await db.query<{ actor: string }>("select internal.staff_actor('queue:claim') actor")).rows[0]
      .actor
  ).toBe(owner);
  for (const cap of capabilities.slice(2))
    await expect(db.query("select internal.staff_actor($1)", [cap])).rejects.toThrow(
      "recent second-factor"
    );
  await claims(0, "aal1");
  await expect(db.query("select internal.staff_actor('queue:claim')")).rejects.toThrow(
    "second factor"
  );
});
it("does not authorize a removed role, logged-out session, suspended account or missing authenticator", async () => {
  await db.exec("update private.staff_roles set revoked_at=now()");
  await expect(db.query("select internal.staff_actor('case:claim')")).rejects.toThrow(
    "not granted"
  );
  await db.exec("update private.staff_roles set revoked_at=null;delete from auth.sessions");
  await expect(db.query("select internal.staff_actor('case:claim')")).rejects.toThrow(
    "live staff session"
  );
  await db.exec(
    `insert into auth.sessions values ('${session}','${owner}','aal2',null);update private.profiles set active=false`
  );
  await expect(db.query("select internal.staff_actor('case:claim')")).rejects.toThrow("suspended");
  await db.exec("update private.profiles set active=true;delete from auth.mfa_factors");
  await expect(db.query("select internal.staff_actor('case:claim')")).rejects.toThrow(
    "verified authenticator"
  );
});
