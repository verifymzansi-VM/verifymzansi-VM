/* eslint-disable no-console */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type Invariant = {
  name: string;
  regex: RegExp;
  guidance: string;
};

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

const INVARIANTS: Invariant[] = [
  {
    name: "Unique normalized business slug index",
    regex:
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_businesses_slug_unique\s+ON\s+public\.businesses\s*\(\(lower\(slug\)\)\)/i,
    guidance: "Add a migration that enforces a unique normalized index for public.businesses.slug.",
  },
];

function readMigrationCorpus(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  return files
    .map((file) => `-- FILE: ${file}\n${readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")}`)
    .join("\n\n");
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

main().catch((error) => {
  console.error("DB invariant check crashed:", error);
  process.exit(1);
});
