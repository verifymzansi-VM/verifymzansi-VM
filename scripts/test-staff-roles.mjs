// Isolated PostgreSQL checks for the staff role authority migrations.
// PGlite only: no environment loading, sockets or remote database.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

process.on("uncaughtException", (error) => {
  console.error(error.message, error.where ?? "");
  process.exit(1);
});

const read = (file) => fs.readFileSync(`supabase/migrations/${file}`, "utf8");
const initial = read("20240101000000_initial_schema.sql");
const definition = (pattern) => {
  const match = initial.match(pattern);
  assert(match, `Missing schema definition ${pattern}`);
  return match[0];
};

const db = new PGlite();

// ── Supabase-like environment, with the pre-migration (JWT) role helpers ──
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_app_meta_data jsonb DEFAULT '{}', email text);
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
${definition(/CREATE TYPE user_role AS ENUM \([\s\S]*?;/)}
${definition(/CREATE TYPE listing_status AS ENUM \([\s\S]*?;/)}
${definition(/CREATE TYPE marketplace_area AS ENUM \([\s\S]*?;/)}
${definition(/CREATE TYPE report_status AS ENUM \([\s\S]*?;/)}
CREATE FUNCTION public.has_role(required_role text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = required_role, false) $$;
CREATE FUNCTION public.has_any_role(roles text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = ANY(roles), false) $$;
CREATE TABLE public.account_profiles(user_id uuid PRIMARY KEY, account_status text NOT NULL DEFAULT 'active');
CREATE TABLE public.listings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, title text, status text DEFAULT 'live');
CREATE TABLE public.reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text DEFAULT 'open');
CREATE TABLE public.verification_steps(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text DEFAULT 'pending');
CREATE TABLE public.moderation_actions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action text);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['listings','reports','verification_steps','moderation_actions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
  END LOOP;
END $$;
-- Policies exactly as the initial schema and later migrations wrote them.
CREATE POLICY "Public reads live listings" ON listings FOR SELECT USING (status = 'live' OR auth.uid() = owner_id OR public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner or moderator updates listing" ON listings FOR UPDATE USING (auth.uid() = owner_id OR public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Owner or admin deletes listing" ON listings FOR DELETE USING (auth.uid() = owner_id OR public.has_role('admin'));
CREATE POLICY "Staff reads reports" ON reports FOR SELECT USING (public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Staff updates reports" ON reports FOR UPDATE USING (public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Reviewer updates steps" ON verification_steps FOR UPDATE USING (public.has_any_role(ARRAY['moderator', 'admin']));
CREATE POLICY "Staff creates moderation action" ON moderation_actions FOR INSERT WITH CHECK (public.has_any_role(ARRAY['moderator', 'admin']));
${definition(/CREATE TABLE audit_logs \([\s\S]*?\n\);/)}
ALTER TABLE audit_logs ALTER COLUMN actor_role TYPE text USING actor_role::text;
ALTER TABLE audit_logs ADD COLUMN previous_value jsonb, ADD COLUMN new_value jsonb, ADD COLUMN reason text;
CREATE TABLE public.feature_flags(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, key text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false, description text);
-- Functions that authorise from auth metadata, in both shapes used by earlier migrations.
CREATE FUNCTION public.is_commercial_admin(p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor
  AND raw_app_meta_data->>'role' IN ('admin','governance_controller'));
$$;
CREATE FUNCTION public.search_accounts(p_actor_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 RETURN EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_actor_id AND u.raw_app_meta_data->>'role' IN ('admin','governance_controller'));
END $$;
CREATE FUNCTION public.owner_is_staff(p_owner uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE staff boolean;
BEGIN
 SELECT COALESCE(raw_app_meta_data->>'role','') IN ('admin','governance_controller','moderator') INTO staff FROM auth.users WHERE id = p_owner;
 RETURN coalesce(staff, false);
END $$;
CREATE FUNCTION public.commercial_audit(p_actor uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT COALESCE((SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = p_actor),'system') $$;`);

// The real decision ledger (its read policies still use the JWT role).
await db.exec(read("20260326000000_decision_ledger_and_role_lifecycle.sql"));
await db.exec(`GRANT SELECT ON public.decision_records, public.decision_record_events,
  public.appeal_cases, public.role_assignments_history TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);

const uuid = () => crypto.randomUUID();
async function person(role) {
  const id = uuid();
  await db.query(`INSERT INTO auth.users(id, raw_app_meta_data) VALUES ($1, $2)`, [
    id,
    role ? { role } : {},
  ]);
  await db.query(`INSERT INTO account_profiles(user_id) VALUES ($1)`, [id]);
  return id;
}

const admin = await person("admin");
const secondAdmin = await person(" Admin ");
const governor = await person("governance_controller");
const moderator = await person("moderator");
const member = await person("member");
const owner = await person(null);

await db.exec(read("20260927110000_staff_roles_authority.sql"));

const rows = async (sql, args) => (await db.query(sql, args)).rows;
const scalar = async (sql, args) => Object.values((await db.query(sql, args)).rows[0])[0];

// Run a statement as a PostgREST caller whose JWT still claims `jwtRole`.
async function as(userId, jwtRole, fn) {
  await db.exec(`SET ROLE authenticated`);
  await db.query(`SELECT set_config('test.uid', $1, false), set_config('test.jwt', $2, false)`, [
    userId,
    JSON.stringify({ app_metadata: { role: jwtRole } }),
  ]);
  try {
    return await fn();
  } finally {
    await db.exec(
      `RESET ROLE; SELECT set_config('test.uid','',false), set_config('test.jwt','',false)`
    );
  }
}

// ── Backfill ──────────────────────────────────────────────────────────────
const staff = await rows(`SELECT user_id, role FROM staff_roles ORDER BY role`);
assert.equal(staff.length, 4, "every staff member is backfilled, members are not");
assert.equal(
  await scalar(`SELECT role FROM staff_roles WHERE user_id = $1`, [secondAdmin]),
  "admin",
  "roles are normalised"
);

// ── staff_role_of and the RLS helpers read the table, not the JWT ───────
assert.equal(await scalar(`SELECT public.staff_role_of($1)`, [governor]), "governance_controller");
assert.equal(await scalar(`SELECT public.staff_role_of($1)`, [member]), null);
await as(member, "admin", async () => {
  assert.equal(
    await scalar(`SELECT public.has_role('admin')`),
    false,
    "a forged JWT role is ignored"
  );
});
await as(moderator, "moderator", async () => {
  assert.equal(await scalar(`SELECT public.has_any_role(ARRAY['moderator','admin'])`), true);
});

// Demotion takes effect on the next statement, with the old token.
await db.query(
  `UPDATE staff_roles SET status='revoked', revoked_at=now(), revoked_by=$2, revoked_reason='test' WHERE user_id=$1`,
  [moderator, admin]
);
await as(moderator, "moderator", async () => {
  assert.equal(await scalar(`SELECT public.has_any_role(ARRAY['moderator','admin'])`), false);
  assert.equal(
    await scalar(`SELECT count(*)::int FROM reports`),
    0,
    "demoted staff lose read access"
  );
  assert.equal(await scalar(`SELECT count(*)::int FROM decision_records`), 0);
});
await db.query(
  `UPDATE staff_roles SET status='active', revoked_at=NULL, revoked_by=NULL, revoked_reason=NULL WHERE user_id=$1`,
  [moderator]
);

const access = await rows(`SELECT * FROM public.staff_access_of($1)`, [governor]);
assert.equal(access.length, 1);
assert.equal(access[0].role, "governance_controller");
assert(access[0].mfa_required_after > new Date(), "staff get an MFA enrolment grace period");
assert.equal((await rows(`SELECT * FROM public.staff_access_of($1)`, [member])).length, 0);

// A banned or suspended staff account has no staff access.
await db.query(`UPDATE account_profiles SET account_status='suspended' WHERE user_id=$1`, [
  governor,
]);
assert.equal(await scalar(`SELECT public.staff_role_of($1)`, [governor]), null);
assert.equal((await rows(`SELECT * FROM public.staff_access_of($1)`, [governor])).length, 0);
await db.query(`UPDATE account_profiles SET account_status='active' WHERE user_id=$1`, [governor]);

// ── Functions rewritten to staff_roles ────────────────────────────────────
for (const fn of ["is_commercial_admin", "search_accounts", "owner_is_staff"]) {
  const src = await scalar(`SELECT prosrc FROM pg_proc WHERE proname = $1`, [fn]);
  assert(!src.includes("raw_app_meta_data"), `${fn} no longer reads auth metadata`);
}
assert.equal(await scalar(`SELECT public.is_commercial_admin($1)`, [governor]), true);
assert.equal(await scalar(`SELECT public.is_commercial_admin($1)`, [moderator]), false);
assert.equal(await scalar(`SELECT public.search_accounts($1)`, [admin]), true);
assert.equal(await scalar(`SELECT public.owner_is_staff($1)`, [moderator]), true);
assert.equal(await scalar(`SELECT public.owner_is_staff($1)`, [member]), false);
await db.query(`UPDATE auth.users SET raw_app_meta_data='{"role":"admin"}' WHERE id=$1`, [member]);
assert.equal(
  await scalar(`SELECT public.is_commercial_admin($1)`, [member]),
  false,
  "metadata alone grants nothing"
);
assert.equal(
  await scalar(`SELECT public.commercial_audit($1)`, [member]),
  "admin",
  "labels untouched"
);
await db.query(`UPDATE auth.users SET raw_app_meta_data='{"role":"member"}' WHERE id=$1`, [member]);

// ── Policies ──────────────────────────────────────────────────────────────
const policies = await rows(
  `SELECT policyname, cmd, coalesce(qual,'') AS qual, coalesce(with_check,'') AS with_check FROM pg_policies WHERE schemaname='public'`
);
const names = policies.map((p) => p.policyname);
for (const dropped of [
  "Staff updates reports",
  "Reviewer updates steps",
  "Staff creates moderation action",
]) {
  assert(!names.includes(dropped), `${dropped} is dropped`);
}
for (const p of policies) {
  const text = p.qual + p.with_check;
  assert(!text.includes("app_metadata"), `${p.policyname} no longer reads the JWT role`);
  assert(!/(?<!SELECT )has_(any_)?role\(/.test(text), `${p.policyname} wraps role checks: ${text}`);
}

const listing = await scalar(
  `INSERT INTO listings(owner_id, title) VALUES ($1, 'Bakkie') RETURNING id`,
  [owner]
);
await as(moderator, "moderator", async () => {
  const updated = await rows(`UPDATE listings SET title='Changed' WHERE id=$1 RETURNING id`, [
    listing,
  ]);
  assert.equal(updated.length, 0, "moderators cannot edit listings through PostgREST");
  assert.equal(
    await scalar(`SELECT count(*)::int FROM listings`),
    1,
    "moderators still read listings"
  );
  const reportUpdate = await rows(`UPDATE reports SET status='resolved' RETURNING id`);
  assert.equal(reportUpdate.length, 0);
  await assert.rejects(
    db.query(`INSERT INTO moderation_actions(action) VALUES ('ban')`),
    /row-level security/,
    "moderators cannot insert moderation actions directly"
  );
});
await as(owner, "member", async () => {
  const updated = await rows(`UPDATE listings SET title='Owner edit' WHERE id=$1 RETURNING id`, [
    listing,
  ]);
  assert.equal(updated.length, 1, "owners still edit their own listings");
});
await as(admin, "admin", async () => {
  const updated = await rows(`UPDATE listings SET title='Admin edit' WHERE id=$1 RETURNING id`, [
    listing,
  ]);
  assert.equal(updated.length, 1, "admins keep direct write access");
});

// ── Last-admin protection ─────────────────────────────────────────────────
await db.query(
  `UPDATE staff_roles SET status='revoked', revoked_at=now(), revoked_reason='test' WHERE user_id=$1`,
  [secondAdmin]
);
await assert.rejects(
  db.query(`UPDATE staff_roles SET role='moderator' WHERE user_id=$1`, [admin]),
  /last active admin/
);
await assert.rejects(
  db.query(`DELETE FROM staff_roles WHERE user_id=$1`, [admin]),
  /last active admin/
);
await assert.rejects(db.query(`DELETE FROM auth.users WHERE id=$1`, [admin]), /last active admin/);

// ── Members cannot read other people's staff rows ─────────────────────────
await as(member, "member", async () => {
  assert.equal(await scalar(`SELECT count(*)::int FROM staff_roles`), 0);
  await assert.rejects(db.query(`SELECT public.staff_role_of($1)`, [admin]), /permission denied/);
});
await as(governor, "governance_controller", async () => {
  assert.equal(
    await scalar(`SELECT count(*)::int FROM staff_roles`),
    1,
    "staff read only their own row"
  );
});

console.log("Staff role authority checks passed.");

// ══ Role changes with independent approval ══════════════════════════════════
await db.exec(read("20260927110100_staff_role_changes.sql"));
await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
await db.query(
  `UPDATE staff_roles SET status='active', revoked_at=NULL, revoked_reason=NULL WHERE user_id=$1`,
  [secondAdmin]
);

const rpc = async (sql, args) => {
  await db.exec(`SET ROLE service_role`);
  try {
    return (await db.query(sql, args)).rows[0].result;
  } finally {
    await db.exec(`RESET ROLE`);
  }
};
const propose = (actor, target, role, reason = "Needed for launch queue") =>
  rpc(`SELECT public.propose_staff_role_change($1,$2,$3,$4) AS result`, [
    actor,
    target,
    role,
    reason,
  ]);
const approve = (actor, decision, version = 1) =>
  rpc(`SELECT public.approve_staff_role_change($1,$2,$3,'ok') AS result`, [
    actor,
    decision,
    version,
  ]);
const reject = (actor, decision) =>
  rpc(`SELECT public.reject_staff_role_change($1,$2,'no') AS result`, [actor, decision]);
const roleOf = (id) => scalar(`SELECT public.staff_role_of($1)`, [id]);

const newcomer = await person(null);
const newcomer2 = await person(null);

// Promotion to moderator: admin proposes, an independent governor approves.
let result = await propose(admin, newcomer, "moderator");
assert.equal(result.status, "proposed");
assert.equal(await roleOf(newcomer), null, "a proposal grants nothing yet");
assert.equal((await propose(admin, newcomer, "moderator")).error, "pending_exists");
assert.equal(
  (await approve(admin, result.decision_id)).error,
  "not_independent",
  "no self-approval"
);
assert.equal((await approve(moderator, result.decision_id)).error, "forbidden");
assert.equal((await approve(governor, result.decision_id, 2)).error, "payload_changed");
const approved = await approve(governor, result.decision_id);
assert.equal(approved.status, "applied");
assert.equal(await roleOf(newcomer), "moderator");
assert.equal(
  (await approve(secondAdmin, result.decision_id)).error,
  "not_pending",
  "no double finalisation"
);
assert.equal(
  await scalar(
    `SELECT count(*)::int FROM audit_logs WHERE target_id=$1 AND action='role_assigned'`,
    [newcomer]
  ),
  1
);
assert.equal(
  await scalar(`SELECT count(*)::int FROM role_assignments_history WHERE target_user_id=$1`, [
    newcomer,
  ]),
  1
);
assert.equal(
  await scalar(`SELECT count(*)::int FROM decision_approvals WHERE decision_id=$1`, [
    result.decision_id,
  ]),
  1
);

// Promotion to admin needs a second admin; a governor cannot approve it.
result = await propose(admin, newcomer2, "admin");
assert.equal((await approve(governor, result.decision_id)).error, "forbidden");
assert.equal((await approve(secondAdmin, result.decision_id)).status, "applied");
assert.equal(await roleOf(newcomer2), "admin");

// Only admins propose promotions; nobody changes their own role.
assert.equal((await propose(governor, member, "moderator")).error, "forbidden");
assert.equal((await propose(moderator, member, "moderator")).error, "forbidden");
assert.equal((await propose(admin, admin, "moderator")).error, "self_change");
assert.equal((await propose(admin, member, "moderator", "x")).error, "reason_required");
assert.equal((await propose(admin, uuid(), "moderator")).error, "target_not_found");

// Admin demotion is immediate; a stale proposal is cancelled on approval.
result = await propose(admin, member, "moderator");
assert.equal((await propose(secondAdmin, member, "governance_controller")).error, "pending_exists");
await db.query(`INSERT INTO staff_roles(user_id, role) VALUES ($1, 'moderator')`, [member]);
assert.equal((await approve(governor, result.decision_id)).error, "stale");
assert.equal(
  await scalar(`SELECT status::text FROM decision_records WHERE id=$1`, [result.decision_id]),
  "cancelled"
);
result = await propose(admin, member, "member", "Left the team");
assert.equal(result.status, "applied");
assert.equal(await roleOf(member), null);

// A governor may ask for a moderator's removal; only an admin can approve it.
result = await propose(governor, newcomer, "member", "Repeated policy errors");
assert.equal(result.status, "proposed");
assert.equal(await roleOf(newcomer), "moderator", "the proposal alone removes nothing");
assert.equal((await approve(governor, result.decision_id)).error, "not_independent");
assert.equal((await approve(admin, result.decision_id)).status, "applied");
assert.equal(await roleOf(newcomer), null);

// A proposer who loses authority voids their pending proposals.
result = await propose(newcomer2, member, "moderator");
await propose(admin, newcomer2, "member", "Temporary admin no longer needed");
assert.equal((await approve(secondAdmin, result.decision_id)).error, "proposer_lost_authority");

// Proposals expire after 7 days.
result = await propose(admin, member, "moderator");
await db.query(`UPDATE decision_records SET expires_at = now() - interval '1 minute' WHERE id=$1`, [
  result.decision_id,
]);
assert.equal((await approve(governor, result.decision_id)).error, "expired");
assert.equal(
  await scalar(`SELECT status::text FROM decision_records WHERE id=$1`, [result.decision_id]),
  "expired"
);

// Rejection by an eligible approver, withdrawal by the proposer.
result = await propose(admin, member, "moderator");
assert.equal((await reject(moderator, result.decision_id)).error, "forbidden");
assert.equal((await reject(governor, result.decision_id)).status, "rejected");
result = await propose(admin, member, "moderator");
assert.equal((await reject(admin, result.decision_id)).status, "withdrawn");

// A failed audit write rolls the whole role change back.
result = await propose(admin, member, "moderator");
await db.exec(
  `ALTER TABLE audit_logs ADD CONSTRAINT test_block_role_audit CHECK (action <> 'role_assigned') NOT VALID`
);
const historyBefore = await scalar(`SELECT count(*)::int FROM role_assignments_history`);
await assert.rejects(approve(governor, result.decision_id), /test_block_role_audit/);
assert.equal(await roleOf(member), null, "no role without its audit row");
assert.equal(await scalar(`SELECT count(*)::int FROM role_assignments_history`), historyBefore);
assert.equal(
  await scalar(`SELECT status::text FROM decision_records WHERE id=$1`, [result.decision_id]),
  "pending_approval",
  "the proposal stays pending and can be approved again"
);
await db.exec(`ALTER TABLE audit_logs DROP CONSTRAINT test_block_role_audit`);
assert.equal((await approve(governor, result.decision_id)).status, "applied");

// The last admin cannot be demoted, and the demoted admin can no longer act.
assert.equal((await propose(admin, secondAdmin, "member", "Rotation")).status, "applied");
assert.equal(
  await scalar(`SELECT count(*)::int FROM staff_roles WHERE role='admin' AND status='active'`),
  1
);
assert.equal((await propose(secondAdmin, admin, "member", "Rotation")).error, "forbidden");
assert.equal(await roleOf(admin), "admin");

// Owner provisioning: the recovery path when no second admin can approve.
const recovered = await person(null);
await assert.rejects(
  rpc(`SELECT public.provision_staff_role_by_owner($1,'admin','short') AS result`, [recovered]),
  /written reason/
);
assert.equal(
  await rpc(`SELECT public.provision_staff_role_by_owner($1,'admin',$2) AS result`, [
    recovered,
    "Second admin for four-eyes approval",
  ]),
  "member"
);
assert.equal(await roleOf(recovered), "admin");
assert.equal(
  await scalar(
    `SELECT count(*)::int FROM audit_logs WHERE target_id=$1 AND action='role_provisioned_by_owner'`,
    [recovered]
  ),
  1
);

// Members cannot call the RPCs.
await as(member, "member", async () => {
  await assert.rejects(
    db.query(`SELECT public.propose_staff_role_change($1,$2,'admin','Self promotion')`, [
      member,
      member,
    ]),
    /permission denied/
  );
  await assert.rejects(
    db.query(`SELECT public.auth_user_id_by_email('a@b.co')`),
    /permission denied/
  );
  await assert.rejects(
    db.query(`SELECT public.provision_staff_role_by_owner($1,'admin','Self promotion attempt')`, [
      member,
    ]),
    /permission denied/
  );
});

console.log("Staff role change checks passed.");

// Direct PostgREST callers must meet the route's MFA read-access policy too.
await db.exec(`CREATE TABLE auth.mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, status text NOT NULL
);`);
await db.query(`INSERT INTO reports(status) VALUES ('open')`);
await db.query(
  `UPDATE staff_roles SET mfa_required_after=now()-interval '1 day' WHERE user_id=$1`,
  [admin]
);
await as(admin, "admin", async () => {
  assert(
    (await scalar(`SELECT count(*)::int FROM reports`)) > 0,
    "reproduce pre-migration AAL1 staff read bypass"
  );
});
await db.exec(read("20260930110000_staff_rls_mfa.sql"));
// Minimal organisation fixture allows the entire privilege migration to run;
// its full RLS/column behavior is exercised by test-commercial-model.mjs.
await db.exec(`CREATE TABLE public.organisations(id uuid PRIMARY KEY, is_public boolean, programme_status text);
CREATE FUNCTION public.organisation_id_is_listed(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM organisations WHERE id=p_org AND is_public)
$$;
REVOKE ALL ON FUNCTION public.organisation_id_is_listed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organisation_id_is_listed(uuid) TO anon, authenticated, service_role;`);
await db.exec(read("20260930180000_role_predicates_security_invoker.sql"));
await db.exec(read("20260930180000_role_predicates_security_invoker.sql"));
for (const signature of ["has_role(text)", "has_any_role(text[])"])
  assert.equal(
    await scalar(`SELECT prosecdef FROM pg_proc WHERE oid=$1::regprocedure`, [signature]),
    false,
    `${signature} runs with caller privileges`
  );
assert.equal(
  await scalar(
    `SELECT prosecdef FROM pg_proc WHERE oid='public.current_staff_role()'::regprocedure`
  ),
  true,
  "current_staff_role retains the required privileged MFA boundary"
);
for (const role of ["anon", "authenticated", "service_role"])
  for (const signature of ["has_role(text)", "has_any_role(text[])", "current_staff_role()"])
    assert.equal(
      await scalar(`SELECT has_function_privilege($1,$2,'EXECUTE')`, [role, signature]),
      true,
      `${role} keeps EXECUTE on ${signature}`
    );
await db.exec("SET ROLE anon");
try {
  assert.equal(await scalar(`SELECT public.has_role('admin')`), false, "anon has no admin role");
  assert.equal(
    await scalar(`SELECT public.has_any_role(ARRAY['admin','moderator'])`),
    false,
    "anon has no staff role"
  );
  await assert.rejects(db.query(`SELECT public.staff_role_of($1)`, [admin]), /permission denied/);
} finally {
  await db.exec("RESET ROLE");
}
const invokerMember = await person("member");
await as(invokerMember, "admin", async () => {
  await db.query(`SELECT set_config('test.jwt',$1,false)`, [
    JSON.stringify({ aal: "aal2", app_metadata: { role: "admin" } }),
  ]);
  assert.equal(
    await scalar(`SELECT public.has_role('admin')`),
    false,
    "forged AAL2 JWT cannot grant admin"
  );
  assert.equal(
    await scalar(`SELECT public.has_any_role(ARRAY['admin','moderator'])`),
    false,
    "forged AAL2 JWT cannot grant staff"
  );
  await assert.rejects(db.query(`SELECT public.staff_role_of($1)`, [admin]), /permission denied/);
});
await as(admin, "admin", async () => {
  assert.equal(
    await scalar(`SELECT public.current_staff_role()`),
    null,
    "expired grace requires MFA"
  );
  assert.equal(await scalar(`SELECT public.has_role('admin')`), false);
  assert.equal(await scalar(`SELECT public.has_any_role(ARRAY['admin','moderator'])`), false);
  assert.equal(
    await scalar(`SELECT count(*)::int FROM reports`),
    0,
    "AAL1 cannot read staff records through RLS"
  );
  await db.query(`SELECT set_config('test.jwt', $1, false)`, [JSON.stringify({ aal: "aal2" })]);
  assert.equal(await scalar(`SELECT public.has_role('admin')`), true);
  assert((await scalar(`SELECT count(*)::int FROM reports`)) > 0, "AAL2 restores staff reads");
});
await db.query(
  `UPDATE staff_roles SET mfa_required_after=now()+interval '1 day' WHERE user_id=$1`,
  [admin]
);
await as(admin, "admin", async () => {
  assert.equal(
    await scalar(`SELECT public.has_role('admin')`),
    true,
    "unenrolled staff retain grace"
  );
});
await db.query(`INSERT INTO auth.mfa_factors(user_id,status) VALUES ($1,'verified')`, [admin]);
await as(admin, "admin", async () => {
  assert.equal(
    await scalar(`SELECT public.has_role('admin')`),
    false,
    "enrolled staff must verify even in grace"
  );
});
await db.exec(`UPDATE feature_flags SET enabled=false WHERE key='staff_mfa_enforced'`);
await as(admin, "admin", async () => {
  assert.equal(
    await scalar(`SELECT public.has_role('admin')`),
    true,
    "explicit off preserves recovery switch"
  );
});
await db.exec(`DELETE FROM feature_flags WHERE key='staff_mfa_enforced'`);
await as(admin, "admin", async () => {
  assert.equal(await scalar(`SELECT public.has_role('admin')`), false, "missing flag fails closed");
});
await db.exec(`ALTER TABLE feature_flags ADD COLUMN mode text;
  INSERT INTO feature_flags(key, enabled, mode) VALUES ('staff_mfa_enforced', false, 'on');`);
await as(admin, "admin", async () => {
  assert.equal(
    await scalar(`SELECT public.has_role('admin')`),
    false,
    "explicit mode overrides legacy enabled flag"
  );
});
await db.exec(`UPDATE feature_flags SET enabled=true, mode='off' WHERE key='staff_mfa_enforced'`);
await as(admin, "admin", async () => {
  assert.equal(await scalar(`SELECT public.has_role('admin')`), true);
  await db.query(`SELECT set_config('test.jwt', $1, false)`, [
    JSON.stringify({ aal: "aal2", is_anonymous: true }),
  ]);
  assert.equal(
    await scalar(`SELECT public.has_role('admin')`),
    false,
    "anonymous sessions never gain staff privileges"
  );
});
assert.equal(
  await scalar(`SELECT public.staff_role_of($1)`, [admin]),
  "admin",
  "service role can still authorize MFA enrolment"
);
console.log("Staff RLS MFA checks passed.");

// Final proposed state: no flag/grace exception; signed-out sessions lose RLS authority.
await db.exec(
  "CREATE TABLE auth.sessions(id uuid PRIMARY KEY, user_id uuid NOT NULL, not_after timestamptz);"
);
const activeSession = uuid();
await db.query("INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2)", [activeSession, admin]);
await db.exec(read("20261009205230_require_staff_mfa_without_exceptions.sql"));
await as(admin, "admin", async () => {
  await db.query("SELECT set_config('test.jwt',$1,false)", [
    JSON.stringify({ aal: "aal1", session_id: activeSession }),
  ]);
  assert.equal(
    await scalar("SELECT public.current_staff_role()"),
    null,
    "off flag and future grace cannot grant AAL1 staff access"
  );
  await db.query("SELECT set_config('test.jwt',$1,false)", [
    JSON.stringify({ aal: "aal2", session_id: activeSession }),
  ]);
  assert.equal(
    await scalar("SELECT public.current_staff_role()"),
    "admin",
    "active AAL2 session works"
  );
  assert(
    (await scalar("SELECT count(*)::int FROM reports")) > 0,
    "legitimate RLS staff read remains"
  );
  await assert.rejects(
    db.query("SELECT public.staff_session_is_active($1,$2)", [admin, activeSession]),
    /permission denied/
  );
});
await as(member, "admin", async () => {
  await db.query("SELECT set_config('test.jwt',$1,false)", [
    JSON.stringify({ aal: "aal2", session_id: activeSession }),
  ]);
  assert.equal(
    await scalar("SELECT public.current_staff_role()"),
    null,
    "cross-user session cannot confer staff access"
  );
});
assert.equal(
  await scalar("SELECT public.staff_session_is_active($1,$2)", [admin, activeSession]),
  true
);
await db.query("UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=$1", [
  activeSession,
]);
assert.equal(
  await scalar("SELECT public.staff_session_is_active($1,$2)", [admin, activeSession]),
  false,
  "expired session rejected before background cleanup"
);
await as(admin, "admin", async () => {
  await db.query("SELECT set_config('test.jwt',$1,false)", [
    JSON.stringify({ aal: "aal2", session_id: activeSession }),
  ]);
  assert.equal(
    await scalar("SELECT public.current_staff_role()"),
    null,
    "expired session cannot retain staff RLS authority"
  );
});
await db.query("UPDATE auth.sessions SET not_after=NULL WHERE id=$1", [activeSession]);
await db.query("DELETE FROM auth.sessions WHERE id=$1", [activeSession]);
await as(admin, "admin", async () => {
  await db.query("SELECT set_config('test.jwt',$1,false)", [
    JSON.stringify({ aal: "aal2", session_id: activeSession }),
  ]);
  assert.equal(
    await scalar("SELECT public.current_staff_role()"),
    null,
    "revoked AAL2 session rejected"
  );
  assert.equal(
    await scalar("SELECT count(*)::int FROM reports"),
    0,
    "revocation removes RLS staff read"
  );
});
assert.equal(
  await scalar("SELECT public.staff_session_is_active($1,$2)", [admin, activeSession]),
  false
);
assert.equal(
  await scalar("SELECT public.staff_role_of($1)", [admin]),
  "admin",
  "MFA enrolment lookup preserved"
);
console.log("Strict MFA and session revocation checks passed.");
