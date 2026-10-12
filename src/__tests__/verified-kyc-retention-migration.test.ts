// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const migration = readFileSync(
  "supabase/migrations/20261011204759_atomic_verified_kyc_retention.sql",
  "utf8"
);
const setup = `CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE account_profiles(user_id uuid PRIMARY KEY, account_verification_status text, legal_name_locked_at timestamptz);
CREATE TABLE verification_steps(user_id uuid, step_type text, status text, reviewed_at timestamptz, submitted_at timestamptz, phone_verified_at timestamptz);
CREATE TABLE kyc_artifacts(user_id uuid, purge_after timestamptz, purged_at timestamptz);
CREATE TABLE audit_logs(actor_id uuid, actor_role text, action text, target_type text, target_id uuid, metadata jsonb);`;
const id = "00000000-0000-4000-8000-000000000001";
describe("verified KYC retention migration", () => {
  it("uses historical approval evidence and preserves existing/purged deadlines", async () => {
    const db = new PGlite();
    try {
      await db.exec(setup);
      await db.exec(`INSERT INTO account_profiles VALUES('${id}','verified','2026-01-01');
        INSERT INTO kyc_artifacts VALUES('${id}',NULL,NULL),('${id}','2026-01-15',NULL),('${id}',NULL,'2026-01-10');`);
      await db.exec(migration);
      const result = await db.query<{ deadline_day: string | null }>(
        "SELECT to_char(purge_after,'YYYY-MM-DD') deadline_day FROM kyc_artifacts ORDER BY purge_after NULLS LAST"
      );
      expect(result.rows.map((r) => r.deadline_day)).toEqual(["2026-01-15", "2026-01-31", null]);
    } finally {
      await db.close();
    }
  });
  it("rejects unknown historical approval time rather than inventing a new retention window", async () => {
    const db = new PGlite();
    try {
      await db.exec(setup);
      await db.exec(
        `INSERT INTO account_profiles VALUES('${id}','verified',NULL); INSERT INTO kyc_artifacts VALUES('${id}',NULL,NULL);`
      );
      await expect(db.exec(migration)).rejects.toThrow(
        "requires reviewed historical approval timestamps"
      );
      await db.exec("ROLLBACK");
      expect(
        (await db.query<{ purge_after: unknown }>("SELECT purge_after FROM kyc_artifacts")).rows[0]
          .purge_after
      ).toBeNull();
    } finally {
      await db.close();
    }
  });
  it("covers verified inserts as well as updates and leaves nonverified profiles alone", async () => {
    const db = new PGlite();
    try {
      await db.exec(setup);
      await db.exec(migration);
      await db.exec(
        `INSERT INTO kyc_artifacts VALUES('${id}',NULL,NULL); INSERT INTO account_profiles VALUES('${id}','incomplete',NULL);`
      );
      expect(
        (await db.query<{ purge_after: unknown }>("SELECT purge_after FROM kyc_artifacts")).rows[0]
          .purge_after
      ).toBeNull();
      await db.exec(
        `DELETE FROM account_profiles; INSERT INTO account_profiles VALUES('${id}','verified',NULL);`
      );
      expect(
        (
          await db.query<{ scheduled: boolean }>(
            "SELECT purge_after IS NOT NULL scheduled FROM kyc_artifacts"
          )
        ).rows[0].scheduled
      ).toBe(true);
    } finally {
      await db.close();
    }
  });
});
