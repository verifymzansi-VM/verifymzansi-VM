import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase",
    "migrations",
    "20260927100000_lift_expired_suspensions.sql"
  ),
  "utf8"
);

describe("lift expired suspensions migration (20260927100000)", () => {
  it("only lifts suspensions whose end time has passed", () => {
    expect(sql).toContain("WHERE account_status = 'suspended'");
    expect(sql).toContain("suspended_until <= now()");
    expect(sql).not.toMatch(/account_status\s*=\s*'banned'/);
  });

  it("writes the audit row in the same statement as the status change", () => {
    expect(sql).toMatch(/WITH lifted AS \(\s*UPDATE public\.account_profiles/);
    expect(sql).toContain("INSERT INTO public.audit_logs");
    expect(sql).toContain("'account_unsuspended'");
  });

  it("is not callable by members and runs every five minutes", () => {
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.lift_expired_suspensions() FROM PUBLIC, anon, authenticated"
    );
    expect(sql).toContain("SET search_path = pg_catalog, public");
    expect(sql).not.toContain("SECURITY DEFINER");
    expect(sql).toContain("cron.schedule('lift-expired-suspensions', '*/5 * * * *'");
  });
});
