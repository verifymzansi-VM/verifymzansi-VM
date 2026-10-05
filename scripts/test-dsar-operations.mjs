// Isolated PostgreSQL checks for data request operations: deadline rules,
// extensions with notice, subject linking and the retention overview.
import assert from "node:assert/strict";
import { createAdminDb } from "./lib/admin-db.mjs";

process.on("uncaughtException", (error) => {
  const at = (error.stack ?? "").split(/\r?\n/).find((l) => l.includes("test-dsar-operations"));
  console.error(error.message, error.where ?? "", at ?? "");
  process.exit(1);
});

const { db, person, scalar, call, migrate } = await createAdminDb();

const admin = await person("admin");
const governor = await person("governance_controller");
const moderator = await person("moderator");
const member = await person("member");
await db.query(`UPDATE auth.users SET email='member@example.com' WHERE id=$1`, [member]);

// A case filed before this migration, with the email of exactly one account.
const legacy = await scalar(
  `INSERT INTO dsar_cases(type,requester_email,requester_phone,description,due_by,created_at)
   VALUES ('access','Member@Example.com','n/a','Old request', now() + interval '5 days', now() - interval '25 days') RETURNING id`
);

await migrate(
  "20260927110000_staff_roles_authority.sql",
  "20260927110100_staff_role_changes.sql",
  "20260927120000_decision_execution_layer.sql",
  "20260928130000_dsar_operations.sql"
);

// ── Backfill ────────────────────────────────────────────────────────────────
assert.equal(await scalar(`SELECT subject_user_id FROM dsar_cases WHERE id=$1`, [legacy]), member);
assert.match(await scalar(`SELECT legal_basis FROM dsar_cases WHERE id=$1`, [legacy]), /PAIA s25/);
assert(await scalar(`SELECT received_at FROM dsar_cases WHERE id=$1`, [legacy]));

// ── Deadlines come from the rules, not the caller ───────────────────────────
const fresh = await scalar(
  `INSERT INTO dsar_cases(type,requester_email,requester_phone,description,due_by)
   VALUES ('deletion','someone@example.com','n/a','Please delete', now() + interval '365 days') RETURNING id`
);
const days = await scalar(
  `SELECT round(extract(epoch FROM due_by - received_at) / 86400)::int FROM dsar_cases WHERE id=$1`,
  [fresh]
);
assert.equal(days, 30, "a caller cannot set a later due date");
assert.match(
  await scalar(`SELECT legal_basis FROM dsar_cases WHERE id=$1`, [fresh]),
  /Internal target/
);

// ── Extensions: access only, once, with a reason and a notice ──────────────
const extend = (actor, id, reason = "Records held in two systems need retrieving") =>
  call(`SELECT public.extend_dsar_deadline($1,$2,$3) AS result`, [actor, id, reason]);
assert.equal((await extend(moderator, legacy)).error, "forbidden");
assert.equal((await extend(governor, legacy, "short")).error, "reason_required");
assert.equal(
  (await extend(governor, fresh)).error,
  "extension_not_allowed",
  "deletion has no statutory extension"
);
const r = await extend(governor, legacy);
assert.equal(r.status, "extended");
const extendedDays = await scalar(
  `SELECT round(extract(epoch FROM extended_due_at - due_by) / 86400)::int FROM dsar_cases WHERE id=$1`,
  [legacy]
);
assert.equal(extendedDays, 30);
assert.equal(
  await scalar(`SELECT effective_due_at = extended_due_at FROM dsar_cases WHERE id=$1`, [legacy]),
  true,
  "screens sort on the extended deadline"
);
assert.equal((await extend(admin, legacy)).error, "already_extended");
assert.equal(
  await scalar(`SELECT count(*)::int FROM operation_jobs WHERE operation_key=$1`, [
    `dsar_extension:${legacy}`,
  ]),
  1,
  "the requester is notified through a durable job"
);
assert.equal(await scalar(`SELECT count(*)::int FROM audit_logs WHERE action='dsar_extended'`), 1);

const late = await scalar(
  `INSERT INTO dsar_cases(type,requester_email,requester_phone,description,due_by,received_at)
   VALUES ('access','late@example.com','n/a','x', now(), now() - interval '40 days') RETURNING id`
);
assert.equal(
  (await extend(governor, late)).error,
  "already_overdue",
  "extensions must be given before the deadline"
);

// ── Retention overview ──────────────────────────────────────────────────────
await db.query(
  `INSERT INTO kyc_artifacts(user_id,r2_key,purge_after) VALUES ($1,'kyc/a',now() - interval '3 days'),($1,'kyc/b',now() + interval '3 days')`,
  [member]
);
await db.query(
  `INSERT INTO r2_cleanup_queue(bucket,r2_key,reason,created_at) VALUES ('b','kyc/a','purge', now() - interval '2 days')`
);
await db.query(`UPDATE account_profiles SET legal_hold = true WHERE user_id=$1`, [member]);
const overview = await call(`SELECT public.retention_overview() AS result`);
assert.equal(overview.deletions_pending, 1);
assert.equal(overview.deletions_stuck, 1);
assert.equal(overview.evidence_overdue, 1);
assert.equal(overview.legal_holds, 1);

await db.exec(`SET ROLE authenticated`);
await assert.rejects(db.query(`SELECT public.retention_overview()`), /permission denied/);
await db.exec(`RESET ROLE`);

console.log("DSAR operation checks passed.");
