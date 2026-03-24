import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("account_profiles RLS migration guard", () => {
  it("keeps the fix migration aligned with the expected account_profiles policies", () => {
    const migrationPath = path.resolve(
      process.cwd(),
      "supabase",
      "migrations",
      "20260324000000_fix_account_profiles_rls_policies.sql"
    );
    const migration = fs.readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      'CREATE POLICY "Owner or admin updates profile" ON public.account_profiles FOR UPDATE'
    );
    expect(migration).toContain(
      "USING ((select auth.uid()) = user_id OR (select public.has_role('admin')))"
    );
    expect(migration).toContain(
      "WITH CHECK ((select auth.uid()) = user_id OR (select public.has_role('admin')))"
    );

    expect(migration).toContain(
      'CREATE POLICY "Owner reads own profile" ON public.account_profiles FOR SELECT'
    );
    expect(migration).toContain(
      'CREATE POLICY "Owner creates profile" ON public.account_profiles FOR INSERT'
    );
    expect(migration).toContain(
      'CREATE POLICY "Admin deletes profile" ON public.account_profiles FOR DELETE'
    );
  });
});
