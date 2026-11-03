/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, it } from "vitest";
const source = readFileSync("database/foundation/candidate.sql", "utf8");
const def = (name: string) =>
  [
    ...source.matchAll(
      /create(?: or replace)? function (internal\.[a-z_]+)\([^$]*?as \$\$[\s\S]*?\$\$;/g
    ),
  ]
    .filter((m) => m[1] === name)
    .at(-1)![0];
const repair = readFileSync(
  "database/foundation/updates/20261028213020_repair_verified_runtime_contracts.sql",
  "utf8"
);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema private;create schema internal;
    create table private.plan_versions(id uuid,plan_code text,label text,area text,price_cents bigint,currency text,duration_days int,activation_period_days int,activations_per_period int,slot_capacity int,max_photos int,max_videos int,addon_capabilities text[],is_public boolean,retired_at timestamptz);
    create table private.addon_versions(id uuid,kind text,days int,price_cents bigint,currency text,retired_at timestamptz);
    create table private.evidence_cases(id uuid primary key,version int);
    create table private.evidence_artifacts(id uuid primary key,owner_id uuid,case_id uuid,object_key text,state text,created_at timestamptz,retain_until timestamptz,cleanup_token uuid,cleanup_lease_until timestamptz,content_sha256 text);
    create table private.legal_holds(subject_id uuid,released_at timestamptz);
    create function internal.evidence_fraud_held(uuid) returns boolean language sql as $$select false$$;
    create function internal.advance_evidence_artifact(p_id uuid,p_state text,p_sha text,p_size int) returns jsonb language plpgsql as $$begin
      update private.evidence_artifacts set state=p_state where id=p_id;
      update private.evidence_cases set version=version+1 where id=(select case_id from private.evidence_artifacts where id=p_id);
      return jsonb_build_object('artifact_id',p_id,'state',p_state);end$$;
    ${def("internal.billing_catalogue")}
    ${def("internal.complete_evidence_upload")}
    ${def("internal.claim_evidence_cleanup")}`);
  await db.exec(repair);
}, 30000);
afterAll(async () => db?.close());
it("returns activation limits from actual public plan rows and preserves canonical cents", async () => {
  await db.exec(
    `insert into private.plan_versions values ('${id(1)}','market_30d','Mzansi Market','market',5000,'ZAR',30,30,2,1,10,1,'{}',true,null),('${id(2)}','retired','Retired','market',100,'ZAR',30,30,1,1,1,0,'{}',true,now());`
  );
  const r = await db.query<{ v: { plans: Record<string, unknown>[] } }>(
    "select internal.billing_catalogue() v"
  );
  expect(r.rows[0].v.plans).toHaveLength(1);
  expect(r.rows[0].v.plans[0]).toMatchObject({
    activation_period_days: 30,
    activations_per_period: 2,
    price_cents: "5000",
  });
});
it("returns the revision after both artifact transitions and rolls back a changed content receipt", async () => {
  await db.exec(`insert into private.evidence_cases values ('${id(3)}',1);
    insert into private.evidence_artifacts(id,case_id,state) values ('${id(4)}','${id(3)}','intent');`);
  const r = await db.query<{ v: { case_version: number } }>(
    "select internal.complete_evidence_upload($1,$2,$3,128) v",
    [id(4), "a".repeat(64), "b".repeat(64)]
  );
  expect(r.rows[0].v.case_version).toBe(3);
  await expect(
    db.query("select internal.complete_evidence_upload($1,$2,$3,128)", [
      id(4),
      "a".repeat(64),
      "c".repeat(64),
    ])
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ version: number }>(
        "select version from private.evidence_cases where id=$1",
        [id(3)]
      )
    ).rows[0].version
  ).toBe(3);
});
it("does not let a held prefix starve expired partial uploads with no explicit retention timestamp", async () => {
  await db.exec(`insert into private.evidence_cases values ('${id(5)}',1),('${id(6)}',1);
    insert into private.legal_holds values ('${id(10)}',null);`);
  for (let n = 20; n < 24; n++)
    await db.exec(
      `insert into private.evidence_artifacts(id,owner_id,case_id,object_key,state,created_at,retain_until) values ('${id(n)}','${id(10)}','${id(5)}','held-${n}','clean',now()-interval '91 days',now()-interval '1 day');`
    );
  await db.exec(
    `insert into private.evidence_artifacts(id,owner_id,case_id,object_key,state,created_at) values ('${id(24)}','${id(11)}','${id(6)}','unheld','clean',now()-interval '91 days');`
  );
  const r = await db.query<{ v: { artifact_id: string }[] }>(
    "select internal.claim_evidence_cleanup(4) v"
  );
  expect(r.rows[0].v.map((x) => x.artifact_id)).toEqual([id(24)]);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from private.evidence_artifacts where object_key like 'held-%' and state='clean'"
      )
    ).rows[0].n
  ).toBe(4);
});
it("accepts reviewed repeat application but refuses unknown function drift", async () => {
  await db.exec(repair);
  await db.exec(
    "create or replace function internal.billing_catalogue() returns jsonb language sql as $$select '{}'::jsonb$$"
  );
  await expect(db.exec(repair)).rejects.toThrow(/Unexpected foundation function/);
  await db.exec("rollback");
});
