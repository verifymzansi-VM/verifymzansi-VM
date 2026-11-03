/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { parseOwnerDashboard } from "./owner-dashboard";
const baseline = readFileSync("database/foundation/candidate.sql", "utf8");
const actor = [
  ...baseline.matchAll(
    /create(?: or replace)? function internal\.price_draft_actor\(\)[\s\S]*?\$\$;/g
  ),
].at(-1)![0];
const update = readFileSync(
  "database/foundation/updates/20261103180512_restored_owner_dashboard.sql",
  "utf8"
);
const repair = readFileSync(
  "database/foundation/updates/20261103183017_repair_dashboard_identity_lookup.sql",
  "utf8"
);
const identityHelper = [
  ...baseline.matchAll(
    /create(?: or replace)? function internal\.current_verified_identity\(\s*p_owner uuid\)[\s\S]*?\$\$;/g
  ),
].at(-1)![0];
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create schema private; create schema internal; create schema api;
    create role anon; create role authenticated; create role service_role;
    grant usage on schema api,internal,auth to authenticated,anon,service_role;
    create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table private.profiles(account_id uuid primary key,active boolean default true,legal_name_locked_at timestamptz);
    create view private.current_account_access as select p.account_id id from private.profiles p join auth.users u on u.id=p.account_id where p.active and u.email_confirmed_at is not null and not u.is_anonymous;
    ${actor}
    create table private.verification_phone_proofs(owner_id uuid,phone text,revoked_at timestamptz,contact_changed_at timestamptz,verified_at timestamptz);
    create table private.verification_localities(owner_id uuid,province_id text,city_id text,confirmed_at timestamptz);
    create table private.provinces(id text,label text); create table private.cities(id text,province_id text,label text);
    create table private.evidence_cases(id uuid,subject_id uuid,status text,version integer);
    create table private.verification_identity_submissions(id uuid,case_id uuid,case_version integer);
    create table private.accepted_identity_facts(id uuid,owner_id uuid,submission_id uuid,identity_hmac text,reviewed_at timestamptz,revoked_at timestamptz);
    create function internal.verification_evidence_reviewed(uuid) returns boolean language sql as $$select true$$;
    ${identityHelper}
    create function internal.get_my_verification_case() returns jsonb language sql as $$select jsonb_build_object(
      'case_id',null,'version',null,'verified',internal.current_verified_identity(auth.uid()) is not null,
      'phone_verified',exists(select 1 from private.verification_phone_proofs where owner_id=auth.uid() and revoked_at is null),
      'locality_confirmed',exists(select 1 from private.verification_localities where owner_id=auth.uid()),
      'submission_pending',false,'return_reason',null)$$;
    create table private.posts(id uuid primary key,owner_id uuid,kind text,area text,status text,edit_of uuid,title text,created_at timestamptz default now(),content_updated_at timestamptz default now(),visible_until timestamptz);
    create table private.event_details(post_id uuid,ends_at timestamptz);
    create table private.post_media(post_id uuid,object_id uuid,purpose text,position int);
    create table private.media_objects(id uuid,owner_id uuid,object_key text,state text,kind text);
    create table private.enquiries(id uuid,post_id uuid,owner_id uuid,status text,message text,buyer_name text,created_at timestamptz);
    create table private.notifications(id uuid,account_id uuid,read_at timestamptz);
    create table private.organisation_admins(organisation_id uuid,account_id uuid);
    create table private.payments(id uuid,snapshot jsonb);
    create table private.entitlements(id uuid,owner_id uuid,payment_id uuid,source text,status text,area text,slot_capacity int,starts_at timestamptz,ends_at timestamptz,created_at timestamptz default now());
    create table private.entitlement_members(entitlement_id uuid,member_id uuid);
    insert into private.provinces values ('gp','Gauteng'); insert into private.cities values ('jhb','gp','Johannesburg');
    `);
  await db.exec(update);
  await db.exec(repair);
}, 30000);
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users,auth.sessions,private.profiles,private.posts,private.event_details,private.post_media,private.media_objects,private.enquiries,private.notifications,private.organisation_admins,private.entitlements,private.payments,private.entitlement_members,private.verification_phone_proofs,private.verification_localities,private.accepted_identity_facts,private.evidence_cases,private.verification_identity_submissions;
    insert into auth.users(id,email_confirmed_at) values ('${owner}',now()),('${other}',now());
    insert into auth.sessions(id,user_id) values ('${session}','${owner}');
    insert into private.profiles(account_id) values ('${owner}'),('${other}');
    select set_config('request.jwt.claims','${JSON.stringify({ sub: owner, role: "authenticated", session_id: session })}',false);`);
});
afterAll(async () => db?.close());
async function read() {
  const r = await db.query<{ data: unknown }>("select api.get_my_dashboard() data");
  return parseOwnerDashboard(r.rows[0].data, owner);
}
it("counts only owned original posts and applies actual expiry/event windows", async () => {
  await db.exec(`insert into private.posts(id,owner_id,kind,area,status,visible_until) values
    ('${id(1)}','${owner}','listing','market','live',now()+interval '1 day'),
    ('${id(2)}','${owner}','listing','market','live',now()-interval '1 day'),
    ('${id(3)}','${owner}','listing','market','rejected',null),
    ('${id(4)}','${owner}','listing','market','pending_moderation',null),
    ('${id(5)}','${owner}','business','business','draft',null),
    ('${id(6)}','${owner}','business','tourism_events','draft',null),
    ('${id(7)}','${owner}','event','tourism_events','live',now()+interval '3 days'),
    ('${id(8)}','${owner}','event','tourism_events','live',now()+interval '3 days'),
    ('${id(9)}','${other}','listing','market','live',now()+interval '1 day'),
    ('${id(10)}','${owner}','listing','market','live',now()+interval '1 day');
    update private.posts set edit_of='${id(1)}' where id='${id(10)}';
    insert into private.event_details values ('${id(7)}',now()+interval '1 day'),('${id(8)}',now()-interval '1 day');
    set role authenticated;`);
  const result = await read();
  expect(result.counts).toEqual({
    active_listings: 1,
    active_events: 1,
    rejected_listings: 1,
    pending_listings: 1,
    expiring_listings: 1,
    expiring_events: 1,
    businesses: 1,
    tourism_businesses: 1,
  });
  expect(result.posts.map((p) => p.id)).not.toContain(id(9));
  expect(result.posts.map((p) => p.id)).not.toContain(id(10));
});
it("returns bounded own records, filters foreign media and exposes only actual verification facts", async () => {
  for (let n = 1; n <= 12; n++)
    await db.exec(
      `insert into private.posts(id,owner_id,kind,area,status,title,created_at,content_updated_at) values ('${id(n)}','${owner}','listing','market','draft','Own ${n}',now()+interval '${n} seconds',now()+interval '${n} seconds');`
    );
  await db.exec(`insert into private.media_objects values ('${id(100)}','${other}','media/${id(100)}','ready','image');
    insert into private.post_media values ('${id(12)}','${id(100)}','cover',0);
    insert into private.verification_phone_proofs values ('${owner}','+27820000000',null,now(),now());
    insert into private.verification_localities values ('${owner}','gp','jhb',now());
    insert into private.evidence_cases values ('${id(102)}','${owner}','decided',2);
    insert into private.verification_identity_submissions values ('${id(103)}','${id(102)}',1);
    insert into private.accepted_identity_facts values ('${id(101)}','${owner}','${id(103)}','synthetic-private-fingerprint',now(),null);
    set role authenticated;`);
  const result = await read();
  expect(result.posts).toHaveLength(10);
  expect(result.posts[0]).toMatchObject({ id: id(12), cover_object_key: null });
  expect(result.profile_facts).toMatchObject({
    location_province: "Gauteng",
    location_city: "Johannesburg",
  });
  expect(result.profile_facts.identity_reviewed_at).toBeTruthy();
  expect(result.verification).toMatchObject({
    verified: true,
    phone_verified: true,
    locality_confirmed: true,
  });
});
it("keeps enquiry and notification counts scoped and never resolves another owner's title", async () => {
  await db.exec(`insert into private.posts(id,owner_id,kind,area,status,title) values ('${id(1)}','${other}','listing','market','live','Private other title');
    insert into private.enquiries values ('${id(2)}','${id(1)}','${owner}','new','Own enquiry','Buyer',now()),('${id(3)}','${id(1)}','${other}','new','Other enquiry','Other buyer',now());
    insert into private.notifications values ('${id(4)}','${owner}',null),('${id(5)}','${owner}',now()),('${id(6)}','${other}',null);
    set role authenticated;`);
  const result = await read();
  expect(result.unread_leads).toBe(1);
  expect(result.unread_notifications).toBe(1);
  expect(result.recent_leads).toHaveLength(1);
  expect(result.recent_leads[0].title).toBeNull();
});
it("does not turn trials, future/revoked grants or another account's plans into a paid label", async () => {
  await db.exec(`insert into private.payments values ('${id(1)}','{"label":"Current 90 days","duration_days":90}'),('${id(2)}','{"label":"Other plan","duration_days":180}');
    insert into private.entitlements(id,owner_id,payment_id,source,status,area,slot_capacity,starts_at,ends_at) values
      ('${id(3)}','${owner}','${id(1)}','retail_paid','active','market',1,now()-interval '1 day',now()+interval '89 days'),
      ('${id(4)}','${other}','${id(2)}','retail_paid','active','business',1,now()-interval '1 day',now()+interval '179 days'),
      ('${id(5)}','${owner}',null,'intro_trial','active','business',1,now()-interval '1 day',now()+interval '1 day'),
      ('${id(6)}','${owner}','${id(2)}','retail_paid','active','business',1,now()+interval '1 day',now()+interval '180 days');
    set role authenticated;`);
  const result = await read();
  expect(result.paid_plans).toHaveLength(1);
  expect(result.paid_plans[0]).toMatchObject({ label: "Current 90 days", tier: "quarter" });
});
it.each(["session", "account", "confirmation", "anonymous"])(
  "rejects a stale or invalid %s before returning data",
  async (kind) => {
    if (kind === "session")
      await db.exec("update auth.sessions set not_after=now()-interval '1 second'");
    if (kind === "account") await db.exec("update private.profiles set active=false");
    if (kind === "confirmation") await db.exec("update auth.users set email_confirmed_at=null");
    if (kind === "anonymous")
      await db.exec(
        `select set_config('request.jwt.claims','${JSON.stringify({ sub: owner, role: "authenticated", session_id: session, is_anonymous: true })}',false)`
      );
    await db.exec("set role authenticated");
    await expect(read()).rejects.toThrow();
  }
);
it("keeps the API function private to authenticated callers and supports repeat SQL application", async () => {
  await db.exec(update);
  await db.exec(repair);
  for (const role of ["anon", "service_role"]) {
    const r = await db.query<{ allowed: boolean }>(
      `select has_function_privilege('${role}','api.get_my_dashboard()','execute') allowed`
    );
    expect(r.rows[0].allowed).toBe(false);
  }
  const r = await db.query<{ args: number }>(
    "select pronargs args from pg_proc where oid='api.get_my_dashboard()'::regprocedure"
  );
  expect(r.rows[0].args).toBe(0);
});
it("reproduces the original fingerprint/UUID error and repairs the real helper contract", async () => {
  await db.exec(update);
  await expect(read()).rejects.toThrow(/uuid = text/);
  await db.exec(repair);
  expect((await read()).account_id).toBe(owner);
  await db.exec(repair);
});
