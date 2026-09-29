// Isolated PostgreSQL checks for the admin list helpers: batched lookups and
// database-side totals that replace per-row calls and whole-table reads.
import assert from "node:assert/strict";
import { createAdminDb } from "./lib/admin-db.mjs";

process.on("uncaughtException", (error) => {
  const at = (error.stack ?? "").split(/\r?\n/).find((l) => l.includes("test-admin-list-helpers"));
  console.error(error.message, error.where ?? "", at ?? "");
  process.exit(1);
});

const { db, uuid, person, scalar, asService, migrate } = await createAdminDb();

// Minimal stand-ins for the tables these helpers read.
await db.exec(`
  CREATE TYPE payment_status AS ENUM ('pending','processing','complete','failed','expired','refunded');
  CREATE TABLE public.payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), area marketplace_area NOT NULL,
    amount_cents integer NOT NULL, status payment_status NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.invoices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vat_cents integer NOT NULL, total_cents integer NOT NULL);
  CREATE TABLE public.organisation_affiliations(organisation_id uuid NOT NULL, status text NOT NULL);
  CREATE TABLE public.organisation_sponsorships(organisation_id uuid NOT NULL, status text NOT NULL);
  CREATE TABLE public.organisation_applications(organisation_id uuid NOT NULL, status text NOT NULL);
  CREATE TABLE public.account_acquisition(user_id uuid PRIMARY KEY, partner_id uuid);
  CREATE FUNCTION public.trial_entitlement_for(p_user uuid) RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT CASE WHEN p_user IS NULL THEN 'NONE' ELSE 'INTRO' END $$;
`);
await migrate("20260929130000_admin_list_helpers.sql");

const call = (sql, args) => asService(async () => (await db.query(sql, args)).rows);

// ── staff_directory: one query for names and emails ─────────────────────────
const named = await person("moderator");
const unnamed = await person("moderator");
await db.query(`UPDATE auth.users SET email='mod@example.com' WHERE id=$1`, [named]);
await db.query(`UPDATE account_profiles SET display_name='Thandi' WHERE user_id=$1`, [named]);
await db.query(`UPDATE account_profiles SET display_name='  ' WHERE user_id=$1`, [unnamed]);
const directory = await call(`SELECT * FROM public.staff_directory($1)`, [
  [named, unnamed, uuid()],
]);
assert.equal(directory.length, 2, "unknown ids are skipped");
const byId = Object.fromEntries(directory.map((r) => [r.user_id, r]));
assert.equal(byId[named].display_name, "Thandi");
assert.equal(byId[named].email, "mod@example.com");
assert.equal(byId[unnamed].display_name, null, "a blank name is treated as missing");

// ── organisation_list_counts ────────────────────────────────────────────────
const orgA = uuid();
const orgB = uuid();
await db.query(
  `INSERT INTO organisation_affiliations VALUES ($1,'active'),($1,'active'),($1,'ended'),($2,'active')`,
  [orgA, orgB]
);
await db.query(`INSERT INTO organisation_sponsorships VALUES ($1,'active'),($1,'revoked')`, [orgA]);
await db.query(`INSERT INTO organisation_applications VALUES ($1,'submitted'),($2,'approved')`, [
  orgA,
  orgB,
]);
const orgCounts = Object.fromEntries(
  (await call(`SELECT * FROM public.organisation_list_counts($1)`, [[orgA, orgB]])).map((r) => [
    r.organisation_id,
    r,
  ])
);
assert.deepEqual(
  [orgCounts[orgA].affiliated, orgCounts[orgA].sponsored, orgCounts[orgA].pending],
  [2, 1, 1]
);
assert.deepEqual(
  [orgCounts[orgB].affiliated, orgCounts[orgB].sponsored, orgCounts[orgB].pending],
  [1, 0, 0]
);

// ── partner_referral_counts ─────────────────────────────────────────────────
const partner = uuid();
const quiet = uuid();
await db.query(
  `INSERT INTO account_acquisition VALUES (gen_random_uuid(),$1),(gen_random_uuid(),$1),(gen_random_uuid(),NULL)`,
  [partner]
);
const referrals = Object.fromEntries(
  (await call(`SELECT * FROM public.partner_referral_counts($1)`, [[partner, quiet]])).map((r) => [
    r.partner_id,
    r.referrals,
  ])
);
assert.deepEqual(referrals, { [partner]: 2, [quiet]: 0 });

// ── revenue_summary: sums in the database ───────────────────────────────────
await db.exec(`
  INSERT INTO payments(area,amount_cents,status,created_at) VALUES
    ('MZANSI_MARKET',1000,'complete',now()),
    ('MZANSI_BUSINESS',5000,'complete',now() - interval '40 days'),
    ('MZANSI_MARKET',700,'failed',now()),
    ('MZANSI_MARKET',300,'pending',now()),
    ('MZANSI_MARKET',9900,'complete',now() - interval '3 years');
  INSERT INTO invoices(vat_cents,total_cents) VALUES (150,1150),(750,5750);
`);
const [{ result: revenue }] = await call(`SELECT public.revenue_summary() AS result`);
assert.equal(revenue.transactions, 5);
assert.equal(revenue.completed_count, 3);
assert.equal(revenue.completed_cents, 15900);
assert.equal(revenue.failed_cents, 700);
assert.equal(revenue.pending_cents, 300);
assert.equal(revenue.invoice_vat_cents, 900);
assert.equal(revenue.by_area[0].area, "MZANSI_MARKET", "largest area first");
assert.equal(
  revenue.by_month.reduce((sum, m) => sum + m.cents, 0),
  6000,
  "the monthly trend covers the last 12 months only"
);

// ── trial_entitlements_for ──────────────────────────────────────────────────
const trials = await call(`SELECT * FROM public.trial_entitlements_for($1)`, [[named, unnamed]]);
assert.equal(trials.length, 2);

// ── Service role only ───────────────────────────────────────────────────────
for (const fn of [
  "staff_directory(uuid[])",
  "organisation_list_counts(uuid[])",
  "partner_referral_counts(uuid[])",
  "revenue_summary()",
  "trial_entitlements_for(uuid[])",
]) {
  assert.equal(
    await scalar(`SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')`),
    false,
    fn
  );
}

console.log("Admin list helper checks passed.");
