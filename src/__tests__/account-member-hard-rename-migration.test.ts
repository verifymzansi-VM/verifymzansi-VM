import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("account/member hard rename migration guard", () => {
  it("keeps the seller to account cutover and retention-cron rewrites intact", () => {
    const migrationPath = path.resolve(
      process.cwd(),
      "supabase",
      "migrations",
      "20260311120000_hard_rename_account_member.sql"
    );
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain("ALTER TABLE public.seller_profiles");
    expect(migration).toContain("RENAME TO account_profiles;");
    expect(migration).toContain("DROP TYPE IF EXISTS public.seller_verification_status;");

    expect(migration).toContain("'retention_rejected_kyc_30d'");
    expect(migration).toContain("'retention_contact_events_12mo'");
    expect(migration).toContain("'retention_audit_logs_24mo'");
    expect(migration).toContain("'queue_r2_rejected_kyc_cleanup'");
    expect(migration).toContain("'queue_r2_approved_kyc_purge_30d'");

    expect(migration).toContain("FROM account_profiles ap");
    expect(migration).toContain("WHERE ap.user_id = kyc_artifacts.user_id");
    expect(migration).toContain("WHERE ap.user_id = contact_events.owner_id");
    expect(migration).toContain("WHERE ap.user_id = audit_logs.actor_id");
    expect(migration).toContain("WHERE ap.user_id = ka.user_id");
  });
});
