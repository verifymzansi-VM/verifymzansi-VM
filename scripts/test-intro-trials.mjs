import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
process.on("uncaughtException", (error) => {
  console.error(error.message, error.where ?? "");
  process.exit(1);
});
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb DEFAULT '{}');
CREATE TYPE marketplace_area AS ENUM ('MZANSI_MARKET','MZANSI_BUSINESS','PROMOTIONS_EVENTS');
CREATE TABLE account_profiles(user_id uuid,account_verification_status text,account_status text,phone text);
CREATE TABLE verification_steps(user_id uuid,step_type text,status text,id_number_hmac text);
CREATE TABLE free_posts_used(user_id uuid,area marketplace_area,content_id uuid,release_reason text,released_at timestamptz);
CREATE TABLE entitlements(id uuid DEFAULT gen_random_uuid(),user_id uuid,area marketplace_area,tier text,type text,status text,expires_at timestamptz);
CREATE TABLE plans(area marketplace_area,tier text,features jsonb,active boolean);
CREATE TABLE notifications(user_id uuid,type text,title text,message text,href text);
CREATE TABLE listings(id uuid PRIMARY KEY,owner_id uuid,area marketplace_area,status text,expires_at timestamptz,status_reason text,boost_until timestamptz,featured_until timestamptz,urgent_until timestamptz,featured boolean,urgent boolean);
CREATE TABLE businesses(LIKE listings INCLUDING ALL);
CREATE TABLE promotions(id uuid PRIMARY KEY,owner_id uuid,status text,expires_at timestamptz,status_reason text,end_date timestamptz,boost_until timestamptz,featured_until timestamptz,urgent_until timestamptz);
SET test.role='service_role';`);
for (const f of [
  "20260906000000_introductory_trials.sql",
  "20260906000100_trial_management_and_renewal.sql",
  "20260906000200_paid_capacity_for_retained_posts.sql",
])
  await db.exec(fs.readFileSync("supabase/migrations/" + f, "utf8"));
const scalar = async (sql, args) => (await db.query(sql, args)).rows[0];
const uuid = () => crypto.randomUUID();
async function user(role = "member", h = uuid()) {
  const id = uuid();
  await db.query(`INSERT INTO auth.users VALUES($1,$2)`, [id, { role }]);
  await db.query(`INSERT INTO account_profiles VALUES($1,'verified','active','+27712345678')`, [
    id,
  ]);
  for (const step of ["phone", "id_doc", "selfie", "location"])
    await db.query(`INSERT INTO verification_steps VALUES($1,$2,'approved',$3)`, [
      id,
      step,
      step === "id_doc" ? h : null,
    ]);
  return id;
}
async function reserve(u, area = "MZANSI_MARKET", days = 30) {
  const id = uuid();
  const r = await scalar("SELECT reserve_intro_trial($1,$2,$3,$4) AS ok", [u, area, id, days]);
  return { id, ok: r.ok };
}
async function post(u, r, table = "listings", area = "MZANSI_MARKET") {
  await db.query(
    table === "promotions"
      ? `INSERT INTO promotions(id,owner_id,status,end_date) VALUES($1,$2,'pending_moderation',now()+interval '2 days')`
      : `INSERT INTO ${table}(id,owner_id,area,status) VALUES($1,$2,$3,'pending_moderation')`,
    table === "promotions" ? [r.id, u] : [r.id, u, area]
  );
}
async function live(id, table = "listings") {
  await db.query(
    `UPDATE ${table} SET status='live',expires_at=now()+interval '99 days' WHERE id=$1`,
    [id]
  );
}
let checks = 0;
async function test(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}
const u = await user(),
  r = await reserve(u);
await test("reserve does not consume identity or capacity", async () => {
  assert(r.ok);
  assert.equal((await scalar("SELECT count(*)::int AS n FROM intro_trial_identities")).n, 0);
});
await post(u, r);
await test("cannot reserve another area while pending", async () =>
  assert.equal((await reserve(u, "MZANSI_BUSINESS", 7)).ok, false));
await test("activation fixes duration at 30 days and strips premium features", async () => {
  await live(r.id);
  const row = await scalar("SELECT * FROM listings WHERE id=$1", [r.id]);
  assert.equal(row.featured, false);
  assert(Math.abs(new Date(row.expires_at) - Date.now() - 30 * 86400000) < 5000);
});
await test("another identity-matching account cannot claim", async () => {
  const h = (
    await scalar(
      `SELECT id_number_hmac FROM verification_steps WHERE user_id=$1 AND step_type='id_doc'`,
      [u]
    )
  ).id_number_hmac;
  assert.equal((await reserve(await user("member", h))).ok, false);
});
await test("editing cannot restart expiry", async () => {
  const before = (await scalar("SELECT expires_at FROM listings WHERE id=$1", [r.id])).expires_at;
  await live(r.id);
  assert.equal(
    String((await scalar("SELECT expires_at FROM listings WHERE id=$1", [r.id])).expires_at),
    String(before)
  );
});
await db.exec(`UPDATE intro_trial_campaigns SET slot_limit=1 WHERE area='MZANSI_MARKET'`);
const u2 = await user(),
  r2 = await reserve(u2);
await post(u2, r2);
await test("full pool keeps post pending and identity unspent", async () => {
  await assert.rejects(live(r2.id), /TRIAL_FULL/);
  assert.equal(
    (await scalar("SELECT status FROM listings WHERE id=$1", [r2.id])).status,
    "pending_moderation"
  );
});
await test("hidden post frees pool without restoring identity", async () => {
  await db.query(`UPDATE listings SET status='hidden' WHERE id=$1`, [r.id]);
  await live(r2.id);
  assert.equal((await reserve(u, "MZANSI_BUSINESS")).ok, false);
  await assert.rejects(live(r.id), /TRIAL_EXPIRED/);
});
await test("tourism business and event share capacity; event ends early", async () => {
  await db.exec(`UPDATE intro_trial_campaigns SET slot_limit=1 WHERE area='PROMOTIONS_EVENTS'`);
  const u3 = await user(),
    r3 = await reserve(u3, "PROMOTIONS_EVENTS");
  await post(u3, r3, "promotions");
  await live(r3.id, "promotions");
  assert(
    new Date((await scalar("SELECT expires_at FROM promotions WHERE id=$1", [r3.id])).expires_at) -
      Date.now() <
      3 * 86400000
  );
  const u4 = await user(),
    r4 = await reserve(u4, "PROMOTIONS_EVENTS");
  await post(u4, r4, "businesses", "PROMOTIONS_EVENTS");
  await assert.rejects(live(r4.id, "businesses"), /TRIAL_FULL/);
});
await test("7 days works with full 30-day pool", async () => {
  const u5 = await user(),
    r5 = await reserve(u5, "MZANSI_MARKET", 7);
  await post(u5, r5);
  await live(r5.id);
  assert(
    Math.abs(
      new Date((await scalar("SELECT expires_at FROM listings WHERE id=$1", [r5.id])).expires_at) -
        Date.now() -
        7 * 86400000
    ) < 5000
  );
});
await test("staff publishing consumes no slot", async () => {
  const staff = await user("moderator"),
    id = uuid();
  await db.query(
    `INSERT INTO listings(id,owner_id,area,status) VALUES($1,$2,'MZANSI_MARKET','pending_moderation')`,
    [id, staff]
  );
  await live(id);
  assert.equal(
    (await scalar("SELECT count(*)::int AS n FROM intro_trial_claims WHERE content_id=$1", [id])).n,
    0
  );
});
await test("unfunded direct content cannot publish", async () => {
  const id = uuid();
  await db.query(
    `INSERT INTO listings(id,owner_id,area,status) VALUES($1,$2,'MZANSI_MARKET','pending_moderation')`,
    [id, await user()]
  );
  await assert.rejects(live(id), /TRIAL_REQUIRED/);
});
await test("moderator cannot manage campaigns; admin audit is atomic", async () => {
  await assert.rejects(
    db.query(`SELECT manage_intro_trial($1,'configure','MZANSI_BUSINESS',$2,'Test reason')`, [
      await user("moderator"),
      { slotLimit: 2, launchEnabled: true, sevenDayEnabled: true },
    ]),
    /permission required/
  );
  await db.query(`SELECT manage_intro_trial($1,'configure','MZANSI_BUSINESS',$2,'Test reason')`, [
    await user("admin"),
    { slotLimit: 2, launchEnabled: true, sevenDayEnabled: true },
  ]);
  assert.equal((await scalar("SELECT count(*)::int AS n FROM intro_trial_audit")).n, 1);
});
await test("member RPC cannot reserve through service-only function", async () => {
  await db.exec(`SET test.role='authenticated'`);
  await assert.rejects(reserve(u), /Service role required/);
  await db.exec(`SET test.role='service_role'`);
});
await test("paid renewal reactivates saved content with entitlement expiry", async () => {
  await db.query(`INSERT INTO plans VALUES('MZANSI_MARKET','basic','{"maxListings":1}',true)`);
  await db.query(
    `INSERT INTO entitlements(user_id,area,tier,type,status,expires_at) VALUES($1,'MZANSI_MARKET','basic','subscription','active',now()+interval '30 days')`,
    [u]
  );
  const c = (await scalar("SELECT id FROM intro_trial_claims WHERE content_id=$1", [r.id])).id;
  await db.query(`SELECT update_own_intro_trial($1,$2,'renew')`, [u, c]);
  await live(r.id);
  assert(
    (await scalar("SELECT converted_at FROM intro_trial_claims WHERE id=$1", [c])).converted_at
  );
});
await test("summary and idempotent reminders execute", async () => {
  const s = await scalar("SELECT intro_trial_summary() AS summary");
  assert.equal(s.summary.length, 3);
  await db.exec(
    `UPDATE intro_trial_claims SET expires_at=now()+interval '12 hours' WHERE converted_at IS NULL AND activated_at IS NOT NULL`
  );
  await db.exec("SELECT notify_intro_trials()");
  assert.equal((await scalar("SELECT notify_intro_trials() AS n")).n, 0);
});
await test("expired capacity is reusable without deleting saved content", async () => {
  const owner = await user();
  const id = uuid();
  await db.query(
    "INSERT INTO listings(id,owner_id,area,status,expires_at) VALUES($1,$2,'MZANSI_MARKET','expired',now()-interval '1 day')",
    [id, owner]
  );
  assert.equal((await scalar("SELECT posting_area_used($1,'MZANSI_MARKET') AS n", [owner])).n, 0);
  assert.equal((await scalar("SELECT count(*)::int AS n FROM listings WHERE id=$1", [id])).n, 1);
});
await test("revoked roles cannot use direct funding or publication writes", async () => {
  await db.exec("SET test.role='authenticated'");
  await assert.rejects(
    db.query("UPDATE listings SET expires_at=now()+interval '365 days' WHERE id=$1", [r.id]),
    /Funding fields/
  );
  const id = uuid();
  await assert.rejects(
    db.query("INSERT INTO listings(id,owner_id,area,status) VALUES($1,$2,'MZANSI_MARKET','live')", [
      id,
      u,
    ]),
    /Publication requires/
  );
  await db.exec("SET test.role='service_role'");
});
await test("rejection before activation allows a different introductory choice", async () => {
  const owner = await user(),
    reservation = await reserve(owner, "MZANSI_BUSINESS");
  await post(owner, reservation, "businesses", "MZANSI_BUSINESS");
  await db.query("UPDATE businesses SET status='rejected' WHERE id=$1", [reservation.id]);
  assert.equal((await reserve(owner, "MZANSI_MARKET", 7)).ok, true);
});
await test("paused campaign rejects activation and leaves the trial unspent", async () => {
  const owner = await user(),
    reservation = await reserve(owner, "MZANSI_BUSINESS");
  await post(owner, reservation, "businesses", "MZANSI_BUSINESS");
  await db.exec(
    "UPDATE intro_trial_campaigns SET launch_enabled=false WHERE area='MZANSI_BUSINESS'"
  );
  await assert.rejects(live(reservation.id, "businesses"), /TRIAL_PAUSED/);
  const claim = (
    await scalar("SELECT id FROM intro_trial_claims WHERE content_id=$1", [reservation.id])
  ).id;
  await db.query("SELECT update_own_intro_trial($1,$2,'choose_seven')", [owner, claim]);
  await live(reservation.id, "businesses");
  await assert.rejects(
    db.query("SELECT manage_intro_trial($1,'extend',$2,$3,'Support review')", [
      await user("admin"),
      claim,
      { expiresAt: new Date(Date.now() + 40 * 86400000).toISOString() },
    ]),
    /Seven-day/
  );
  await db.exec(
    "UPDATE intro_trial_campaigns SET launch_enabled=true WHERE area='MZANSI_BUSINESS'"
  );
});
await test("activated identity survives account deletion", async () => {
  const hash = uuid(),
    owner = await user("member", hash),
    reservation = await reserve(owner, "MZANSI_BUSINESS", 7);
  await post(owner, reservation, "businesses", "MZANSI_BUSINESS");
  await live(reservation.id, "businesses");
  await db.query("DELETE FROM auth.users WHERE id=$1", [owner]);
  assert.equal((await reserve(await user("member", hash), "MZANSI_MARKET", 7)).ok, false);
});
await test("ordinary authenticated database role cannot inspect identities or call administrative RPCs", async () => {
  await db.exec("SET ROLE authenticated");
  await assert.rejects(db.exec("SELECT * FROM intro_trial_identities"), /permission denied/);
  await assert.rejects(
    db.query("SELECT reserve_intro_trial($1,'MZANSI_MARKET',$2,7)", [u, uuid()]),
    /permission denied/
  );
  await assert.rejects(db.exec("SELECT intro_trial_summary()"), /permission denied/);
  await db.exec("RESET ROLE");
});
console.log(checks + " database checks passed");
await db.close();
