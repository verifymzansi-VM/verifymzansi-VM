// Isolated PostgreSQL checks for the decision execution layer: enforcement
// decisions, recorded effects, appeals, expiry, jobs and append-only audit.
// PGlite only: no environment loading, sockets or remote database.
import assert from "node:assert/strict";
import { createAdminDb } from "./lib/admin-db.mjs";

process.on("uncaughtException", (error) => {
  const at = (error.stack ?? "").split(/\r?\n/).find((l) => l.includes("test-decision-execution"));
  console.error(error.message, error.where ?? "", at ?? "");
  process.exit(1);
});

const { db, uuid, person, rows, scalar, asService, call, migrate } = await createAdminDb();

const admin = await person("admin");
const admin2 = await person("admin");
const governor = await person("governance_controller");
const governor2 = await person("governance_controller");
const moderator = await person("moderator");
const legacyBanned = await person(null, "banned");

await migrate(
  "20260927110000_staff_roles_authority.sql",
  "20260927110100_staff_role_changes.sql",
  "20260927120000_decision_execution_layer.sql"
);

const moderate = (actor, report, action, opts = {}) =>
  call(`SELECT public.moderate_report($1,$2,$3,$4,$5,$6) AS result`, [
    actor,
    report,
    action,
    opts.reason ?? "Clear policy breach",
    opts.days ?? null,
    opts.emergency ?? false,
  ]);
const approve = (actor, decision, version = 1) =>
  call(`SELECT public.approve_decision($1,$2,$3,'Approved') AS result`, [actor, decision, version]);
const reject = (actor, decision) =>
  call(`SELECT public.reject_decision($1,$2,'No') AS result`, [actor, decision]);
const appeal = (user, decision, reason = "I did not do this and have proof of my identity.") =>
  call(`SELECT public.submit_appeal($1,$2,$3,'[]'::jsonb) AS result`, [user, decision, reason]);
const resolve = (actor, appealId, outcome, shortenTo = null) =>
  call(`SELECT public.resolve_appeal($1,$2,$3,'Reviewed all the evidence',$4) AS result`, [
    actor,
    appealId,
    outcome,
    shortenTo,
  ]);
const statusOf = (user) =>
  scalar(`SELECT account_status::text FROM account_profiles WHERE user_id=$1`, [user]);
const listingStatus = (id) => scalar(`SELECT status::text FROM listings WHERE id=$1`, [id]);

async function seller() {
  const id = await person("member");
  const live = await scalar(
    `INSERT INTO listings(owner_id,status) VALUES ($1,'live') RETURNING id`,
    [id]
  );
  const pending = await scalar(
    `INSERT INTO listings(owner_id,status) VALUES ($1,'pending_moderation') RETURNING id`,
    [id]
  );
  const ownHidden = await scalar(
    `INSERT INTO listings(owner_id,status) VALUES ($1,'hidden') RETURNING id`,
    [id]
  );
  return { id, live, pending, ownHidden };
}
async function reportOn(listing, reporter = null) {
  return scalar(
    `INSERT INTO reports(target_id,target_type,area,category,severity,description,reporter_user_id,reporter_ip_hash)
     VALUES ($1,'listing','MZANSI_MARKET','scam','high','This listing asks for payment outside the platform',$2,'hash') RETURNING id`,
    [listing, reporter]
  );
}

// ── Legacy backfill ─────────────────────────────────────────────────────────
const legacy = await rows(`SELECT kind, lifted_at FROM account_restrictions WHERE user_id=$1`, [
  legacyBanned,
]);
assert.deepEqual(
  legacy.map((r) => r.kind),
  ["ban"],
  "existing bans become restrictions"
);
assert.equal(
  await scalar(
    `SELECT count(*)::int FROM decision_records WHERE case_type='legacy_enforcement' AND recommender_id IS NULL`
  ),
  1
);

// ── A ban is proposed by one person and applied by another ──────────────────
const s1 = await seller();
const reporter = await person("member");
let rep = await reportOn(s1.live, reporter);

let r = await moderate(moderator, rep, "ban");
assert.equal(r.status, "proposed");
assert.equal(await statusOf(s1.id), "active", "a proposal changes nothing");
assert.equal(await scalar(`SELECT status::text FROM reports WHERE id=$1`, [rep]), "in_progress");
assert.equal((await moderate(governor, rep, "warn")).error, "already_actioned");
const banDecision = r.decision_id;

assert.equal((await approve(moderator, banDecision)).error, "forbidden");
assert.equal((await approve(reporter, banDecision)).error, "forbidden");
assert.equal((await approve(governor, banDecision, 2)).error, "payload_changed");
r = await approve(governor, banDecision);
assert.equal(r.status, "applied");
assert.equal(await statusOf(s1.id), "banned");
assert.equal(await listingStatus(s1.live), "suspended");
assert.equal(await listingStatus(s1.pending), "hidden");
assert.equal(await listingStatus(s1.ownHidden), "hidden", "content the owner hid is not touched");
assert.equal(
  await scalar(`SELECT count(*)::int FROM content_effects WHERE decision_id=$1`, [banDecision]),
  2
);
assert.equal(await scalar(`SELECT status::text FROM reports WHERE id=$1`, [rep]), "resolved");
assert.equal(
  await scalar(`SELECT execution_status FROM decision_records WHERE id=$1`, [banDecision]),
  "succeeded"
);
assert.equal(
  await scalar(
    `SELECT count(*)::int FROM operation_jobs WHERE decision_id=$1 AND kind='email_notice'`,
    [banDecision]
  ),
  1
);
assert.equal(
  await scalar(
    `SELECT count(*)::int FROM audit_logs WHERE action='account_banned' AND target_id=$1`,
    [s1.id]
  ),
  1
);
assert.equal(
  (await approve(governor2, banDecision)).error,
  "not_pending",
  "no double finalisation"
);

// A proposer cannot approve their own proposal; the reporter cannot act on it.
const s2 = await seller();
rep = await reportOn(s2.live, governor2);
assert.equal(
  (await moderate(governor2, rep, "warn")).error,
  "not_independent",
  "reporters do not decide their reports"
);
r = await moderate(governor, rep, "suspend", { days: 7 });
assert.equal((await approve(governor, r.decision_id)).error, "not_independent");
assert.equal(
  (await approve(governor2, r.decision_id)).error,
  "not_independent",
  "the reporter cannot approve"
);
assert.equal((await approve(admin, r.decision_id)).status, "applied");
assert.equal(await statusOf(s2.id), "suspended");
assert.equal(
  (await moderate(moderator, await reportOn(s2.live), "suspend", { days: 45 })).error,
  "invalid_duration"
);

// ── Guards ──────────────────────────────────────────────────────────────────
await asService(async () => {
  await assert.rejects(
    db.query(`UPDATE account_profiles SET account_status='active' WHERE user_id=$1`, [s1.id]),
    /enforcement decisions/,
    "even the service role cannot write account status directly"
  );
  await assert.rejects(
    db.query(`UPDATE listings SET status='live' WHERE id=$1`, [s1.ownHidden]),
    /banned or suspended/,
    "a banned owner's content cannot be republished"
  );
  await assert.rejects(db.query(`DELETE FROM audit_logs`), /append-only/);
  await assert.rejects(db.query(`UPDATE decision_record_events SET event_type='x'`), /append-only/);
  await db.query(
    `INSERT INTO role_assignments_history(target_user_id,previous_role,new_role,assigned_by,reason)
     VALUES ($1,'member','moderator',$2,'test row')`,
    [moderator, admin]
  );
  await assert.rejects(db.query(`DELETE FROM role_assignments_history`), /append-only/);
  await assert.rejects(db.query(`TRUNCATE audit_logs`), /append-only/);
});

// ── Appeals ─────────────────────────────────────────────────────────────────
const stranger = await person("member");
assert.equal(
  (await appeal(stranger, banDecision)).error,
  "not_found",
  "only the affected person may appeal"
);
assert.equal((await appeal(s1.id, banDecision, "too short")).error, "reason_length");
r = await appeal(s1.id, banDecision);
assert.equal(r.status, "submitted");
const appealId = r.appeal_id;
assert.equal((await appeal(s1.id, banDecision)).error, "appeal_open");
assert.equal(
  (await resolve(governor, appealId, "overturned")).error,
  "not_independent",
  "the approver cannot review"
);
assert.equal((await resolve(moderator, appealId, "overturned")).error, "forbidden");
assert.equal((await resolve(admin, appealId, "overturned")).status, "overturned");
assert.equal(await statusOf(s1.id), "active");
assert.equal(await listingStatus(s1.live), "live", "restored exactly");
assert.equal(await listingStatus(s1.pending), "pending_moderation");
assert.equal(await listingStatus(s1.ownHidden), "hidden", "owner-hidden content stays hidden");
assert.equal(
  await scalar(`SELECT status::text FROM decision_records WHERE id=$1`, [banDecision]),
  "overridden"
);
assert.equal(await scalar(`SELECT count(*)::int FROM notifications WHERE user_id=$1`, [s1.id]), 1);
assert.equal((await appeal(s1.id, banDecision)).error, "not_appealable");

// ── Warnings never change status and never lift a ban ──────────────────────
const s3 = await seller();
r = await moderate(moderator, await reportOn(s3.live), "warn");
assert.equal(r.status, "applied");
assert.equal(await statusOf(s3.id), "active");
assert.equal(await scalar(`SELECT strikes FROM account_profiles WHERE user_id=$1`, [s3.id]), 1);
const banS3 = await moderate(moderator, await reportOn(s3.live), "ban");
await approve(governor, banS3.decision_id);
await moderate(moderator, await reportOn(s3.pending), "warn");
assert.equal(await statusOf(s3.id), "banned", "a later warning keeps the ban");

// ── Two restrictions: lifting one keeps the other's effects ─────────────────
const s4 = await seller();
const susp = await moderate(moderator, await reportOn(s4.live), "suspend", { days: 10 });
await approve(governor, susp.decision_id);
const ban4 = await moderate(moderator, await reportOn(s4.pending), "ban");
await approve(admin, ban4.decision_id);
const suspRestriction = await scalar(`SELECT id FROM account_restrictions WHERE decision_id=$1`, [
  susp.decision_id,
]);
const banRestriction = await scalar(`SELECT id FROM account_restrictions WHERE decision_id=$1`, [
  ban4.decision_id,
]);
assert.equal(
  (
    await call(`SELECT public.lift_restriction($1,$2,'Suspension served early') AS result`, [
      governor,
      suspRestriction,
    ])
  ).error,
  "not_independent"
);
r = await call(`SELECT public.lift_restriction($1,$2,'Suspension served early') AS result`, [
  governor2,
  suspRestriction,
]);
assert.equal(r.status, "lifted");
assert.equal(await statusOf(s4.id), "banned");
assert.equal(await listingStatus(s4.live), "suspended", "still hidden while the ban stands");
await call(`SELECT public.lift_restriction($1,$2,'Ban reversed after review') AS result`, [
  governor2,
  banRestriction,
]);
assert.equal(await statusOf(s4.id), "active");
assert.equal(await listingStatus(s4.live), "live");

// ── Expiry: suspensions end, ended listings stay hidden ─────────────────────
const s5 = await seller();
await db.query(`UPDATE listings SET expires_at = now() + interval '1 day' WHERE id=$1`, [s5.live]);
const s5Other = await scalar(
  `INSERT INTO listings(owner_id,status) VALUES ($1,'live') RETURNING id`,
  [s5.id]
);
const susp5 = await moderate(moderator, await reportOn(s5.live), "suspend", { days: 3 });
await approve(governor, susp5.decision_id);
await db.query(
  `UPDATE account_restrictions SET ends_at = now() - interval '1 minute' WHERE decision_id=$1`,
  [susp5.decision_id]
);
await db.query(`SELECT set_config('test.role','service_role',false)`);
await db.query(`ALTER TABLE listings DISABLE TRIGGER trg_listings_status_transition`);
await db.query(`UPDATE listings SET expires_at = now() - interval '1 hour' WHERE id=$1`, [s5.live]);
await db.query(`ALTER TABLE listings ENABLE TRIGGER trg_listings_status_transition`);
await db.query(`SELECT set_config('test.role','',false)`);
r = await scalar(`SELECT public.expire_due_items()`);
assert.equal(r.lifted, 1);
assert.equal(await statusOf(s5.id), "active");
assert.equal(await listingStatus(s5Other), "live");
assert.equal(
  await listingStatus(s5.live),
  "hidden",
  "a listing whose period ended is not republished"
);
assert.equal(
  await scalar(`SELECT revert_outcome FROM content_effects WHERE row_id=$1`, [s5.live]),
  "kept_hidden:listing_period_ended"
);
assert(await scalar(`SELECT last_run_at FROM ops_heartbeats WHERE name='expire_due_items'`));

// ── Emergency containment ───────────────────────────────────────────────────
const s6 = await seller();
const rep6 = await reportOn(s6.live);
assert.equal((await moderate(moderator, rep6, "ban", { emergency: true })).error, "forbidden");
r = await moderate(governor, rep6, "ban", { emergency: true });
assert.equal(r.status, "emergency_applied");
assert.equal(await statusOf(s6.id), "suspended");
assert.equal((await approve(governor, r.review_decision_id)).error, "not_independent");
assert.equal((await approve(governor2, r.review_decision_id)).status, "applied");
assert.equal(await statusOf(s6.id), "banned");
assert.equal(await listingStatus(s6.live), "suspended");
assert.equal(
  await scalar(
    `SELECT count(*)::int FROM account_restrictions WHERE user_id=$1 AND lifted_at IS NULL`,
    [s6.id]
  ),
  1,
  "the containment is replaced, not stacked"
);

const s7 = await seller();
r = await moderate(admin, await reportOn(s7.live), "suspend", { days: 14, emergency: true });
await db.query(
  `UPDATE account_restrictions SET ends_at = now() - interval '1 minute' WHERE decision_id=$1`,
  [r.decision_id]
);
await db.query(`UPDATE decision_records SET expires_at = now() - interval '1 minute' WHERE id=$1`, [
  r.review_decision_id,
]);
await scalar(`SELECT public.expire_due_items()`);
assert.equal(await statusOf(s7.id), "active", "unconfirmed containment lapses");
assert.equal(await listingStatus(s7.live), "live");
assert.equal(
  await scalar(`SELECT status::text FROM decision_records WHERE id=$1`, [r.review_decision_id]),
  "expired"
);

// Rejecting an emergency review ends the containment at once.
const s8 = await seller();
const rep8 = await reportOn(s8.live);
r = await moderate(governor, rep8, "suspend", { days: 5, emergency: true });
assert.equal((await reject(admin, r.review_decision_id)).status, "rejected");
assert.equal(await statusOf(s8.id), "active");
assert.equal(
  await scalar(`SELECT status::text FROM reports WHERE id=$1`, [rep8]),
  "open",
  "the report returns to the queue"
);

// ── Hiding one item; moderators cannot hide ─────────────────────────────────
const s9 = await seller();
const rep9 = await reportOn(s9.live);
assert.equal((await moderate(moderator, rep9, "hide")).error, "forbidden");
r = await moderate(governor, rep9, "hide");
assert.equal(await listingStatus(s9.live), "suspended");
assert.equal(await statusOf(s9.id), "active");
const hideAppeal = await appeal(s9.id, r.decision_id);
assert.equal((await resolve(admin, hideAppeal.appeal_id, "overturned")).status, "overturned");
assert.equal(await listingStatus(s9.live), "live");

// ── Partial overturn shortens a suspension ──────────────────────────────────
const s10 = await seller();
const susp10 = await moderate(moderator, await reportOn(s10.live), "suspend", { days: 20 });
await approve(governor, susp10.decision_id);
const a10 = await appeal(s10.id, susp10.decision_id);
const shorter = new Date(Date.now() + 2 * 86_400_000).toISOString();
assert.equal(
  (await resolve(admin, a10.appeal_id, "partially_overturned")).error,
  "shorten_to_required"
);
assert.equal(
  (await resolve(admin, a10.appeal_id, "partially_overturned", shorter)).status,
  "partially_overturned"
);
assert.equal(
  new Date(
    await scalar(`SELECT suspended_until FROM account_profiles WHERE user_id=$1`, [s10.id])
  ).toISOString(),
  shorter
);

// ── Withdrawal and rejection send the report back ───────────────────────────
const s11 = await seller();
const rep11 = await reportOn(s11.live);
r = await moderate(moderator, rep11, "ban");
assert.equal((await reject(moderator, r.decision_id)).status, "withdrawn");
assert.equal(await scalar(`SELECT status::text FROM reports WHERE id=$1`, [rep11]), "open");

// ── Atomicity: a failed audit write leaves nothing applied ──────────────────
const s12 = await seller();
r = await moderate(moderator, await reportOn(s12.live), "ban");
await db.exec(
  `ALTER TABLE audit_logs ADD CONSTRAINT test_block_ban CHECK (action <> 'account_banned') NOT VALID`
);
await assert.rejects(approve(governor, r.decision_id), /test_block_ban/);
assert.equal(await statusOf(s12.id), "active");
assert.equal(await listingStatus(s12.live), "live");
assert.equal(
  await scalar(`SELECT count(*)::int FROM account_restrictions WHERE decision_id=$1`, [
    r.decision_id,
  ]),
  0
);
await db.exec(`ALTER TABLE audit_logs DROP CONSTRAINT test_block_ban`);
assert.equal(
  (await approve(governor, r.decision_id)).status,
  "applied",
  "and can be approved again"
);

// ── KYC override execution tracking ─────────────────────────────────────────
const kycUser = await person("member");
const stepId = uuid();
const proposeKyc = (actor, user = kycUser) =>
  call(
    `SELECT public.propose_kyc_override($1,$2,$3,'high','verified_in_person','Checked the original ID') AS result`,
    [actor, stepId, user]
  );
assert.equal(
  (await proposeKyc(moderator, moderator)).error,
  "not_independent",
  "staff cannot override their own KYC"
);
assert.equal((await proposeKyc(kycUser)).error, "forbidden", "members cannot propose overrides");
r = await proposeKyc(moderator);
assert.equal(r.status, "proposed");
const kyc = r.decision_id;
assert.equal((await proposeKyc(governor2)).error, "pending_exists");
assert.equal((await approve(moderator, kyc)).error, "forbidden");
r = await approve(governor, kyc);
assert.equal(r.execution, "pending");
await asService(() =>
  db.query(`SELECT public.mark_decision_execution($1,false,'upstream timeout')`, [kyc])
);
assert.equal(
  await scalar(`SELECT execution_status FROM decision_records WHERE id=$1`, [kyc]),
  "failed"
);
assert.equal(
  await scalar(`SELECT count(*)::int FROM ops_events WHERE kind='decision_execution_failed'`),
  1
);
await asService(() => db.query(`SELECT public.mark_decision_execution($1,true,NULL)`, [kyc]));
assert.equal(
  await scalar(`SELECT execution_status FROM decision_records WHERE id=$1`, [kyc]),
  "succeeded"
);

// ── Operation jobs retry, die, alert, and can be retried by an admin ────────
const jobs = await asService(
  async () => (await db.query(`SELECT * FROM public.claim_operation_jobs(50)`)).rows
);
assert(jobs.length > 0);
const job = jobs[0].id;
await db.query(`UPDATE operation_jobs SET max_attempts = 1 WHERE id=$1`, [job]);
assert.equal(
  await call(`SELECT public.complete_operation_job($1,false,'smtp down') AS result`, [job]),
  "dead"
);
assert.equal(
  await scalar(`SELECT count(*)::int FROM ops_events WHERE kind='operation_job_dead'`),
  1
);
assert.equal(
  (await call(`SELECT public.retry_operation_job($1,$2) AS result`, [governor, job])).error,
  "forbidden"
);
assert.equal(
  (await call(`SELECT public.retry_operation_job($1,$2) AS result`, [admin, job])).status,
  "pending"
);
const again = await asService(
  async () => (await db.query(`SELECT id FROM public.claim_operation_jobs(50)`)).rows
);
assert(again.some((j) => j.id === job));
assert.equal(
  await call(`SELECT public.complete_operation_job($1,true,NULL) AS result`, [job]),
  "succeeded"
);

// ── Retention and redaction are the only ways to change audit rows ──────────
const oldRow = await scalar(
  `INSERT INTO audit_logs(actor_id,actor_role,action,target_type,target_id,metadata,created_at)
   VALUES ($1,'member','old_event','user',$1,'{}', now() - interval '25 months') RETURNING id`,
  [stranger]
);
await db.query(
  `INSERT INTO audit_logs(actor_id,actor_role,action,target_type,target_id,metadata)
   VALUES ($1,'member','contact','user',$1,'{"email":"a@b.co","channel":"email"}')`,
  [stranger]
);
assert.equal(await call(`SELECT public.purge_expired_audit_logs() AS result`), 1);
assert.equal(await scalar(`SELECT count(*)::int FROM audit_logs WHERE id=$1`, [oldRow]), 0);
assert.equal(
  await call(`SELECT public.redact_personal_audit_data($1,'Account deleted') AS result`, [
    stranger,
  ]),
  1
);
assert.deepEqual(
  await scalar(`SELECT metadata FROM audit_logs WHERE actor_id=$1 AND action='contact'`, [
    stranger,
  ]),
  { channel: "email" }
);

// ── Members cannot call any of it ───────────────────────────────────────────
await db.exec(`SET ROLE authenticated`);
for (const sql of [
  `SELECT public.moderate_report('${uuid()}','${uuid()}','ban','x')`,
  `SELECT public.approve_decision('${uuid()}','${uuid()}',1,'x')`,
  `SELECT public.submit_appeal('${uuid()}','${uuid()}','x')`,
  `SELECT public.expire_due_items()`,
]) {
  await assert.rejects(db.query(sql), /permission denied/);
}
await db.exec(`RESET ROLE`);

console.log("Decision execution layer checks passed.");

// ── Reports are written only by the report route (service role) ─────────────
// Production state before 20260930120000: RLS on, table grants to the API
// roles, and the reporter-only insert policy from 20260318140000.
await db.exec(`ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
  GRANT SELECT, INSERT, UPDATE, DELETE ON reports TO anon, authenticated;
  CREATE POLICY reports_insert_authenticated ON public.reports FOR INSERT TO authenticated
    WITH CHECK (reporter_user_id = (SELECT auth.uid()));`);
const directReporter = await person("member");
const forgedReport = `INSERT INTO reports(target_id,target_type,area,category,severity,description,reporter_user_id,reporter_ip_hash,status,assigned_to)
  VALUES ('${uuid()}','listing','MZANSI_MARKET','scam','high','Forged straight through the API','${directReporter}','forged','resolved','${admin}')`;
// The route's insert shape: evidence_urls and a 10-character description.
const routeReport = () =>
  asService(() =>
    db.query(
      `INSERT INTO reports(target_id,target_type,area,category,severity,description,reporter_user_id,reporter_ip_hash,status,evidence_urls)
       VALUES ($1,'listing','MZANSI_MARKET','scam','standard','Short text',$2,'hmac','open',$3)`,
      [uuid(), directReporter, ["https://example.com/a.png"]]
    )
  );
async function asMember(fn) {
  await db.query(`SELECT set_config('test.uid',$1,false)`, [directReporter]);
  await db.exec(`SET ROLE authenticated`);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE`);
    await db.query(`SELECT set_config('test.uid','',false)`);
  }
}
// Before: a member forges a resolved, assigned report; the route's own insert fails.
await asMember(() => db.query(forgedReport));
await assert.rejects(routeReport(), /evidence_urls/);
await migrate(
  "20260930120000_reports_server_writes.sql",
  "20260930120000_reports_server_writes.sql"
);
await asMember(() => assert.rejects(db.query(forgedReport), /permission denied/));
await routeReport();
assert.equal(
  await scalar(
    `SELECT count(*)::int FROM reports WHERE reporter_user_id=$1 AND evidence_urls IS NOT NULL`,
    [directReporter]
  ),
  1,
  "the report route can store evidence"
);
await assert.rejects(
  asService(() =>
    db.query(
      `INSERT INTO reports(target_id,target_type,area,category,severity,description,reporter_ip_hash,evidence_urls)
       VALUES ($1,'listing','MZANSI_MARKET','scam','standard','Too many evidence files',$2,$3)`,
      [uuid(), "hmac", Array(6).fill("https://example.com/a.png")]
    )
  ),
  /reports_evidence_urls_check/
);
console.log("Report write path checks passed.");
