/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
const source = readFileSync("database/foundation/candidate.sql", "utf8");
const dashboard = source.match(
  /create function internal\.staff_dashboard_overview\(\)[\s\S]*?\$\$;/
)![0];
const update = readFileSync(
  "database/foundation/updates/20261103152812_restored_staff_dashboard.sql",
  "utf8"
);
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema private; create schema internal;
    create role anon; create role authenticated; create role service_role;
    create table private.staff_roles(user_id uuid,role text,revoked_at timestamptz);
    create table private.reports(id int,status text,severity text,created_at timestamptz);
    create table private.posts(id int,status text,submitted_at timestamptz);
    create table private.queue_claims(post_id int,report_id int,claimed_by uuid,claim_expires_at timestamptz);
    create table private.evidence_cases(id int,kind text,status text,claimed_by uuid,claim_expires_at timestamptz,created_at timestamptz);
    create table private.verification_current_submissions(submission_id int);
    create table private.verification_identity_submissions(id int,case_id int,risk_score int);
    create table private.decisions(status text); create table private.outbox_events(processed_at timestamptz);
    create table private.cost_alarms(acknowledged_at timestamptz);
    create function internal.staff_actor(text) returns uuid language plpgsql as $$begin
      if current_setting('test.staff',true) is distinct from 'ready' then raise insufficient_privilege; end if;
      return '11111111-1111-4111-8111-111111111111'::uuid; end$$;
    insert into private.staff_roles values ('11111111-1111-4111-8111-111111111111','admin',null);
    ${dashboard}`);
  await db.exec(update);
}, 30000);
afterAll(async () => db?.close());
it("computes real queue counts, deadlines, current risks and live claims", async () => {
  await db.exec(`select set_config('test.staff','ready',false);
    insert into private.reports values (1,'open','high',now()-interval '5 hours'),(2,'open','standard',now()-interval '5 hours'),(3,'resolved','high',now()-interval '2 days');
    insert into private.posts values (1,'pending_moderation',now()-interval '1 hour'),(2,'live',now());
    insert into private.queue_claims values (1,null,null,now()+interval '1 hour'),(null,1,null,now()-interval '1 hour');
    insert into private.evidence_cases values (1,'kyc','open',null,null,now()),(2,'kyc','open',null,now()+interval '1 hour',now()),(3,'business','open',null,null,now()-interval '2 days');
    insert into private.verification_identity_submissions values (1,1,51),(2,2,50),(3,2,99);
    insert into private.verification_current_submissions values (1),(2);`);
  const result = await db.query<{
    data: { restored_queues: Record<string, unknown>; counts: { reports: number } };
  }>("select internal.staff_dashboard_overview() data");
  expect(result.rows[0].data.restored_queues).toMatchObject({
    reports: { open: 2, breached: 1, claimed: 0 },
    content: { pending: 1, claimed: 1 },
    kyc: { pending: 2, high_risk: 1, claimed: 1 },
    business_kyc: { pending: 1, breached: 1, claimed: 0 },
    support: null,
  });
  expect(result.rows[0].data.counts.reports).toBe(2);
});
it("refuses an unready caller and preserves the private helper boundary", async () => {
  await db.exec("select set_config('test.staff','unready',false)");
  await expect(db.query("select internal.staff_dashboard_overview()")).rejects.toThrow();
  for (const role of ["anon", "authenticated", "service_role"]) {
    const r = await db.query<{ allowed: boolean }>(
      `select has_function_privilege('${role}','internal.restored_staff_queues()','execute') allowed`
    );
    expect(r.rows[0].allowed).toBe(false);
  }
});
it("accepts repeat application without widening the API surface", async () => {
  await db.exec(update);
  const r = await db.query<{ count: number }>(
    "select count(*)::int count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api'"
  );
  expect(r.rows[0].count).toBe(0);
});
