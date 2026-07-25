/* eslint-disable no-console */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type Invariant = {
  name: string;
  regex: RegExp;
  guidance: string;
};

type LegacyIdentifierCheckFailure = {
  file: string;
  identifier: string;
};

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const HARD_RENAME_MIGRATION_PREFIX = "20260311120000";
const LEGACY_IDENTIFIERS = ["seller_profiles", "seller_verification_status"] as const;

const INVARIANTS: Invariant[] = [
  {
    name: "Unique normalized business slug index",
    regex:
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_businesses_slug_unique\s+ON\s+public\.businesses\s*\(\(lower\(slug\)\)\)/i,
    guidance: "Add a migration that enforces a unique normalized index for public.businesses.slug.",
  },
  {
    name: "Basic plan tier enum value",
    regex: /ALTER\s+TYPE\s+public\.plan_tier\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+'basic'/i,
    guidance: "Add a migration enabling the Basic package in public.plan_tier.",
  },
  {
    name: "Pending verification entitlement status",
    regex:
      /ALTER\s+TYPE\s+public\.entitlement_status\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+'pending_verification'/i,
    guidance:
      "Add a migration enabling pending_verification entitlements for restricted paid accounts.",
  },
  {
    name: "Mzansi Market Basic plan seed",
    regex:
      /INSERT\s+INTO\s+public\.plans[\s\S]+MZANSI_MARKET[\s\S]+basic[\s\S]+Mzansi Market Basic[\s\S]+3000/i,
    guidance: "Seed the active Mzansi Market Basic plan row at R30.00.",
  },
  {
    name: "Entitlements (user_id, area, type) unique index",
    regex:
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_entitlements_user_area_type_unique\s+ON\s+public\.entitlements\s*\(\s*user_id,\s*area,\s*type\s*\)/i,
    guidance:
      "Add a migration creating a unique index on public.entitlements (user_id, area, type) so the fulfillment upsert onConflict target exists.",
  },
  {
    name: "contact_submissions table",
    regex: /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.contact_submissions/i,
    guidance:
      "Add a migration creating public.contact_submissions (contact form inserts and the admin inbox read it).",
  },
  {
    name: "account_profiles enforcement-column guard trigger",
    regex:
      /CREATE\s+TRIGGER\s+guard_account_enforcement_columns\s+BEFORE\s+UPDATE\s+ON\s+public\.account_profiles/i,
    guidance:
      "Add a migration with a BEFORE UPDATE trigger on public.account_profiles that blocks non-service-role changes to enforcement columns (account_status, strikes, banned_at, ...).",
  },
];

export function getMigrationFiles(migrationsDir = MIGRATIONS_DIR): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function readMigrationCorpus(migrationsDir = MIGRATIONS_DIR): string {
  const files = getMigrationFiles(migrationsDir);

  return files
    .map((file) => `-- FILE: ${file}\n${readFileSync(path.join(migrationsDir, file), "utf8")}`)
    .join("\n\n");
}

function stripSingleLineComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => {
      const commentIndex = line.indexOf("--");
      return commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    })
    .join("\n");
}

export function findLegacyIdentifierReferences(
  migrationsDir = MIGRATIONS_DIR
): LegacyIdentifierCheckFailure[] {
  return getMigrationFiles(migrationsDir)
    .filter((file) => file.slice(0, 14) > HARD_RENAME_MIGRATION_PREFIX)
    .flatMap((file) => {
      const rawSql = readFileSync(path.join(migrationsDir, file), "utf8");
      const sql = stripSingleLineComments(rawSql);

      return LEGACY_IDENTIFIERS.filter((identifier) =>
        new RegExp(`\\b${identifier}\\b`, "i").test(sql)
      ).map((identifier) => ({ file, identifier }));
    });
}

const CLAIM_FREE_POST_SLOT_GRANT_REGEX =
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.claim_free_post_slot\s*\([^)]*\)\s+TO\s+authenticated/i;
const CLAIM_FREE_POST_SLOT_REVOKE_REGEX =
  /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.claim_free_post_slot\s*\([^)]*\)\s+FROM\s+authenticated/i;

/**
 * claim_free_post_slot takes p_user_id with no ownership check, so it must
 * never stay executable by authenticated. Walk migrations in order: if the
 * latest migration that grants EXECUTE to authenticated has no revoke in a
 * later migration, fail.
 */
export function findClaimFreePostSlotGrantFailures(migrationsDir = MIGRATIONS_DIR): string[] {
  const files = getMigrationFiles(migrationsDir);
  let latestGrantFile: string | null = null;
  let revokeAfterLatestGrant = false;

  for (const file of files) {
    const sql = stripSingleLineComments(readFileSync(path.join(migrationsDir, file), "utf8"));

    if (latestGrantFile !== null && CLAIM_FREE_POST_SLOT_REVOKE_REGEX.test(sql)) {
      revokeAfterLatestGrant = true;
    }
    if (CLAIM_FREE_POST_SLOT_GRANT_REGEX.test(sql)) {
      latestGrantFile = file;
      revokeAfterLatestGrant = false;
    }
  }

  if (latestGrantFile === null || revokeAfterLatestGrant) {
    return [];
  }

  return [
    `claim_free_post_slot is granted to authenticated in ${latestGrantFile} with no revoke in any later migration: add a migration that revokes EXECUTE from PUBLIC/anon/authenticated and grants it to service_role only.`,
  ];
}

async function main(): Promise<void> {
  console.log("Checking critical DB migration invariants...");

  const corpus = readMigrationCorpus();
  const failures: string[] = [];

  for (const invariant of INVARIANTS) {
    if (!invariant.regex.test(corpus)) {
      failures.push(`${invariant.name}: ${invariant.guidance}`);
      continue;
    }

    console.log(`  [OK] ${invariant.name}`);
  }

  const legacyIdentifierFailures = findLegacyIdentifierReferences();
  if (legacyIdentifierFailures.length === 0) {
    console.log("  [OK] No post-rename migrations reference legacy seller profile identifiers");
  } else {
    for (const failure of legacyIdentifierFailures) {
      failures.push(
        `Legacy identifier ${failure.identifier} found in post-rename migration ${failure.file}: remove seller_* profile references from migrations created after ${HARD_RENAME_MIGRATION_PREFIX}_hard_rename_account_member.sql.`
      );
    }
  }

  const claimFreePostSlotFailures = findClaimFreePostSlotGrantFailures();
  if (claimFreePostSlotFailures.length === 0) {
    console.log("  [OK] claim_free_post_slot is not left executable by authenticated");
  } else {
    failures.push(...claimFreePostSlotFailures);
  }

  if (failures.length > 0) {
    console.error("");
    console.error("DB invariant check failed:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log("DB invariant check passed.");
}

const currentScriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (currentScriptPath.endsWith("/scripts/check-db-invariants.ts")) {
  main().catch((error) => {
    console.error("DB invariant check crashed:", error);
    process.exit(1);
  });
}
