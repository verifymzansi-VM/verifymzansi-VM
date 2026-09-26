// Isolated PostgreSQL checks for the commercial model (slots, trials, programmes,
// payments). PGlite only: no environment loading, sockets or remote database.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

process.on("uncaughtException", (error) => {
  console.error(error.message, error.where ?? "");
  process.exit(1);
});

const db = new PGlite();
const initial = fs.readFileSync("supabase/migrations/20240101000000_initial_schema.sql", "utf8");
const definition = (pattern) => {
  const match = initial.match(pattern);
  assert(match, `Missing schema definition ${pattern}`);
  return match[0];
};
const migration = (file) => db.exec(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));

await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_app_meta_data jsonb DEFAULT '{}', email text);
${[
  "marketplace_area",
  "listing_status",
  "plan_tier",
  "entitlement_type",
  "entitlement_status",
  "payment_status",
  "user_role",
]
  .map((type) => definition(new RegExp(`CREATE TYPE ${type} AS ENUM \\([\\s\\S]*?;`)))
  .join("\n")}
ALTER TYPE marketplace_area ADD VALUE 'MZANSI_BUSINESS';
ALTER TYPE marketplace_area ADD VALUE 'PROMOTIONS_EVENTS';
ALTER TYPE entitlement_status ADD VALUE 'pending_verification';
ALTER TYPE plan_tier ADD VALUE 'basic';
ALTER TYPE user_role ADD VALUE 'member';
ALTER TYPE payment_status ADD VALUE 'processing';
ALTER TYPE payment_status ADD VALUE 'expired';`);
await db.exec(`
${["plans", "entitlements", "payments", "invoices", "audit_logs"]
  .map((table) => definition(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`)))
  .join("\n")}
CREATE UNIQUE INDEX entitlements_key ON entitlements(user_id,area,type);
CREATE UNIQUE INDEX invoices_payment_key ON invoices(payment_id);
ALTER TABLE payments ADD COLUMN provider text, ADD COLUMN provider_payment_id text,
 ADD COLUMN provider_reference text, ADD COLUMN provider_data jsonb;
CREATE FUNCTION public.has_role(r text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
 SELECT COALESCE((SELECT raw_app_meta_data->>'role' = r FROM auth.users WHERE id = auth.uid()), false) $$;
CREATE FUNCTION public.has_any_role(r text[]) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
 SELECT COALESCE((SELECT raw_app_meta_data->>'role' = ANY(r) FROM auth.users WHERE id = auth.uid()), false) $$;
CREATE TABLE account_profiles(user_id uuid PRIMARY KEY, account_verification_status text, account_status text, phone text, display_name text, legal_first_name text DEFAULT 'Thando', legal_last_name text DEFAULT 'Mkhize');
CREATE TABLE verification_steps(user_id uuid, step_type text, status text, id_number_hmac text);
CREATE TABLE media_uploads(id uuid DEFAULT gen_random_uuid(), user_id uuid, file_size integer);
CREATE TABLE free_posts_used(user_id uuid, area marketplace_area, content_id uuid, release_reason text, released_at timestamptz);
CREATE TABLE notifications(id uuid DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, href text, created_at timestamptz DEFAULT now());
CREATE TABLE listings(id uuid PRIMARY KEY, owner_id uuid, area marketplace_area, status listing_status NOT NULL DEFAULT 'draft',
 expires_at timestamptz, status_reason text, boost_until timestamptz, featured_until timestamptz, urgent_until timestamptz,
 featured boolean DEFAULT false, urgent boolean DEFAULT false, photos text[] DEFAULT '{}', videos text[] DEFAULT '{}');
CREATE TABLE businesses(LIKE listings INCLUDING ALL);
ALTER TABLE businesses ADD COLUMN business_name text DEFAULT 'Test Business', ADD COLUMN slug text, ADD COLUMN category text DEFAULT 'trade_maintenance',
 ADD COLUMN subcategory text, ADD COLUMN location_city text DEFAULT 'Richards Bay', ADD COLUMN location_province text DEFAULT 'KwaZulu-Natal',
 ADD COLUMN logo_url text, ADD COLUMN cover_photo text, ADD COLUMN phone text DEFAULT '+27350000000', ADD COLUMN email text, ADD COLUMN website text;
CREATE TABLE promotions(id uuid PRIMARY KEY, owner_id uuid, status text NOT NULL DEFAULT 'draft'
 CHECK (status IN ('draft','pending_moderation','flagged_for_review','live','hidden','expired','rejected')),
 promotion_type text DEFAULT 'general', expires_at timestamptz, status_reason text, end_date timestamptz,
 boost_until timestamptz, featured_until timestamptz, urgent_until timestamptz, photos text[] DEFAULT '{}', videos text[] DEFAULT '{}');
CREATE FUNCTION public.validate_listing_status_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_listings_status_transition BEFORE UPDATE OF status ON listings FOR EACH ROW EXECUTE FUNCTION validate_listing_status_transition();
CREATE TRIGGER trg_businesses_status_transition BEFORE UPDATE OF status ON businesses FOR EACH ROW EXECUTE FUNCTION validate_listing_status_transition();
CREATE TRIGGER trg_promotions_status_transition BEFORE UPDATE OF status ON promotions FOR EACH ROW EXECUTE FUNCTION validate_listing_status_transition();
SET test.role='service_role';`);

for (const f of [
  "20260906041522_introductory_trials.sql",
  "20260906041543_trial_management_and_renewal.sql",
  "20260906041600_paid_capacity_for_retained_posts.sql",
  "20260920100000_account_free_posts.sql",
  "20260920110000_account_trials_30_days_email_search.sql",
  "20260925090000_commercial_model_enums.sql",
])
  await migration(f);

const scalar = async (sql, args) => (await db.query(sql, args)).rows[0];
const uuid = () => crypto.randomUUID();
async function user(role = "member", h = uuid()) {
  const id = uuid();
  await db.query(`INSERT INTO auth.users(id,raw_app_meta_data) VALUES($1,$2)`, [id, { role }]);
  await db.query(
    `INSERT INTO account_profiles(user_id,account_verification_status,account_status,phone) VALUES($1,'verified','active','+27712345678')`,
    [id]
  );
  for (const step of ["phone", "id_doc", "selfie", "location"])
    await db.query(`INSERT INTO verification_steps VALUES($1,$2,'approved',$3)`, [
      id,
      step,
      step === "id_doc" ? h : null,
    ]);
  return id;
}

// ── Legacy customer seeded before the commercial migration ───────────────
await db.exec(`INSERT INTO plans(area,tier,name,price_cents,features,active) VALUES
 ('MZANSI_MARKET','growth','Growth',25000,'{"maxListings":9,"maxPhotos":10,"maxVideos":9,"videoAllowed":true}',true),
 ('MZANSI_MARKET','pro','Pro',65000,'{"maxListings":27,"maxPhotos":10,"maxVideos":27,"videoAllowed":true}',true)`);
const legacyUser = await user();
const legacyExpiry = "2026-12-01T00:00:00Z";
const legacyPost = uuid();
await db.query(
  `INSERT INTO entitlements(user_id,area,tier,type,status,started_at,expires_at) VALUES($1,'MZANSI_MARKET','growth','subscription','active',now()-interval '5 days',$2)`,
  [legacyUser, legacyExpiry]
);
await db.query(
  `INSERT INTO listings(id,owner_id,area,status,expires_at) VALUES($1,$2,'MZANSI_MARKET','live',$3)`,
  [legacyPost, legacyUser, legacyExpiry]
);

await migration("20260925090100_commercial_foundation.sql");
await migration("20260925090200_organisations.sql");
await migration("20260925090300_partners_analytics_notifications.sql");
await migration("20260925090400_event_archiving.sql");
await migration("20260925090500_commercial_fixes.sql");
await migration("20260925090600_commercial_completion.sql");

let checks = 0;
async function test(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}
async function rejects(promise, pattern) {
  await assert.rejects(promise, (e) => {
    assert.match(e.message, pattern);
    return true;
  });
}
async function post(owner, { table = "listings", area = "MZANSI_MARKET", id = uuid(), type } = {}) {
  if (table === "promotions")
    await db.query(
      `INSERT INTO promotions(id,owner_id,status,promotion_type,end_date) VALUES($1,$2,'pending_moderation',$3,now()+interval '10 days')`,
      [id, owner, type ?? "general"]
    );
  else
    await db.query(
      `INSERT INTO ${table}(id,owner_id,area,status) VALUES($1,$2,$3,'pending_moderation')`,
      [id, owner, area]
    );
  return id;
}
const setStatus = (id, status, table = "listings") =>
  db.query(`UPDATE ${table} SET status=$2 WHERE id=$1`, [id, status]);
const statusOf = async (id, table = "listings") =>
  (await scalar(`SELECT status::text AS s FROM ${table} WHERE id=$1`, [id])).s;
const retailPlan = async (code, area = "MZANSI_MARKET") =>
  scalar(`SELECT * FROM plans WHERE plan_code=$1 AND area=$2`, [code, area]);
async function pay(owner, plan) {
  const id = uuid();
  const meta = {
    type: "subscription",
    plan_id: plan.id,
    plan_tier: plan.tier,
    area: plan.area ?? "MZANSI_BUSINESS",
  };
  await db.query(
    `INSERT INTO payments(id,user_id,area,amount_cents,status,provider,provider_data) VALUES($1,$2,$3,$4,'pending','ozow',$5)`,
    [id, owner, plan.area ?? "MZANSI_BUSINESS", plan.price_cents, meta]
  );
  const r = await scalar(`SELECT fulfill_ozow_payment($1,$2,$3,$4,$5,NULL,'{}') AS r`, [
    id,
    "ozow-" + id,
    plan.price_cents,
    meta,
    plan.id,
  ]);
  return { id, result: r.r };
}
const admin = await user("admin");

await test("legacy plans are retired and retail ladder is seeded", async () => {
  const legacy = await scalar(
    `SELECT bool_and(NOT active AND is_legacy) AS ok FROM plans WHERE tier IN ('growth','pro')`
  );
  assert(legacy.ok);
  const retail = (
    await db.query(
      `SELECT plan_code,price_cents,duration_days FROM plans WHERE area='MZANSI_MARKET' AND active ORDER BY sort_order`
    )
  ).rows;
  assert.deepEqual(
    retail.map((r) => [r.plan_code, r.price_cents, r.duration_days]),
    [
      ["RETAIL_30D", 5000, 30],
      ["RETAIL_6M", 25000, 180],
      ["RETAIL_12M", 45000, 365],
    ]
  );
  const ent = await scalar(
    `SELECT count(*)::int AS n FROM plans WHERE tier='enterprise' AND area IS NULL`
  );
  assert.equal(ent.n, 12);
});

await test("legacy entitlement keeps its original expiry and live content", async () => {
  const s = await scalar(`SELECT * FROM slot_entitlements WHERE user_id=$1`, [legacyUser]);
  assert.equal(s.source, "LEGACY_PLAN");
  assert.equal(new Date(s.expires_at).toISOString(), new Date(legacyExpiry).toISOString());
  assert.equal(s.slot_capacity, 9);
  assert.equal(s.max_videos, 9);
  const a = await scalar(
    `SELECT count(*)::int AS n FROM slot_assignments WHERE content_id=$1 AND released_at IS NULL`,
    [legacyPost]
  );
  assert.equal(a.n, 1);
  const e = await scalar(`SELECT status::text, tier::text FROM entitlements WHERE user_id=$1`, [
    legacyUser,
  ]);
  assert.equal(e.status, "active");
  assert.equal(e.tier, "growth");
});

await test("ordinary user: 7-day trial → expiry → R50 → reactivation", async () => {
  const u = await user();
  const id = uuid();
  assert((await scalar(`SELECT reserve_intro_trial($1,'MZANSI_MARKET',$2,7) AS ok`, [u, id])).ok);
  await post(u, { id });
  await setStatus(id, "live");
  const claim = await scalar(`SELECT * FROM intro_trial_claims WHERE content_id=$1`, [id]);
  assert(claim.activated_at);
  assert.equal((await scalar(`SELECT trial_entitlement_for($1) AS k`, [u])).k, "PUBLIC_7_DAY");
  await setStatus(id, "expired");
  assert.equal(await statusOf(id), "expired");
  await rejects(
    db.query(`SELECT owner_content_action($1,'listings',$2,'reactivate')`, [u, id]),
    /TRIAL_EXPIRED/
  );
  await pay(u, await retailPlan("RETAIL_30D"));
  const allowance = (await scalar(`SELECT posting_allowance($1,'MZANSI_MARKET') AS a`, [u])).a;
  assert.equal(allowance.hasPaidPlan, true);
  assert.equal(allowance.capacity, 1);
  await db.query(`SELECT update_own_intro_trial($1,$2,'renew')`, [u, claim.id]);
  assert.equal(await statusOf(id), "live");
  const s = await scalar(
    `SELECT e.expires_at AS ee, l.expires_at AS le FROM slot_assignments a JOIN slot_entitlements e ON e.id=a.entitlement_id JOIN listings l ON l.id=a.content_id WHERE a.content_id=$1 AND a.released_at IS NULL`,
    [id]
  );
  assert.equal(new Date(s.ee).getTime(), new Date(s.le).getTime());
});

await test("30-day trial cannot be claimed twice, even from a second account", async () => {
  const h = uuid();
  const u = await user("member", h);
  const id = uuid();
  assert(
    (await scalar(`SELECT reserve_intro_trial($1,'MZANSI_BUSINESS',$2,30) AS ok`, [u, id])).ok
  );
  await post(u, { id, table: "businesses", area: "MZANSI_BUSINESS" });
  await setStatus(id, "live", "businesses");
  assert.equal((await scalar(`SELECT trial_entitlement_for($1) AS k`, [u])).k, "PUBLIC_30_DAY");
  await setStatus(id, "hidden", "businesses");
  await db.query(`DELETE FROM businesses WHERE id=$1`, [id]);
  assert.equal(
    (await scalar(`SELECT reserve_intro_trial($1,'MZANSI_MARKET',$2,30) AS ok`, [u, uuid()])).ok,
    false
  );
  const clone = await user("member", h);
  assert.equal(
    (await scalar(`SELECT reserve_intro_trial($1,'MZANSI_MARKET',$2,7) AS ok`, [clone, uuid()])).ok,
    false
  );
});

await test("strategic trial: one slot, three activations, no public trial afterwards", async () => {
  const u = await user();
  await db.query(`SET test.role='service_role'`);
  await db.query(
    `SELECT grant_programme_contract($1,$2,'STRATEGIC_INDIVIDUAL','{}','Strong local tourism operator')`,
    [admin, u]
  );
  const e = await scalar(`SELECT * FROM slot_entitlements WHERE user_id=$1`, [u]);
  assert.equal(e.slot_capacity, 1);
  assert.equal(e.activation_limit_total, 3);
  assert(new Date(e.expires_at) - new Date(e.starts_at) >= 89 * 864e5);
  const a = await post(u);
  await setStatus(a, "live");
  await rejects(setStatus(await post(u), "live"), /SLOT_FULL/);
  await db.query(`SELECT owner_content_action($1,'listings',$2,'mark_sold')`, [u, a]);
  assert.equal(await statusOf(a), "sold");
  for (let i = 0; i < 2; i++) {
    const p = await post(u);
    await setStatus(p, "live");
    await db.query(`SELECT owner_content_action($1,'listings',$2,'mark_sold')`, [u, p]);
  }
  await rejects(setStatus(await post(u), "live"), /SLOT_FULL/);
  assert.equal(
    (await scalar(`SELECT reserve_intro_trial($1,'MZANSI_MARKET',$2,7) AS ok`, [u, uuid()])).ok,
    false
  );
});

await test("programmes cannot stack on a used public trial without an audited override", async () => {
  const u = await user();
  const id = uuid();
  await db.query(`SELECT reserve_intro_trial($1,'MZANSI_MARKET',$2,7)`, [u, id]);
  await post(u, { id });
  await setStatus(id, "live");
  await rejects(
    db.query(
      `SELECT grant_programme_contract($1,$2,'STRATEGIC_INDIVIDUAL','{}','Invite after trial')`,
      [admin, u]
    ),
    /PROGRAMME_ALREADY_USED/
  );
  await db.query(
    `SELECT grant_programme_contract($1,$2,'STRATEGIC_INDIVIDUAL','{}','Approved exception by founder',true)`,
    [admin, u]
  );
  const audit = await scalar(
    `SELECT * FROM audit_logs WHERE action='programme_granted' AND target_type='commercial_contract' ORDER BY created_at DESC LIMIT 1`
  );
  assert.equal(audit.previous_value.trialEntitlement, "PUBLIC_7_DAY");
  assert.equal(audit.metadata.override, true);
  await rejects(
    db.query(`SELECT grant_programme_contract($1,$2,'STRATEGIC_INDIVIDUAL','{}','Unauthorised')`, [
      u,
      u,
    ]),
    /permission/
  );
});

await test("founding dealership: 25 live slots, 26th blocked until one is released", async () => {
  const u = await user();
  const cid = (
    await scalar(
      `SELECT grant_programme_contract($1,$2,'FOUNDING_COMMERCIAL_PARTNER','{}','Anchor dealership') AS id`,
      [admin, u]
    )
  ).id;
  const ids = [];
  for (let i = 0; i < 25; i++) {
    const p = await post(u);
    await setStatus(p, "live");
    ids.push(p);
  }
  const extra = await post(u);
  await rejects(setStatus(extra, "live"), /SLOT_FULL/);
  await db.query(`SELECT owner_content_action($1,'listings',$2,'mark_sold')`, [u, ids[0]]);
  await setStatus(extra, "live");
  assert.equal(await statusOf(extra), "live");
  // Delegate administrators post against the same pool, up to the admin limit.
  const d1 = await user();
  const d2 = await user();
  await db.query(
    `SELECT manage_commercial_contract($1,$2,'add_member',$3,'Sales manager access')`,
    [admin, cid, { userId: d1 }]
  );
  await rejects(
    db.query(`SELECT manage_commercial_contract($1,$2,'add_member',$3,'Second manager access')`, [
      admin,
      cid,
      { userId: d2 },
    ]),
    /CONTRACT_ADMIN_LIMIT/
  );
  await rejects(setStatus(await post(d1), "live"), /SLOT_FULL/);
});

await test("activation limit per period is enforced even with free capacity", async () => {
  const u = await user();
  const cid = (
    await scalar(
      `SELECT grant_programme_contract($1,$2,'FOUNDING_COMMERCIAL_PARTNER',$3,'Small activation window') AS id`,
      [admin, u, { activationsPerPeriod: 2, slotCapacity: 5 }]
    )
  ).id;
  for (let i = 0; i < 2; i++) {
    const p = await post(u);
    await setStatus(p, "live");
    await db.query(`SELECT owner_content_action($1,'listings',$2,'mark_sold')`, [u, p]);
  }
  await rejects(setStatus(await post(u), "live"), /SLOT_FULL/);
  await db.query(
    `SELECT manage_commercial_contract($1,$2,'limits',$3,'Approved extra activations')`,
    [admin, cid, { activationsPerPeriod: 3 }]
  );
  await setStatus(await post(u), "live");
});

await test("events are free, need no trial or plan, and are fair-use limited", async () => {
  const u = await user();
  for (let i = 0; i < 5; i++) {
    const e = await post(u, { table: "promotions", type: "event" });
    await setStatus(e, "live", "promotions");
    assert.equal(await statusOf(e, "promotions"), "live");
  }
  await rejects(
    setStatus(await post(u, { table: "promotions", type: "event" }), "live", "promotions"),
    /EVENT_LIMIT/
  );
  await rejects(
    setStatus(await post(u, { table: "promotions" }), "live", "promotions"),
    /TRIAL_REQUIRED/
  );
  assert.equal((await scalar(`SELECT posting_area_used($1,'PROMOTIONS_EVENTS') AS n`, [u])).n, 1);
});

await test("R250 purchase: 6 months, refund withdraws content and entitlement", async () => {
  const u = await user();
  const plan = await retailPlan("RETAIL_6M");
  const { id: paymentId } = await pay(u, plan);
  const s = await scalar(`SELECT * FROM slot_entitlements WHERE payment_id=$1`, [paymentId]);
  assert.equal(s.source, "RETAIL_PAID");
  assert.equal(s.slot_capacity, 1);
  assert.equal(Math.round((new Date(s.expires_at) - new Date(s.starts_at)) / 864e5), 180);
  const p = await post(u);
  await setStatus(p, "live");
  assert.equal(
    (await pay(u, plan).catch(() => ({ result: { outcome: "second" } }))).result.outcome,
    "completed"
  );
  await rejects(
    db.query(`SELECT reverse_payment($1,$2,'refunded','x')`, [admin, paymentId]),
    /reason/
  );
  await db.query(`SELECT reverse_payment($1,$2,'refunded','Customer refund approved')`, [
    admin,
    paymentId,
  ]);
  assert.equal(
    (await scalar(`SELECT status::text AS s FROM payments WHERE id=$1`, [paymentId])).s,
    "refunded"
  );
  assert.equal(
    (await scalar(`SELECT status FROM slot_entitlements WHERE payment_id=$1`, [paymentId])).status,
    "revoked"
  );
  // The second purchase still covers the area, so the content is expired only once.
  assert.equal(await statusOf(p), "expired");
});

await test("paid posts cannot be fulfilled at a tampered price; duplicates are idempotent", async () => {
  const u = await user();
  const plan = await retailPlan("RETAIL_12M", "PROMOTIONS_EVENTS");
  const { id, result } = await pay(u, plan);
  assert.equal(result.outcome, "completed");
  const again = await scalar(`SELECT fulfill_ozow_payment($1,$2,$3,$4,$5,NULL,'{}') AS r`, [
    id,
    "ozow-" + id,
    plan.price_cents,
    { type: "subscription", plan_id: plan.id, plan_tier: plan.tier, area: plan.area },
    plan.id,
  ]);
  assert.equal(again.r.outcome, "duplicate");
  await rejects(
    db.query(`SELECT fulfill_ozow_payment($1,'x',$2,'{}','${plan.id}',NULL,'{}')`, [id, 100]),
    /amount mismatch/
  );
});

await test("enterprise plan covers every area", async () => {
  const u = await user();
  const plan = await scalar(`SELECT * FROM plans WHERE plan_code='ENT_50_3M'`);
  await pay(u, plan);
  for (const area of ["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"]) {
    const a = (await scalar(`SELECT posting_allowance($1,$2) AS a`, [u, area])).a;
    assert.equal(a.capacity, 50);
  }
});

await test("staff bypass slots; commercial settings are admin-only and audited", async () => {
  const mod = await user("moderator");
  const p = await post(mod);
  await setStatus(p, "live");
  await rejects(
    db.query(
      `SELECT update_commercial_setting($1,'partner','{"commissionBps":3000}','Moderator attempt')`,
      [mod]
    ),
    /permission/
  );
  await db.query(
    `SELECT update_commercial_setting($1,'partner','{"commissionBps":2500,"pendingDays":30}','Board approved rate')`,
    [admin]
  );
  assert.equal(
    (await scalar(`SELECT commercial_setting_int('partner','commissionBps',0) AS v`)).v,
    2500
  );
  const log = await scalar(`SELECT * FROM audit_logs WHERE action='commercial_setting_updated'`);
  assert.equal(log.previous_value.commissionBps, 2000);
  assert.equal(log.actor_role, "admin");
});

await test("trial durations come from commercial settings", async () => {
  await db.query(
    `SELECT update_commercial_setting($1,'trials','{"shortDays":5,"longDays":30}','Shorter trial experiment')`,
    [admin]
  );
  const u = await user();
  const id = uuid();
  await db.query(`SELECT reserve_intro_trial($1,'MZANSI_MARKET',$2,7)`, [u, id]);
  await post(u, { id });
  await setStatus(id, "live");
  const l = await scalar(`SELECT expires_at FROM listings WHERE id=$1`, [id]);
  assert.equal(Math.round((new Date(l.expires_at) - Date.now()) / 864e5), 5);
});

// ── Organisations ────────────────────────────────────────────────────────
async function business(owner) {
  const id = uuid();
  await db.query(
    `INSERT INTO businesses(id,owner_id,area,status,slug) VALUES($1,$2,'MZANSI_BUSINESS','draft',$3)`,
    [id, owner, "b-" + id.slice(0, 8)]
  );
  return id;
}
const orgAdmin = await user();
const orgId = (
  await scalar(`SELECT admin_upsert_organisation($1,NULL,$2,'Founding pilot invitation') AS id`, [
    admin,
    {
      slug: "city-of-xyz",
      name: "City of XYZ",
      organisationType: "municipality",
      sponsoredCapacity: 2,
    },
  ])
).id;
await db.query(`SELECT admin_manage_organisation($1,$2,'activate_trial','{}','Signed MOU')`, [
  admin,
  orgId,
]);
await db.query(`SELECT admin_manage_organisation($1,$2,'add_admin',$3,'Nominated LED official')`, [
  admin,
  orgId,
  { userId: orgAdmin },
]);
await db.query(
  `SELECT admin_upsert_organisation($1,$2,'{"isPublic":true,"logoUrl":"https://cdn.example/xyz.png"}','Publish profile')`,
  [admin, orgId]
);
const consent = { accepted: true, shareRepresentativeName: false };
async function apply(owner, biz) {
  return (
    await scalar(
      `SELECT submit_affiliation_application($1,$2,$3,NULL,'SMME programme member','SMME-001',$4) AS id`,
      [owner, biz, orgId, consent]
    )
  ).id;
}

await test("founding organisation trial is six months with no auto-renewal", async () => {
  const o = await scalar(`SELECT * FROM organisations WHERE id=$1`, [orgId]);
  assert.equal(o.programme_status, "founding_trial");
  assert.equal(Math.round((new Date(o.trial_ends_at) - new Date(o.trial_starts_at)) / 864e5), 180);
  const c = await scalar(`SELECT * FROM commercial_contracts WHERE id=$1`, [o.contract_id]);
  assert.equal(c.auto_renew, false);
});

await test("affiliation: consent required, owner only, minimal data to organisation", async () => {
  const owner = await user();
  const biz = await business(owner);
  await rejects(
    db.query(
      `SELECT submit_affiliation_application($1,$2,$3,NULL,NULL,NULL,'{"accepted":false}')`,
      [owner, biz, orgId]
    ),
    /CONSENT_REQUIRED/
  );
  const stranger = await user();
  await rejects(
    db.query(`SELECT submit_affiliation_application($1,$2,$3,NULL,NULL,NULL,$4)`, [
      stranger,
      biz,
      orgId,
      consent,
    ]),
    /NOT_OWNER/
  );
  const app = await apply(owner, biz);
  await rejects(apply(owner, biz), /AFFILIATION_PENDING/);
  const rows = (await db.query(`SELECT * FROM org_list_applications($1,$2)`, [orgAdmin, orgId]))
    .rows;
  const row = rows.find((r) => r.id === app);
  assert.equal(row.identity_verified, true);
  assert.equal(row.representative_name, null);
  assert(!Object.keys(row).some((k) => /hmac|selfie|document|risk/.test(k)));
  await rejects(
    db.query(`SELECT * FROM org_list_applications($1,$2)`, [stranger, orgId]),
    /Organisation access required/
  );
  await db.query(
    `SELECT org_decide_application($1,$2,'request_info','Please share your CSD number')`,
    [orgAdmin, app]
  );
  await db.query(`SELECT member_affiliation_action($1,$2,'respond','CSD MAAA000123')`, [
    owner,
    app,
  ]);
  await db.query(`SELECT org_decide_application($1,$2,'approve','Confirmed on register')`, [
    orgAdmin,
    app,
  ]);
  let chip = await scalar(`SELECT * FROM public_business_affiliations($1)`, [[biz]]);
  assert.equal(chip.label, "Programme Participant");
  assert.equal(chip.logo_url, null);
  assert.equal(chip.sponsored, false);
  await db.query(
    `SELECT admin_manage_organisation($1,$2,'approve_logo','{"reference":"Letter 2026-09-25"}','Written logo permission')`,
    [admin, orgId]
  );
  chip = await scalar(`SELECT * FROM public_business_affiliations($1)`, [[biz]]);
  assert.equal(chip.logo_url, "https://cdn.example/xyz.png");
  assert.equal((await scalar(`SELECT trial_entitlement_for($1) AS k`, [owner])).k, "NONE");
});

await test("declined business stays fully usable on its own plan", async () => {
  const owner = await user();
  const biz = await business(owner);
  const app = await apply(owner, biz);
  await db.query(`SELECT org_decide_application($1,$2,'decline','Not on programme register')`, [
    orgAdmin,
    app,
  ]);
  await pay(owner, await retailPlan("RETAIL_30D", "MZANSI_BUSINESS"));
  await setStatus(biz, "pending_moderation", "businesses");
  await setStatus(biz, "live", "businesses");
  assert.equal(await statusOf(biz, "businesses"), "live");
  assert.equal(
    (await db.query(`SELECT * FROM public_business_affiliations($1)`, [[biz]])).rows.length,
    0
  );
});

await test("sponsored capacity is capped; overflow waits; ending keeps affiliation", async () => {
  const members = [];
  for (let i = 0; i < 3; i++) {
    const owner = await user();
    const biz = await business(owner);
    await db.query(`SELECT org_decide_application($1,$2,'approve',NULL)`, [
      orgAdmin,
      await apply(owner, biz),
    ]);
    const aff = (
      await scalar(`SELECT id FROM organisation_affiliations WHERE business_id=$1`, [biz])
    ).id;
    members.push({ owner, biz, aff });
  }
  const results = [];
  for (const m of members)
    results.push(
      (
        await scalar(`SELECT sponsor_business($1,$2,'ORGANISATION','Cohort one') AS s`, [
          orgAdmin,
          m.aff,
        ])
      ).s
    );
  const used = (
    await scalar(
      `SELECT count(*)::int AS n FROM organisation_sponsorships WHERE organisation_id=$1 AND status='active'`,
      [orgId]
    )
  ).n;
  assert.equal(used, 2);
  assert.equal(results.at(-1), "waitlisted");
  const [first] = members;
  await setStatus(first.biz, "pending_moderation", "businesses");
  await setStatus(first.biz, "live", "businesses");
  assert.equal(
    (await scalar(`SELECT * FROM public_business_affiliations($1)`, [[first.biz]]))
      .sponsorship_label,
    "Supported by City of XYZ"
  );
  const sid = (
    await scalar(`SELECT id FROM organisation_sponsorships WHERE affiliation_id=$1`, [first.aff])
  ).id;
  await db.query(`SELECT end_sponsorship($1,$2,'Business left the cohort')`, [orgAdmin, sid]);
  assert.equal(await statusOf(first.biz, "businesses"), "expired");
  assert.equal(
    (await scalar(`SELECT status FROM organisation_affiliations WHERE id=$1`, [first.aff])).status,
    "active"
  );
  const promoted = (
    await scalar(
      `SELECT status FROM organisation_sponsorships WHERE affiliation_id=$1 AND status<>'ended'`,
      [members[2].aff]
    )
  ).status;
  assert.equal(promoted, "active");
  // Sponsored members never later receive a public trial.
  assert.equal(
    (await scalar(`SELECT trial_entitlement_for($1) AS k`, [members[2].owner])).k,
    "SPONSORED_ORGANISATION_MEMBER"
  );
});

await test("revoking affiliation keeps the account and business", async () => {
  const owner = await user();
  const biz = await business(owner);
  await db.query(`SELECT org_decide_application($1,$2,'approve',NULL)`, [
    orgAdmin,
    await apply(owner, biz),
  ]);
  const aff = (await scalar(`SELECT id FROM organisation_affiliations WHERE business_id=$1`, [biz]))
    .id;
  await rejects(
    db.query(`SELECT org_revoke_affiliation($1,$2,'Owner attempt')`, [owner, aff]),
    /Organisation access required/
  );
  await db.query(`SELECT org_revoke_affiliation($1,$2,'Left the chamber')`, [orgAdmin, aff]);
  assert.equal((await scalar(`SELECT count(*)::int AS n FROM businesses WHERE id=$1`, [biz])).n, 1);
  assert.equal(
    (await db.query(`SELECT * FROM public_business_affiliations($1)`, [[biz]])).rows.length,
    0
  );
});

await test("pilot expiry ends founding sponsorships but keeps affiliations", async () => {
  const owner = await user();
  const biz = await business(owner);
  await db.query(`SELECT org_decide_application($1,$2,'approve',NULL)`, [
    orgAdmin,
    await apply(owner, biz),
  ]);
  const aff = (await scalar(`SELECT id FROM organisation_affiliations WHERE business_id=$1`, [biz]))
    .id;
  await db.query(
    `SELECT admin_manage_organisation($1,$2,'set_capacity','{"sponsoredCapacity":10}','Expand pilot cohort')`,
    [admin, orgId]
  );
  await db.query(`SELECT sponsor_business($1,$2,'VERIFYMZANSI_FOUNDING','Founding cohort')`, [
    admin,
    aff,
  ]);
  assert.equal(
    (await scalar(`SELECT * FROM public_business_affiliations($1)`, [[biz]])).sponsored,
    false
  );
  await db.query(
    `UPDATE organisations SET trial_ends_at = now() - interval '1 minute' WHERE id=$1`,
    [orgId]
  );
  await db.query(`SELECT organisation_lifecycle()`);
  assert.equal(
    (await scalar(`SELECT programme_status FROM organisations WHERE id=$1`, [orgId]))
      .programme_status,
    "affiliation_only"
  );
  assert.equal(
    (await scalar(`SELECT status FROM organisation_sponsorships WHERE affiliation_id=$1`, [aff]))
      .status,
    "ended"
  );
  assert.equal(
    (await scalar(`SELECT status FROM organisation_affiliations WHERE id=$1`, [aff])).status,
    "active"
  );
  const n = (
    await scalar(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND title='Founding pilot has ended'`,
      [orgAdmin]
    )
  ).n;
  assert.equal(n, 1);
});

// ── Partners & analytics ─────────────────────────────────────────────────
await db.query(
  `SELECT update_commercial_setting($1,'partner','{"commissionBps":2000,"pendingDays":30,"enabled":true}','Restore default rate')`,
  [admin]
);
const partnerUser = await user();
await db.query(
  `SELECT admin_manage_partner($1,$2,'create','{"code":"THANDO1"}','Recruited sales agent')`,
  [admin, partnerUser]
);
const commission = async (paymentId) =>
  scalar(`SELECT * FROM commissions WHERE payment_id=$1`, [paymentId]);

await test("partner: free signup earns nothing, R250 earns R50, refund reverses", async () => {
  const u = await user();
  assert.equal(
    (await scalar(`SELECT record_account_acquisition($1,'{"partnerCode":"thando1"}') AS s`, [u])).s,
    "PARTNER"
  );
  // Later organisation attribution never overwrites the partner.
  assert.equal(
    (
      await scalar(
        `SELECT record_account_acquisition($1,'{"organisationSlug":"city-of-xyz"}') AS s`,
        [u]
      )
    ).s,
    "PARTNER"
  );
  const id = uuid();
  await db.query(`SELECT reserve_intro_trial($1,'MZANSI_MARKET',$2,7)`, [u, id]);
  await post(u, { id });
  await setStatus(id, "live");
  assert.equal((await scalar(`SELECT count(*)::int AS n FROM commissions`)).n, 0);
  const { id: paymentId } = await pay(u, await retailPlan("RETAIL_6M"));
  const c = await commission(paymentId);
  assert.equal(c.amount_cents, 5000);
  assert.equal(c.status, "PENDING");
  assert.equal(c.requires_manual_approval, false);
  await db.query(`UPDATE commissions SET eligible_at = now() - interval '1 minute' WHERE id=$1`, [
    c.id,
  ]);
  await db.query(`SELECT approve_due_commissions()`);
  assert.equal((await commission(paymentId)).status, "APPROVED");
  await db.query(`SELECT reverse_payment($1,$2,'chargeback','Card chargeback received')`, [
    admin,
    paymentId,
  ]);
  assert.equal((await commission(paymentId)).status, "REVERSED");
});

await test("partner: self-referral and institutional plans are not auto-commissioned", async () => {
  assert.equal(
    (
      await scalar(`SELECT record_account_acquisition($1,'{"partnerCode":"THANDO1"}') AS s`, [
        partnerUser,
      ])
    ).s,
    "DIRECT"
  );
  const { id: own } = await pay(partnerUser, await retailPlan("RETAIL_30D"));
  assert.equal(await commission(own), undefined);
  const u = await user();
  await db.query(`SELECT record_account_acquisition($1,'{"partnerCode":"THANDO1"}')`, [u]);
  const { id: ent } = await pay(
    u,
    await scalar(`SELECT * FROM plans WHERE plan_code='ENT_100_6M'`)
  );
  const c = await commission(ent);
  assert.equal(c.requires_manual_approval, true);
  await db.query(`UPDATE commissions SET eligible_at = now() - interval '1 minute' WHERE id=$1`, [
    c.id,
  ]);
  await db.query(`SELECT approve_due_commissions()`);
  assert.equal((await commission(ent)).status, "PENDING");
  const dash = (await scalar(`SELECT partner_dashboard($1) AS d`, [partnerUser])).d;
  assert.equal(dash.code, "THANDO1");
  assert.equal((await scalar(`SELECT partner_dashboard($1) AS d`, [u])).d, null);
});

await test("analytics dedupes impressions and feeds the organisation report", async () => {
  const owner = await user();
  const biz = await business(owner);
  await db.query(`SELECT org_decide_application($1,$2,'approve',NULL)`, [
    orgAdmin,
    await apply(owner, biz),
  ]);
  await setStatus(biz, "pending_moderation", "businesses");
  await pay(owner, await retailPlan("RETAIL_12M", "MZANSI_BUSINESS"));
  await setStatus(biz, "live", "businesses");
  const batch = [
    { table: "businesses", id: biz, type: "impression", surface: "search" },
    { table: "businesses", id: biz, type: "impression", surface: "search" },
    { table: "businesses", id: biz, type: "detail_view" },
    { table: "businesses", id: biz, type: "whatsapp_click" },
    { table: "nope", id: biz, type: "impression" },
  ];
  assert.equal(
    (await scalar(`SELECT record_analytics_events($1,'viewer-a') AS n`, [JSON.stringify(batch)])).n,
    3
  );
  const report = (
    await scalar(
      `SELECT organisation_performance_report($1,$2,now()-interval '1 day',now()+interval '1 minute') AS r`,
      [orgAdmin, orgId]
    )
  ).r;
  assert(report.participatingBusinesses >= 1);
  assert.equal(report.events.whatsapp_click, 1);
  assert.equal(report.profileViews, 1);
  assert(!JSON.stringify(report).includes("viewer-a"));
  await rejects(
    db.query(`SELECT organisation_performance_report($1,$2,now()-interval '1 day',now())`, [
      owner,
      orgId,
    ]),
    /Organisation access required/
  );
  await db.query(`SELECT rollup_analytics_daily()`);
});

await test("lifecycle notifications fire once per milestone", async () => {
  const u = await user();
  await pay(u, await retailPlan("RETAIL_30D"));
  await db.query(
    `UPDATE slot_entitlements SET expires_at = now() + interval '12 hours' WHERE user_id=$1`,
    [u]
  );
  await db.query(`SELECT notify_commercial_lifecycle()`);
  await db.query(`SELECT notify_commercial_lifecycle()`);
  const n = (
    await scalar(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND title='Your plan expires soon'`,
      [u]
    )
  ).n;
  assert.equal(n, 1);
});

await test("ended events are archived after the configured period", async () => {
  const u = await user();
  const e = await post(u, { table: "promotions", type: "event" });
  await setStatus(e, "live", "promotions");
  await db.query(
    `UPDATE promotions SET status='expired', end_date=now()-interval '40 days' WHERE id=$1`,
    [e]
  );
  assert.equal((await scalar(`SELECT archive_ended_events() AS n`)).n, 1);
  assert.equal(await statusOf(e, "promotions"), "archived");
});

// ── Review fixes ─────────────────────────────────────────────────────────
await test("extending a programme moves live posts; ending withdraws them", async () => {
  const u = await user();
  const cid = (
    await scalar(
      `SELECT grant_programme_contract($1,$2,'STRATEGIC_INDIVIDUAL','{}','Review extension case') AS id`,
      [admin, u]
    )
  ).id;
  const p = await post(u);
  await setStatus(p, "live");
  const newEnd = new Date(Date.now() + 200 * 864e5).toISOString();
  await db.query(
    `SELECT manage_commercial_contract($1,$2,'extend',$3,'Extended for good results')`,
    [admin, cid, { endsAt: newEnd }]
  );
  const l = await scalar(`SELECT expires_at FROM listings WHERE id=$1`, [p]);
  assert.equal(new Date(l.expires_at).toISOString(), newEnd);
  assert.equal(
    (await scalar(`SELECT activation_count FROM slot_entitlements WHERE contract_id=$1`, [cid]))
      .activation_count,
    1
  );
  await db.query(`SELECT manage_commercial_contract($1,$2,'end','{}','Programme closed early')`, [
    admin,
    cid,
  ]);
  assert.equal(await statusOf(p), "expired");
});

await test("lapsed sponsorships free capacity and promote the waiting list", async () => {
  const org = (
    await scalar(`SELECT admin_upsert_organisation($1,NULL,$2,'Second pilot') AS id`, [
      admin,
      { slug: "chamber-abc", name: "Chamber ABC", sponsoredCapacity: 1 },
    ])
  ).id;
  await db.query(`SELECT admin_manage_organisation($1,$2,'activate_trial','{}','Signed MOU')`, [
    admin,
    org,
  ]);
  await db.query(`SELECT admin_upsert_organisation($1,$2,'{"isPublic":true}','Publish')`, [
    admin,
    org,
  ]);
  const affs = [];
  for (let i = 0; i < 2; i++) {
    const owner = await user();
    const biz = await business(owner);
    const app = (
      await scalar(`SELECT submit_affiliation_application($1,$2,$3,NULL,NULL,NULL,$4) AS id`, [
        owner,
        biz,
        org,
        consent,
      ])
    ).id;
    await db.query(`SELECT org_decide_application($1,$2,'approve',NULL)`, [admin, app]);
    affs.push(
      (await scalar(`SELECT id FROM organisation_affiliations WHERE business_id=$1`, [biz])).id
    );
  }
  await db.query(`SELECT sponsor_business($1,$2,'ORGANISATION','Cohort')`, [admin, affs[0]]);
  assert.equal(
    (await scalar(`SELECT sponsor_business($1,$2,'ORGANISATION','Cohort') AS s`, [admin, affs[1]]))
      .s,
    "waitlisted"
  );
  await db.query(
    `UPDATE organisation_sponsorships SET ends_at = now() - interval '1 minute' WHERE affiliation_id=$1`,
    [affs[0]]
  );
  await db.query(`SELECT organisation_lifecycle()`);
  assert.equal(
    (
      await scalar(`SELECT status FROM organisation_sponsorships WHERE affiliation_id=$1`, [
        affs[0],
      ])
    ).status,
    "ended"
  );
  assert.equal(
    (
      await scalar(
        `SELECT status FROM organisation_sponsorships WHERE affiliation_id=$1 AND status<>'ended'`,
        [affs[1]]
      )
    ).status,
    "active"
  );
});

await test("founding organisations get shared posting slots and pilots can be extended", async () => {
  const org = (
    await scalar(`SELECT admin_upsert_organisation($1,NULL,$2,'Tourism body') AS id`, [
      admin,
      { slug: "tourism-xyz", name: "Tourism XYZ" },
    ])
  ).id;
  const official = await user();
  await db.query(`SELECT admin_manage_organisation($1,$2,'add_admin',$3,'LED officer')`, [
    admin,
    org,
    { userId: official },
  ]);
  await db.query(
    `SELECT admin_manage_organisation($1,$2,'activate_trial','{"ownSlots":2}','Signed MOU')`,
    [admin, org]
  );
  assert.equal(
    (await scalar(`SELECT posting_allowance($1,'PROMOTIONS_EVENTS') AS a`, [official])).a.capacity,
    2
  );
  const p = await post(official, { table: "businesses", area: "MZANSI_BUSINESS" });
  await setStatus(p, "live", "businesses");
  const newEnd = new Date(Date.now() + 300 * 864e5).toISOString();
  await db.query(
    `SELECT admin_manage_organisation($1,$2,'extend_trial',$3,'Pilot extended by agreement')`,
    [admin, org, { endsAt: newEnd }]
  );
  assert.equal(
    new Date(
      (await scalar(`SELECT expires_at FROM businesses WHERE id=$1`, [p])).expires_at
    ).toISOString(),
    newEnd
  );
  await db.query(`SELECT admin_manage_organisation($1,$2,'remove_admin',$3,'Official left')`, [
    admin,
    org,
    { userId: official },
  ]);
  assert.equal(
    (await scalar(`SELECT posting_allowance($1,'MZANSI_BUSINESS') AS a`, [official])).a.hasPaidPlan,
    false
  );
});

await test("reports read the daily roll-up beyond raw retention", async () => {
  const owner = await user();
  const biz = await business(owner);
  await db.query(`SELECT org_decide_application($1,$2,'approve',NULL)`, [
    orgAdmin,
    await apply(owner, biz),
  ]);
  await db.query(
    `INSERT INTO analytics_daily VALUES (current_date - 120, 'businesses', $1, 'whatsapp_click', 7, 5)`,
    [biz]
  );
  const r = (
    await scalar(
      `SELECT organisation_performance_report($1,$2,now()-interval '200 days',now()) AS r`,
      [orgAdmin, orgId]
    )
  ).r;
  assert(r.events.whatsapp_click >= 7);
});

await test("trial offer reports configured durations", async () => {
  const u = await user();
  await db.query(`SELECT set_config('test.uid',$1,false)`, [u]);
  const offer = (await scalar(`SELECT intro_trial_offer('MZANSI_MARKET') AS o`)).o;
  await db.query(`SELECT set_config('test.uid','',false)`);
  assert.equal(offer.shortDays, 5);
  assert.equal(offer.longDays, 30);
});

await test("public and member roles can read organisations under RLS", async () => {
  await db.exec(`GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;`);
  const member = await user();
  for (const [role, uid] of [
    ["anon", ""],
    ["authenticated", member],
    ["authenticated", orgAdmin],
  ]) {
    await db.query(`SELECT set_config('test.uid',$1,false)`, [uid]);
    await db.exec(`SET ROLE ${role}`);
    try {
      const orgs = (await db.query(`SELECT slug FROM organisations`)).rows.map((r) => r.slug);
      assert(orgs.includes("city-of-xyz"));
      await db.query(`SELECT id FROM organisation_programmes`);
      await db.query(`SELECT id FROM organisation_affiliations`);
      await db.query(`SELECT id FROM slot_entitlements`);
      await db.query(`SELECT id FROM programme_showcases`);
      await db.query(`SELECT key FROM commercial_settings`);
      await db.query(`SELECT * FROM organisation_directory($1)`, [orgId]);
      await db.query(`SELECT organisation_public_stats($1)`, [orgId]);
      await db.query(`SELECT * FROM public_business_affiliations($1)`, [[crypto.randomUUID()]]);
      if (uid) await db.query(`SELECT intro_trial_offer('MZANSI_MARKET')`);
      await rejects(
        db.query(`SELECT posting_allowance($1,'MZANSI_MARKET')`, [member]),
        /permission denied/
      );
    } finally {
      await db.exec(`RESET ROLE`);
      await db.query(`SELECT set_config('test.uid','',false)`);
    }
  }
});

await test("a plan taken off sale mid-checkout still fulfils the paid order", async () => {
  const u = await user();
  const plan = await retailPlan("RETAIL_30D", "MZANSI_BUSINESS");
  const id = crypto.randomUUID();
  const meta = { type: "subscription", plan_id: plan.id, plan_tier: plan.tier, area: plan.area };
  await db.query(
    `INSERT INTO payments(id,user_id,area,amount_cents,status,provider,provider_data,created_at) VALUES($1,$2,$3,$4,'pending','ozow',$5,now()-interval '5 minutes')`,
    [id, u, plan.area, plan.price_cents, meta]
  );
  await db.query(`SELECT update_plan_pricing($1,$2,'{"active":false}','Pause 30-day sales')`, [
    admin,
    plan.id,
  ]);
  const r = await scalar(`SELECT fulfill_ozow_payment($1,$2,$3,$4,$5,NULL,'{}') AS r`, [
    id,
    "ozow-" + id,
    plan.price_cents,
    meta,
    plan.id,
  ]);
  assert.equal(r.r.outcome, "completed");
  await db.query(`SELECT update_plan_pricing($1,$2,'{"active":true}','Resume 30-day sales')`, [
    admin,
    plan.id,
  ]);
  assert.equal(
    (await scalar(`SELECT retired_at FROM plans WHERE id=$1`, [plan.id])).retired_at,
    null
  );
});

await test("a repriced plan honours the price quoted at checkout, not arbitrary amounts", async () => {
  const u = await user();
  const plan = await retailPlan("RETAIL_6M", "PROMOTIONS_EVENTS");
  const meta = {
    type: "subscription",
    plan_id: plan.id,
    plan_tier: plan.tier,
    area: plan.area,
    price_cents: plan.price_cents,
  };
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO payments(id,user_id,area,amount_cents,status,provider,provider_data) VALUES($1,$2,$3,$4,'pending','ozow',$5)`,
    [id, u, plan.area, plan.price_cents, meta]
  );
  await db.query(`SELECT update_plan_pricing($1,$2,'{"priceCents":27500}','Price review')`, [
    admin,
    plan.id,
  ]);
  const r = await scalar(`SELECT fulfill_ozow_payment($1,$2,$3,$4,$5,NULL,'{}') AS r`, [
    id,
    "ozow-" + id,
    plan.price_cents,
    meta,
    plan.id,
  ]);
  assert.equal(r.r.outcome, "completed");
  const bad = crypto.randomUUID();
  const badMeta = { ...meta, price_cents: 100 };
  await db.query(
    `INSERT INTO payments(id,user_id,area,amount_cents,status,provider,provider_data) VALUES($1,$2,$3,$4,'pending','ozow',$5)`,
    [bad, u, plan.area, 5000, badMeta]
  );
  await rejects(
    db.query(`SELECT fulfill_ozow_payment($1,$2,5000,$3,$4,NULL,'{}')`, [
      bad,
      "ozow-" + bad,
      badMeta,
      plan.id,
    ]),
    /validation failed/
  );
  await db.query(`SELECT update_plan_pricing($1,$2,'{"priceCents":25000}','Restore price')`, [
    admin,
    plan.id,
  ]);
});

// ── Completion ───────────────────────────────────────────────────────────
await test("priced custom contracts unlock only when marked paid; custom start dates", async () => {
  const u = await user();
  const start = new Date(Date.now() - 864e5).toISOString();
  const cid = (
    await scalar(
      `SELECT grant_programme_contract($1,$2,'ENTERPRISE_CUSTOM',$3,'Quoted fleet contract') AS id`,
      [admin, u, { slotCapacity: 1200, durationDays: 365, priceCents: 18000000, startsAt: start }]
    )
  ).id;
  assert.equal(
    (
      await scalar(`SELECT starts_at FROM commercial_contracts WHERE id=$1`, [cid])
    ).starts_at.toISOString(),
    start
  );
  assert.equal(
    (await scalar(`SELECT posting_allowance($1,'MZANSI_MARKET') AS a`, [u])).a.hasPaidPlan,
    false
  );
  await rejects(
    db.query(`SELECT manage_commercial_contract($1,$2,'mark_paid','{}','Invoice settled')`, [
      admin,
      cid,
    ]),
    /reference/
  );
  await db.query(
    `SELECT manage_commercial_contract($1,$2,'mark_paid','{"reference":"INV-2026-0042"}','Invoice settled')`,
    [admin, cid]
  );
  assert.equal(
    (await scalar(`SELECT posting_allowance($1,'MZANSI_MARKET') AS a`, [u])).a.capacity,
    1200
  );
});

await test("affiliation types set the badge wording and filter the directory", async () => {
  const owner = await user();
  const biz = await business(owner);
  await pay(owner, await retailPlan("RETAIL_30D", "MZANSI_BUSINESS"));
  await db.query(`UPDATE businesses SET location_province='Gauteng' WHERE id=$1`, [biz]);
  await setStatus(biz, "pending_moderation", "businesses");
  await setStatus(biz, "live", "businesses");
  await db.query(`SELECT org_decide_application($1,$2,'approve',NULL)`, [
    admin,
    await apply(owner, biz),
  ]);
  const aff = (await scalar(`SELECT id FROM organisation_affiliations WHERE business_id=$1`, [biz]))
    .id;
  await rejects(
    db.query(`SELECT org_set_affiliation_type($1,$2,'member')`, [owner, aff]),
    /Organisation access required/
  );
  await db.query(`SELECT org_set_affiliation_type($1,$2,'member')`, [orgAdmin, aff]);
  assert.equal(
    (await scalar(`SELECT * FROM public_business_affiliations($1)`, [[biz]])).label,
    "Member"
  );
  const members = (
    await db.query(`SELECT * FROM organisation_directory($1, p_type => 'member')`, [orgId])
  ).rows;
  assert(members.some((r) => r.business_id === biz && r.affiliation_label === "Member"));
  const gauteng = (
    await db.query(`SELECT * FROM organisation_directory($1, p_province => 'gauteng')`, [orgId])
  ).rows;
  assert(gauteng.every((r) => r.province === "Gauteng") && gauteng.length >= 1);
});

await test("large organisers can receive a custom event allowance", async () => {
  const u = await user();
  await db.query(
    `SELECT admin_set_event_allowance($1,$2,'{"maxActive":6,"maxCreatedPer30Days":40}','Festival organiser')`,
    [admin, u]
  );
  for (let i = 0; i < 6; i++)
    await setStatus(await post(u, { table: "promotions", type: "event" }), "live", "promotions");
  await rejects(
    setStatus(await post(u, { table: "promotions", type: "event" }), "live", "promotions"),
    /EVENT_LIMIT/
  );
  assert.equal((await scalar(`SELECT event_limits($1) AS l`, [u])).l.maxCreatedPer30Days, 40);
});

await test("storage usage is summed per account", async () => {
  const u = await user();
  await db.query(`INSERT INTO media_uploads(user_id,file_size) VALUES ($1,1000),($1,2500)`, [u]);
  assert.equal(Number((await scalar(`SELECT media_storage_used($1) AS n`, [u])).n), 3500);
});

console.log(`${checks} commercial model checks passed`);
