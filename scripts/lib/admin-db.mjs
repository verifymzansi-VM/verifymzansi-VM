// Shared PGlite setup for the admin back-office database suites: a
// Supabase-like auth schema, the tables the admin migrations touch (taken
// from the real schema where possible) and the decision ledger.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

export async function createAdminDb() {
  const read = (file) => fs.readFileSync(`supabase/migrations/${file}`, "utf8");
  const initial = read("20240101000000_initial_schema.sql");
  const definition = (pattern, source = initial) => {
    const match = source.match(pattern);
    assert(match, `Missing schema definition ${pattern}`);
    return match[0];
  };
  const type = (name) => definition(new RegExp(`CREATE TYPE ${name} AS ENUM \\([\\s\\S]*?;`));
  const table = (name) => definition(new RegExp(`CREATE TABLE ${name} \\([\\s\\S]*?\\n\\);`));
  const transitionFn = definition(
    /CREATE OR REPLACE FUNCTION public\.validate_listing_status_transition\(\)[\s\S]*?\$\$;/,
    read("20260925090100_commercial_foundation.sql")
  );

  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
  CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_app_meta_data jsonb DEFAULT '{}', email text);
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ${["marketplace_area", "listing_status", "report_category", "report_severity", "report_status", "enforcement_action", "account_status", "user_role"].map(type).join("\n")}
  ALTER TYPE listing_status ADD VALUE 'sold'; ALTER TYPE listing_status ADD VALUE 'suspended'; ALTER TYPE listing_status ADD VALUE 'archived';
  ALTER TYPE marketplace_area ADD VALUE 'MZANSI_BUSINESS'; ALTER TYPE marketplace_area ADD VALUE 'PROMOTIONS_EVENTS';
  CREATE FUNCTION public.has_role(required_role text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.has_any_role(roles text[]) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE TABLE public.account_profiles(user_id uuid PRIMARY KEY, account_status account_status NOT NULL DEFAULT 'active',
    suspended_until timestamptz, banned_at timestamptz, ban_reason text, strikes integer NOT NULL DEFAULT 0,
    legal_hold boolean NOT NULL DEFAULT false, account_verification_status text, updated_at timestamptz DEFAULT now());
  CREATE FUNCTION public.guard_account_enforcement_columns() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE TRIGGER guard_account_enforcement_columns BEFORE UPDATE ON public.account_profiles
    FOR EACH ROW EXECUTE FUNCTION public.guard_account_enforcement_columns();
  CREATE TABLE public.listings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL,
    status listing_status NOT NULL DEFAULT 'draft', expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.businesses(LIKE public.listings INCLUDING ALL);
  CREATE TABLE public.promotions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'draft', expires_at timestamptz, end_date timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  ${transitionFn}
  CREATE TRIGGER trg_listings_status_transition BEFORE UPDATE OF status ON public.listings FOR EACH ROW EXECUTE FUNCTION public.validate_listing_status_transition();
  CREATE TRIGGER trg_businesses_status_transition BEFORE UPDATE OF status ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.validate_listing_status_transition();
  CREATE TRIGGER trg_promotions_status_transition BEFORE UPDATE OF status ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.validate_listing_status_transition();
  ${table("reports")}
  ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
  ${table("moderation_actions")}
  ALTER TABLE moderation_actions RENAME COLUMN target_seller_id TO target_owner_id;
  ${table("audit_logs")}
  ALTER TABLE audit_logs ALTER COLUMN actor_role TYPE text USING actor_role::text;
  ALTER TABLE audit_logs ADD COLUMN previous_value jsonb, ADD COLUMN new_value jsonb, ADD COLUMN reason text;
  CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL DEFAULT 'info',
    title text NOT NULL, message text, href text, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.feature_flags(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, key text NOT NULL UNIQUE,
    enabled boolean NOT NULL DEFAULT false, description text);`);

  await db.exec(`${type("verification_step_type")}
${type("verification_status")}
CREATE TABLE public.verification_steps(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  step_type verification_step_type NOT NULL, status verification_status NOT NULL DEFAULT 'pending',
  risk_level text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.content_edit_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());
${type("dsar_type")}
ALTER TYPE dsar_type ADD VALUE 'objection';
${type("dsar_status")}
${table("dsar_cases")}
CREATE TABLE public.kyc_artifacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  r2_key text NOT NULL, purge_after timestamptz, status text NOT NULL DEFAULT 'pending');
CREATE TABLE public.contact_submissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  email text NOT NULL, message text NOT NULL, status text NOT NULL DEFAULT 'new', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.r2_cleanup_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket text NOT NULL,
  r2_key text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz);`);
  await db.exec(read("20260326000000_decision_ledger_and_role_lifecycle.sql"));

  const uuid = () => crypto.randomUUID();
  async function person(role, status = "active") {
    const id = uuid();
    await db.query(`INSERT INTO auth.users(id, raw_app_meta_data) VALUES ($1, $2)`, [
      id,
      role ? { role } : {},
    ]);
    await db.query(`INSERT INTO account_profiles(user_id, account_status) VALUES ($1, $2)`, [
      id,
      status,
    ]);
    return id;
  }

  const rows = async (sql, args) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args) =>
    Object.values((await db.query(sql, args)).rows[0] ?? { v: null })[0];
  // Every RPC runs as the service role, like the API routes.
  async function asService(fn) {
    await db.exec(`SET ROLE service_role; SELECT set_config('test.role','service_role',false)`);
    try {
      return await fn();
    } finally {
      await db.exec(`RESET ROLE; SELECT set_config('test.role','',false)`);
    }
  }
  const call = (sql, args) => asService(async () => (await db.query(sql, args)).rows[0].result);
  async function migrate(...files) {
    for (const file of files) await db.exec(read(file));
    await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
  }

  return { db, read, uuid, person, rows, scalar, asService, call, migrate };
}
