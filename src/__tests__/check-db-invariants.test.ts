import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findLegacyIdentifierReferences } from "../../scripts/check-db-invariants";

const tempDirs: string[] = [];

function createTempMigrationsDir(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vmz-db-invariants-"));
  tempDirs.push(root);

  for (const [fileName, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, fileName), content, "utf8");
  }

  return root;
}

describe("check-db-invariants", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores legacy identifiers in comments after the hard rename", () => {
    const migrationsDir = createTempMigrationsDir({
      "20260324000000_fix_account_profiles_rls_policies.sql":
        "-- Fix RLS policies on account_profiles table after hard rename from seller_profiles\nSELECT 1;\n",
    });

    expect(findLegacyIdentifierReferences(migrationsDir)).toEqual([]);
  });

  it("fails when a post-rename migration references seller_profiles in SQL", () => {
    const migrationsDir = createTempMigrationsDir({
      "20260324000000_bad_follow_up.sql":
        "ALTER TABLE public.seller_profiles ADD COLUMN legacy_flag boolean;\n",
    });

    expect(findLegacyIdentifierReferences(migrationsDir)).toEqual([
      {
        file: "20260324000000_bad_follow_up.sql",
        identifier: "seller_profiles",
      },
    ]);
  });

  it("fails when a post-rename migration references seller_verification_status in SQL", () => {
    const migrationsDir = createTempMigrationsDir({
      "20260324000001_bad_enum_follow_up.sql":
        "ALTER TYPE public.seller_verification_status ADD VALUE 'legacy';\n",
    });

    expect(findLegacyIdentifierReferences(migrationsDir)).toEqual([
      {
        file: "20260324000001_bad_enum_follow_up.sql",
        identifier: "seller_verification_status",
      },
    ]);
  });
});
