// Isolated PostgreSQL checks for queue claims (many moderators, no collisions).
// PGlite runs one connection, so FOR UPDATE SKIP LOCKED is exercised for
// correctness of the queries, not for true concurrency; disjointness between
// moderators is checked sequentially.
import assert from "node:assert/strict";
import { createAdminDb } from "./lib/admin-db.mjs";

process.on("uncaughtException", (error) => {
  const at = (error.stack ?? "").split(/\r?\n/).find((l) => l.includes("test-queue-claims"));
  console.error(error.message, error.where ?? "", at ?? "");
  process.exit(1);
});

const { db, uuid, person, rows, scalar, asService, call, migrate } = await createAdminDb();

const admin = await person("admin");
const governor = await person("governance_controller");
const modA = await person("moderator");
const modB = await person("moderator");

await migrate(
  "20260927110000_staff_roles_authority.sql",
  "20260927110100_staff_role_changes.sql",
  "20260927120000_decision_execution_layer.sql",
  "20260928120000_queue_claims.sql"
);

const claim = (actor, queue, limit = 10) =>
  asService(
    async () =>
      (await db.query(`SELECT * FROM public.claim_queue_items($1,$2,$3)`, [actor, queue, limit]))
        .rows
  );
const check = (actor, type, id) =>
  call(`SELECT public.check_queue_claim($1,$2,$3) AS result`, [actor, type, id]);

async function report(severity = "standard", reporter = null, listingOwner = null) {
  const owner = listingOwner ?? (await person("member"));
  const listing = await scalar(
    `INSERT INTO listings(owner_id,status) VALUES ($1,'live') RETURNING id`,
    [owner]
  );
  return scalar(
    `INSERT INTO reports(target_id,target_type,area,category,severity,description,reporter_user_id,reporter_ip_hash)
     VALUES ($1,'listing','MZANSI_MARKET','scam',$2,'This listing asks for payment outside the platform',$3,'h') RETURNING id`,
    [listing, severity, reporter]
  );
}

// ── Reports: high severity first, disjoint between moderators ─────────────
await report("standard");
const high1 = await report("high");
await report("standard");
const ownReport = await report("high", modB); // modB filed this one
const aboutModB = await report("high", null, modB); // and this one is about modB's listing

let a = await claim(modA, "reports", 2);
assert.equal(a[0].item_id, high1, "high severity comes first");
assert.equal(a.length, 2);
let b = await claim(modB, "reports", 10);
const aIds = new Set(a.map((c) => c.item_id));
assert(
  b.every((c) => !aIds.has(c.item_id)),
  "moderators never receive the same item"
);
assert(!b.some((c) => c.item_id === ownReport), "nobody claims a report they filed");
assert(!b.some((c) => c.item_id === aboutModB), "nobody claims a report about themselves");
assert(
  (await rows(`SELECT item_id FROM queue_claims`)).length >= 4,
  "all five reports are now claimed by someone"
);

// ── Deciding needs your own claim ──────────────────────────────────────────
assert.deepEqual(await check(modA, "report", high1), { ok: true, claimed: true });
assert.equal((await check(modB, "report", high1)).error, "claimed_by_other");
const unclaimed = await report("standard");
assert.equal(
  (await check(modA, "report", unclaimed)).error,
  "claim_required",
  "moderators work from claims"
);
assert.deepEqual(await check(governor, "report", unclaimed), { ok: true, claimed: false });
assert.equal(
  (await check(admin, "report", high1)).error,
  "claimed_by_other",
  "not even admins act on a held item"
);
assert.equal((await check(modB, "report", ownReport)).error, "not_independent");

// Release after deciding: only the holder's claim goes.
assert.equal(
  await call(`SELECT public.release_queue_claims($1,'report',$2) AS result`, [modB, high1]),
  0
);
assert.equal(
  await call(`SELECT public.release_queue_claims($1,'report',$2) AS result`, [modA, high1]),
  1
);
assert.equal(await scalar(`SELECT count(*)::int FROM queue_claims WHERE item_id=$1`, [high1]), 0);

// ── Expiry, renewal, personal cap ──────────────────────────────────────────
await db.query(
  `UPDATE queue_claims SET expires_at = now() - interval '1 second' WHERE claimed_by=$1`,
  [modA]
);
assert.equal(
  (await check(modA, "report", a[1].item_id)).error,
  "claim_required",
  "an expired claim is no claim"
);
const adminClaims = await claim(admin, "reports", 25);
assert(
  adminClaims.some((c) => c.item_id === a[1].item_id),
  "expired items return to the queue"
);
await call(`SELECT public.release_queue_claims($1,NULL,NULL) AS result`, [admin]);
b = await claim(modB, "reports", 10);

assert.equal((await call(`SELECT public.renew_queue_claims($1) AS result`, [modB])) > 0, true);
await db.query(`UPDATE queue_claims SET renewals = 4 WHERE claimed_by=$1`, [modB]);
assert.equal(
  await call(`SELECT public.renew_queue_claims($1) AS result`, [modB]),
  0,
  "at most 4 renewals"
);

for (let i = 0; i < 25; i += 1) await report("standard");
const big = await claim(modA, "reports", 25);
assert.equal(big.length, 20, "at most 20 active claims per person");
assert.equal((await claim(modA, "reports", 5)).length, 0);
await call(`SELECT public.release_queue_claims($1,NULL,NULL) AS result`, [modA]);

// ── Governors cannot claim; they free or reassign, with a reason ───────────
await assert.rejects(claim(governor, "reports"), /claim_forbidden/);
const held = b[0].item_id;
assert.equal(
  (
    await call(`SELECT public.reassign_queue_claim($1,'report',$2,$3,'x') AS result`, [
      governor,
      held,
      modA,
    ])
  ).error,
  "reason_required"
);
assert.equal(
  (
    await call(
      `SELECT public.reassign_queue_claim($1,'report',$2,$3,'Moderator is off sick') AS result`,
      [modA, held, modA]
    )
  ).error,
  "forbidden"
);
assert.equal(
  (
    await call(
      `SELECT public.reassign_queue_claim($1,'report',$2,$3,'Moderator is off sick') AS result`,
      [governor, held, modA]
    )
  ).status,
  "reassigned"
);
assert.equal(await scalar(`SELECT claimed_by FROM queue_claims WHERE item_id=$1`, [held]), modA);
assert.equal(
  (
    await call(
      `SELECT public.reassign_queue_claim($1,'report',$2,$3,'Balance the load') AS result`,
      [governor, ownReport, modB]
    )
  ).error,
  "not_claimed"
);
assert.equal(
  await scalar(`SELECT count(*)::int FROM audit_logs WHERE action='queue_claim_reassigned'`),
  1
);

// ── KYC: highest risk first, never your own ────────────────────────────────
const applicant = await person("member");
const low = await scalar(
  `INSERT INTO verification_steps(user_id,step_type,risk_level) VALUES ($1,'selfie','low') RETURNING id`,
  [applicant]
);
const critical = await scalar(
  `INSERT INTO verification_steps(user_id,step_type,risk_level) VALUES ($1,'id_doc','critical') RETURNING id`,
  [applicant]
);
await scalar(
  `INSERT INTO verification_steps(user_id,step_type,risk_level,status) VALUES ($1,'location','low','pending') RETURNING id`,
  [applicant]
);
const mine = await scalar(
  `INSERT INTO verification_steps(user_id,step_type,risk_level) VALUES ($1,'id_doc','critical') RETURNING id`,
  [modB]
);
const kyc = await claim(modB, "kyc", 5);
assert.deepEqual(
  kyc.map((c) => c.item_id),
  [critical, low],
  "risk order, no location steps, not their own"
);
assert(!kyc.some((c) => c.item_id === mine));

// ── Content: all tables and edit requests, oldest first ────────────────────
const seller = await person("member");
const oldListing = await scalar(
  `INSERT INTO listings(owner_id,status) VALUES ($1,'pending_moderation') RETURNING id`,
  [seller]
);
await db.query(`UPDATE listings SET owner_id = owner_id WHERE id=$1`, [oldListing]);
const promo = await scalar(
  `INSERT INTO promotions(owner_id,status) VALUES ($1,'pending_moderation') RETURNING id`,
  [seller]
);
const edit = await scalar(`INSERT INTO content_edit_requests(owner_id) VALUES ($1) RETURNING id`, [
  seller,
]);
const ownPending = await scalar(
  `INSERT INTO listings(owner_id,status) VALUES ($1,'pending_moderation') RETURNING id`,
  [modA]
);
const content = await claim(modA, "content", 10);
assert.deepEqual(
  new Set(content.map((c) => `${c.item_type}:${c.item_id}`)),
  new Set([`listing:${oldListing}`, `promotion:${promo}`, `content_edit:${edit}`])
);
assert(!content.some((c) => c.item_id === ownPending));

// ── Business verification queue: red findings first, never your own ──────
await db.exec(`CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$`);
await migrate(
  "20261006124457_business_verifications.sql",
  "20261006124608_business_verification_queue.sql"
);
async function bvCase(owner, findings) {
  const biz = await scalar(
    `INSERT INTO businesses(owner_id,status) VALUES ($1,'live') RETURNING id`,
    [owner]
  );
  return scalar(
    `INSERT INTO business_verifications(business_id,owner_id,kind,registration_number,findings)
     VALUES ($1,$2,'cipc','2020/123456/07',$3::jsonb) RETURNING id`,
    [biz, owner, JSON.stringify(findings)]
  );
}
const calmCase = await bvCase(seller, [{ severity: "ok" }]);
const redCase = await bvCase(await person("member"), [
  { severity: "attention" },
  { severity: "attention" },
]);
const modBCase = await bvCase(modB, [{ severity: "attention" }]);
await db.query(`UPDATE business_verifications SET status='info_requested' WHERE id=$1`, [calmCase]);
const bv = await claim(modB, "business_kyc", 10);
assert.deepEqual(
  bv.map((c) => c.item_id),
  [redCase],
  "pending only, red first, never the moderator's own case, not waiting on the owner"
);
assert.equal(bv[0].item_type, "business_verification");
assert.equal((await check(modB, "business_verification", modBCase)).error, "not_independent");
const navCounts = await call(`SELECT public.staff_nav_counts($1) AS result`, [modB]);
assert.equal(navCounts.business_kyc, 2);

// ── Losing staff access releases claims ────────────────────────────────────
assert((await scalar(`SELECT count(*)::int FROM queue_claims WHERE claimed_by=$1`, [modA])) > 0);
await call(`SELECT public.propose_staff_role_change($1,$2,'member','Left the team') AS result`, [
  admin,
  modA,
]);
assert.equal(await scalar(`SELECT count(*)::int FROM queue_claims WHERE claimed_by=$1`, [modA]), 0);
await assert.rejects(claim(modA, "content"), /claim_forbidden/);

// ── Expiry job and member access ───────────────────────────────────────────
await db.query(`UPDATE queue_claims SET expires_at = now() - interval '1 second'`);
assert((await call(`SELECT public.expire_queue_claims() AS result`)) > 0);
assert.equal(await scalar(`SELECT count(*)::int FROM queue_claims`), 0);
await db.exec(`SET ROLE authenticated`);
await assert.rejects(
  db.query(`SELECT * FROM public.claim_queue_items('${uuid()}','reports',5)`),
  /permission denied/
);
await db.exec(`RESET ROLE`);

console.log("Queue claim checks passed.");
