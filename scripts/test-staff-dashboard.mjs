// Isolated PostgreSQL checks for the staff home and navigation counts:
// role scoping, the card definitions, and "unavailable" instead of zero.
import assert from "node:assert/strict";
import { createAdminDb } from "./lib/admin-db.mjs";

process.on("uncaughtException", (error) => {
  const at = (error.stack ?? "").split(/\r?\n/).find((l) => l.includes("test-staff-dashboard"));
  console.error(error.message, error.where ?? "", at ?? "");
  process.exit(1);
});

const { db, person, scalar, asService, call, migrate } = await createAdminDb();

const admin = await person("admin");
const governor = await person("governance_controller");
const moderator = await person("moderator");
const member = await person("member");

await migrate(
  "20260927110000_staff_roles_authority.sql",
  "20260927110100_staff_role_changes.sql",
  "20260927120000_decision_execution_layer.sql",
  "20260928120000_queue_claims.sql",
  "20260928130000_dsar_operations.sql",
  "20260929120000_staff_dashboard.sql"
);

const dashboard = (actor) => call(`SELECT public.staff_dashboard($1) AS result`, [actor]);
const nav = (actor) => call(`SELECT public.staff_nav_counts($1) AS result`, [actor]);

// ── Seed: two open reports (one past its 4-hour SLA), KYC, content, support ─
const listing = await scalar(
  `INSERT INTO listings(owner_id,status) VALUES ($1,'live') RETURNING id`,
  [member]
);
const report = (severity, age) =>
  scalar(
    `INSERT INTO reports(target_id,target_type,area,category,severity,description,reporter_ip_hash,created_at)
     VALUES ($1,'listing','MZANSI_MARKET','scam',$2,'This listing asks for payment outside the platform','h',
             now() - $3::interval) RETURNING id`,
    [listing, severity, age]
  );
await report("high", "5 hours"); // breached: high is 4 hours
await report("standard", "5 hours"); // within 24 hours
await db.query(
  `INSERT INTO verification_steps(user_id,step_type,risk_level) VALUES ($1,'id_doc','high')`,
  [member]
);
await db.query(`INSERT INTO verification_steps(user_id,step_type) VALUES ($1,'location')`, [
  member,
]);
await db.query(`INSERT INTO listings(owner_id,status) VALUES ($1,'pending_moderation')`, [member]);
await db.query(`INSERT INTO content_edit_requests(owner_id) VALUES ($1)`, [member]);
await db.query(
  `INSERT INTO contact_submissions(name,email,message) VALUES ('A','a@example.com','Help')`
);
await db.query(
  `INSERT INTO dsar_cases(type,requester_email,requester_phone,description,due_by,received_at)
   VALUES ('access','x@example.com','n/a','Old', now(), now() - interval '40 days')`
);
await db.query(
  `INSERT INTO audit_logs(actor_id,actor_role,action,target_type,target_id)
                VALUES ($1,'moderator','report_dismissed','report',gen_random_uuid())`,
  [moderator]
);

// A moderator claims a report.
await asService(() =>
  db.query(`SELECT * FROM public.claim_queue_items($1,'reports',1)`, [moderator])
);

// ── Moderator: queues and their shift, nothing else ─────────────────────────
const mod = await dashboard(moderator);
assert.equal(mod.role, "moderator");
assert.equal(mod.queues.reports.open, 2);
assert.equal(mod.queues.reports.breached, 1, "only the high report is past its SLA");
assert.equal(mod.queues.reports.claimed, 1);
assert.equal(mod.queues.kyc.pending, 1, "location checks are not in the KYC queue");
assert.equal(mod.queues.kyc.high_risk, 1);
assert.equal(mod.queues.content.pending, 2, "pending listings and content edits");
assert.equal(mod.queues.support.new, 1);
assert.equal(mod.shift.claims.length, 1);
assert.equal(mod.shift.claims[0].queue, "reports");
assert.equal(mod.shift.actions_today, 1);
for (const key of ["decisions", "restrictions", "dsar", "oversight", "platform", "retention"]) {
  assert(!(key in mod), `a moderator does not receive ${key}`);
}
const modNav = await nav(moderator);
assert.deepEqual(Object.keys(modNav).sort(), ["content", "kyc", "reports", "support"]);

// ── Governor: decisions and oversight, no shift, no platform ────────────────
const gov = await dashboard(governor);
assert(!("shift" in gov), "governors do not claim queue work");
assert(!("platform" in gov));
assert.equal(gov.dsar.open, 1);
assert.equal(gov.dsar.overdue, 1, "the deadline is computed from received_at, and has passed");
assert.equal(gov.decisions.escalated, 0);
assert.equal(gov.oversight.window_days, 30);
assert.equal((await nav(governor)).dsar_overdue, 1);

// ── Admin: everything, including platform health and the team ──────────────
const adm = await dashboard(admin);
assert(adm.shift && adm.decisions && adm.platform, "admins see every section");
assert.equal(adm.platform.staff.admin, 1);
assert.equal(adm.platform.staff.moderator, 1);
assert.equal(adm.retention.legal_holds, 0);

// ── Not staff: refused ──────────────────────────────────────────────────────
await assert.rejects(dashboard(member), /forbidden/);
await assert.rejects(nav(member), /forbidden/);
await db.query(`UPDATE staff_roles SET status='revoked', revoked_at=now() WHERE user_id=$1`, [
  moderator,
]);
await assert.rejects(dashboard(moderator), /forbidden/, "revoked staff lose the dashboard at once");

// ── A section that cannot be read is null, not zero ─────────────────────────
await db.exec(`ALTER TABLE contact_submissions RENAME TO contact_submissions_hidden`);
const partial = await dashboard(admin);
assert.equal(partial.queues.support, null);
assert.equal(partial.queues.reports.open, 2, "other sections still load");
await db.exec(`ALTER TABLE contact_submissions_hidden RENAME TO contact_submissions`);

// ── Only the service role may call these ────────────────────────────────────
for (const fn of ["staff_dashboard(uuid)", "staff_nav_counts(uuid)"]) {
  assert.equal(
    await scalar(`SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`),
    false
  );
  assert.equal(
    await scalar(`SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`),
    false
  );
}

console.log("Staff dashboard checks passed.");
