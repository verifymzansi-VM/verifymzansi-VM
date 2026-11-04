/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
const baseline = readFileSync("database/foundation/candidate.sql", "utf8").replace(/\r\n/g, "\n");
const definitions = (name: string) =>
  [
    ...baseline.matchAll(
      /create(?: or replace)? function (internal\.[a-z_]+)\([^$]*?as \$\$[\s\S]*?\$\$;/g
    ),
  ]
    .filter((m) => m[1] === name)
    .at(-1)![0];
const update = readFileSync(
  "database/foundation/updates/20261104000046_restored_verification_transport.sql",
  "utf8"
);
const repair = readFileSync(
  "database/foundation/updates/20261028213020_repair_verified_runtime_contracts.sql",
  "utf8"
).match(/create or replace function internal.complete_evidence_upload[\s\S]*?\$\$;/)![0];
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const owner = id(1),
  other = id(2),
  session = id(3),
  digest = "d".repeat(64),
  fingerprint = "a".repeat(42) + "A";
const identity = {
  fingerprint,
  encrypted_number: {
    ciphertext: "a".repeat(26),
    iv: "b".repeat(24),
    tag: "c".repeat(32),
    key_id: "identity-number-v1",
  },
};
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema private;create schema internal;create schema api;create schema auth;
    create role anon;create role authenticated;create role service_role;
    grant usage on schema api,internal,auth to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
    create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table private.profiles(account_id uuid primary key,active boolean default true,revision int default 1,legal_first_name text,legal_last_name text,legal_name_locked_at timestamptz,updated_at timestamptz);
    create view private.current_account_access as select account_id id from private.profiles where active;
    create table private.evidence_cases(id uuid primary key default gen_random_uuid(),subject_id uuid,kind text,status text default 'open',version int default 1,created_at timestamptz default now(),unique(id,subject_id));
    create table private.evidence_artifacts(id uuid primary key default gen_random_uuid(),owner_id uuid,case_id uuid,purpose text,object_key text,state text default 'intent',sha256 text,content_sha256 text,size_bytes int,created_at timestamptz default now(),state_changed_at timestamptz default now(),retain_until timestamptz,deleted_at timestamptz);
    create table private.account_closures(user_id uuid);
    create table private.decisions(case_id uuid,status text,action text,payload jsonb);
    create table private.legal_holds(subject_id uuid,released_at timestamptz);
    create table private.verification_phone_proofs(owner_id uuid,revoked_at timestamptz);
    create table private.verification_localities(owner_id uuid);
    create table private.verification_return_requests(id uuid,case_id uuid,case_version int,reason text,created_at timestamptz);
    create table private.verification_identity_submissions(id uuid primary key default gen_random_uuid(),case_id uuid,owner_id uuid,case_version int,id_artifact_id uuid,selfie_artifact_id uuid,identity_hmac text,identity_key_id text,number_ciphertext text,number_iv text,number_tag text,encryption_key_id text,receipt_id uuid unique,recipe text,risk_score int);
    create table private.verification_current_submissions(case_id uuid primary key,submission_id uuid);
    create table private.accepted_identity_facts(owner_id uuid,submission_id uuid,reviewed_at timestamptz,id uuid,revoked_at timestamptz);
    create function internal.current_verified_identity(uuid) returns text language sql as $$select case when exists(select 1 from private.accepted_identity_facts f where f.owner_id=$1 and f.revoked_at is null) then 'not-a-uuid-fingerprint' end$$;
    create function internal.person_name_valid(text) returns boolean language sql as $$select $1 is not null and length($1) between 2 and 50$$;
    create function internal.owner_profile_dto(private.profiles) returns jsonb language sql as $$select '{}'::jsonb$$;
    ${["price_draft_actor", "lock_evidence_subject", "lock_verification_subject", "lock_owner_profile", "save_my_legal_name", "open_verification_case", "begin_evidence_upload", "advance_evidence_artifact", "verification_artifacts_ready", "register_identity_submission", "get_my_verification_case", "evidence_artifact_submission_guard", "evidence_artifact_transition_guard"].map((n) => definitions("internal." + n)).join("\n")}
    ${repair}
    create trigger evidence_artifact_submission before insert or update or delete on private.evidence_artifacts for each row execute function internal.evidence_artifact_submission_guard();
    create trigger evidence_artifact_transition before update on private.evidence_artifacts for each row execute function internal.evidence_artifact_transition_guard();
  `);
  await db.exec(update);
}, 30000);
beforeEach(async () => {
  await db.exec(`reset role;truncate auth.users,auth.sessions,private.profiles,private.frontend_verification_uploads,private.evidence_cases,private.evidence_artifacts,private.verification_identity_submissions,private.verification_current_submissions,private.accepted_identity_facts,private.verification_return_requests,private.decisions cascade;
    insert into auth.users values ('${owner}'),('${other}');insert into auth.sessions values ('${session}','${owner}',null);
    insert into private.profiles(account_id) values ('${owner}'),('${other}');
    select set_config('request.jwt.claims','${JSON.stringify({ sub: owner, role: "authenticated", session_id: session })}',false);`);
});
afterAll(async () => db?.close());
async function reserve(n: number, purpose = "id_front", d = digest) {
  return (
    await db.query<{ v: { artifact_id: string; completed: boolean } }>(
      "select api.reserve_frontend_verification_upload($1,$2,$3,$4,$5) v",
      [
        id(n),
        purpose,
        d,
        purpose === "id_front" ? "Fixture" : null,
        purpose === "id_front" ? "Owner" : null,
      ]
    )
  ).rows[0].v;
}
async function complete(n: number, selfie = false, receipt: unknown = identity) {
  return (
    await db.query<{ v: { artifact_id: string; completed: boolean } }>(
      "select api.complete_frontend_verification_upload($1,$2,$3,$4,128,$5,$6) v",
      [
        owner,
        id(n),
        "a".repeat(64),
        "b".repeat(64),
        selfie ? null : JSON.stringify(receipt),
        selfie ? 10 : null,
      ]
    )
  ).rows[0].v;
}
it("reserves exactly once, binds request content, and exposes neither evidence nor number to anonymous/browser service callers", async () => {
  const first = await reserve(10);
  expect(await reserve(10)).toEqual(first);
  await expect(reserve(10, "id_front", "e".repeat(64))).rejects.toThrow("changed");
  expect(
    (await db.query<{ n: number }>("select count(*)::int n from private.evidence_artifacts"))
      .rows[0].n
  ).toBe(1);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(
      db.query("select api.frontend_verification_upload_context($1,$2)", [owner, id(10)])
    ).rejects.toThrow("permission denied");
    await expect(db.query("select * from private.frontend_verification_uploads")).rejects.toThrow(
      "permission denied"
    );
    await db.exec("reset role");
  }
});
it("stages ID separately, registers the actual pair after selfie once, and erases the redundant encrypted number", async () => {
  const first = await reserve(10);
  await complete(10);
  const staged = (
    await db.query<{ v: unknown[] }>("select api.get_my_frontend_verification_uploads() v")
  ).rows[0].v;
  expect(staged).toHaveLength(1);
  expect(JSON.stringify(staged)).not.toContain(fingerprint);
  const second = await reserve(11, "selfie");
  await complete(11, true);
  await complete(11, true);
  const rows = (
    await db.query<{ id_artifact_id: string; selfie_artifact_id: string; case_version: number }>(
      "select * from private.verification_identity_submissions"
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id_artifact_id: first.artifact_id,
    selfie_artifact_id: second.artifact_id,
  });
  expect(
    (await db.query<{ version: number }>("select version from private.evidence_cases")).rows[0]
      .version
  ).toBe(rows[0].case_version);
  expect(
    (
      await db.query<{ encrypted_number: unknown }>(
        "select encrypted_number from private.frontend_verification_uploads where request_id=$1",
        [id(10)]
      )
    ).rows[0].encrypted_number
  ).toBeNull();
});
it("refuses selfie first, cross-owner receipts, revoked sessions and changed cases before committing clean evidence", async () => {
  await expect(reserve(11, "selfie")).rejects.toThrow("ID document first");
  await reserve(10);
  await expect(
    db.query("select api.frontend_verification_upload_context($1,$2)", [other, id(10)])
  ).rejects.toThrow("unavailable");
  await db.exec(`delete from auth.sessions where id='${session}'`);
  await expect(complete(10)).rejects.toThrow("expired");
  expect(
    (await db.query<{ state: string }>("select state from private.evidence_artifacts")).rows[0]
      .state
  ).toBe("intent");
  await db.exec(
    `insert into auth.sessions values ('${session}','${owner}',null);update private.evidence_cases set version=version+1`
  );
  await expect(complete(10)).rejects.toThrow("changed");
});
it("does not submit expired or malformed staged identity metadata, including JSON null fields", async () => {
  await reserve(10);
  await expect(
    complete(10, false, {
      ...identity,
      encrypted_number: { ...identity.encrypted_number, ciphertext: null },
    })
  ).rejects.toThrow("encrypted identity");
  await complete(10);
  await db.exec(
    "update private.frontend_verification_uploads set created_at=now()-interval '2 days',expires_at=now()-interval '1 day'"
  );
  await expect(reserve(11, "selfie")).rejects.toThrow("ID document first");
  expect(
    (await db.query<{ v: unknown[] }>("select api.get_my_frontend_verification_uploads() v"))
      .rows[0].v
  ).toEqual([]);
});
it("reads accepted identity status without attempting to cast its fingerprint into a UUID", async () => {
  await db.exec(
    `insert into private.accepted_identity_facts(owner_id,reviewed_at) values ('${owner}',now())`
  );
  const value = (
    await db.query<{ v: { verified: boolean } }>("select internal.get_my_verification_case() v")
  ).rows[0].v;
  expect(value.verified).toBe(true);
});
