import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase", "migrations");
const HARDENING_MIGRATION = "20260724020000_write_path_hardening.sql";
const DATA_INTEGRITY_MIGRATION = "20260724020100_data_integrity_and_retention.sql";
const LEGACY_AREAS_MIGRATION_PREFIX = "20260723000000";

function readMigration(file: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
}

describe("write-path hardening migration (20260724020000)", () => {
  const sql = readMigration(HARDENING_MIGRATION);

  it("adds a guard trigger naming every account_profiles enforcement column", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.guard_account_enforcement_columns()");
    expect(sql).toContain("CREATE TRIGGER guard_account_enforcement_columns");
    expect(sql).toContain("BEFORE UPDATE ON public.account_profiles");

    for (const column of [
      "account_status",
      "suspended_until",
      "banned_at",
      "ban_reason",
      "strikes",
      "legal_hold",
      "account_verification_status",
    ]) {
      expect(sql).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`);
    }

    // Only service-role / admin actors may change enforcement columns.
    expect(sql).toContain("auth.role() = 'service_role'");
    expect(sql).toContain("public.has_role('admin')");
  });

  it("blocks non-service-role content status changes except the two owner transitions", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.validate_listing_status_transition()");

    // Actor gate is evaluated before the transition matrix.
    expect(sql).toContain("auth.role() IS NULL OR auth.role() = 'service_role'");
    expect(sql).toContain("requires moderation privileges");

    // The only transitions allowed for owners: submit draft, hide live.
    expect(sql).toContain("(OLD.status = 'draft' AND NEW.status = 'pending_moderation')");
    expect(sql).toContain("(OLD.status = 'live'  AND NEW.status = 'hidden')");

    // Applied to all three content tables via the 20260322000000 triggers,
    // plus the monetization/counter guard on each table.
    for (const table of ["listings", "businesses", "promotions"]) {
      expect(sql).toContain(`BEFORE UPDATE ON public.${table}`);
    }
    for (const column of [
      "boost_until",
      "featured_until",
      "urgent_until",
      "view_count",
      "click_count",
      "approved_edit_count",
    ]) {
      expect(sql).toContain(`'${column}'`);
    }
  });

  it("drops the verification_sessions owner UPDATE policy and guards signal columns", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "Owner updates own session"');
    expect(sql).toContain("public.verification_sessions");
    expect(sql).toContain("CREATE TRIGGER guard_verification_session_signals");
    expect(sql).toContain("phone_verified_at");
    expect(sql).toContain("finalized_at");
  });

  it("revokes claim_free_post_slot from authenticated and guards the caller in-function", () => {
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.claim_free_post_slot(UUID, marketplace_area, UUID, INTEGER) FROM authenticated;"
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.claim_free_post_slot(UUID, marketplace_area, UUID, INTEGER) TO service_role;"
    );
    expect(sql).toContain("auth.role() <> 'service_role'");
    expect(sql).toContain("p_user_id IS DISTINCT FROM auth.uid()");
  });

  it("creates the increment_strikes RPC as service-role only", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.increment_strikes(owner_id_input UUID)"
    );
    expect(sql).toContain("SET strikes = strikes + 1");
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.increment_strikes(UUID) FROM authenticated;"
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.increment_strikes(UUID) TO service_role;"
    );
  });
});

describe("data integrity & retention migration (20260724020100)", () => {
  const sql = readMigration(DATA_INTEGRITY_MIGRATION);

  it("creates the entitlements (user_id, area, type) unique index", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_user_area_type_unique"
    );
    expect(sql).toMatch(/ON\s+public\.entitlements\s+\(user_id, area, type\)/);
  });

  it("creates the invoices payment_id unique index", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_payment_id_unique");
    expect(sql).toMatch(/ON\s+public\.invoices\s+\(payment_id\)/);
  });

  it("creates contact_submissions with RLS enabled", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.contact_submissions");
    expect(sql).toContain("ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;");
  });

  it("adds the single-active-challenge index and retention cron for otp_challenges", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS otp_challenges_user_id_phone_key");
    expect(sql).toContain("WHERE verified_at IS NULL");
    expect(sql).toContain("retention_otp_challenges_90d");
  });

  it("restores the retention-sweep indexes", () => {
    for (const index of [
      "idx_listings_expired_delete",
      "idx_businesses_expired_delete",
      "idx_promotions_expired_delete",
      "idx_media_uploads_orphan",
    ]) {
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS ${index}`);
    }
  });
});

describe("historic migration repairs", () => {
  it("20260224000002_feature_flags.sql starts cleanly (no stray leading byte)", () => {
    const sql = readMigration("20260224000002_feature_flags.sql");
    const firstToken = sql.trimStart().slice(0, 2);
    expect(firstToken).toBe("--");
  });

  it("no CREATE INDEX CONCURRENTLY remains in migration files", () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql"));

    for (const file of files) {
      const sql = readMigration(file);
      expect(sql, `${file} must not use CONCURRENTLY (breaks db push transactions)`).not.toMatch(
        /CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i
      );
    }
  });
});

describe("claim_free_post_slot privilege posture", () => {
  it("no migration after 20260723000000 grants claim_free_post_slot to authenticated", () => {
    const grantRegex =
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.claim_free_post_slot\s*\([^)]*\)\s+TO\s+authenticated/i;

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .filter((file) => file.slice(0, 14) > LEGACY_AREAS_MIGRATION_PREFIX);

    const offenders = files.filter((file) => grantRegex.test(readMigration(file)));
    expect(offenders).toEqual([]);
  });

  it("a migration after 20260723000000 revokes claim_free_post_slot from authenticated", () => {
    const revokeRegex =
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.claim_free_post_slot\s*\([^)]*\)\s+FROM\s+authenticated/i;

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .filter((file) => file.slice(0, 14) > LEGACY_AREAS_MIGRATION_PREFIX);

    const revokers = files.filter((file) => revokeRegex.test(readMigration(file)));
    expect(revokers.length).toBeGreaterThan(0);
  });
});
