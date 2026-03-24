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
