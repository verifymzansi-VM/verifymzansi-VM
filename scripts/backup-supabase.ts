/* eslint-disable no-console */

import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { exportSupabaseTable } from "./lib/export-supabase-table";

const workspaceRoot = process.cwd();
const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
const backupRoot = path.resolve(
  workspaceRoot,
  process.env.SUPABASE_BACKUP_DIR || "tmp/supabase-backups"
);
const backupDirectory = path.join(backupRoot, timestamp);

function requireBackupCredentials(): void {
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter(
    (name) => !process.env[name]
  );

  if (missing.length > 0) {
    throw new Error(`Missing required backup credentials: ${missing.join(", ")}`);
  }
}

type OpenApiDocument = {
  paths: Record<string, unknown>;
};

function getApiHeaders(extra: Record<string, string> = {}): HeadersInit {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
}

function getPublicTableNames(document: OpenApiDocument): string[] {
  return Object.keys(document.paths)
    .filter((route) => /^\/[a-z][a-z0-9_]*$/u.test(route))
    .map((route) => route.slice(1))
    .sort();
}

async function copyMigrations(destination: string): Promise<string[]> {
  const migrationsDirectory = path.join(workspaceRoot, "supabase", "migrations");
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  const backupMigrationsDirectory = path.join(destination, "migrations");
  await mkdir(backupMigrationsDirectory, { recursive: true });

  await Promise.all(
    files.map((file) =>
      copyFile(path.join(migrationsDirectory, file), path.join(backupMigrationsDirectory, file))
    )
  );

  return files;
}

async function main(): Promise<void> {
  loadEnvConfig(workspaceRoot);
  requireBackupCredentials();

  await mkdir(backupDirectory, { recursive: true });
  console.log(`Creating supplemental Supabase REST export in ${backupDirectory}`);
  console.warn(
    "This export is not a consistent database backup. Verify a restorable database backup before migrating."
  );

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/u, "");
  const openApiResponse = await fetch(`${baseUrl}/rest/v1/`, {
    headers: getApiHeaders(),
    signal: AbortSignal.timeout(60_000),
  });
  if (!openApiResponse.ok) {
    throw new Error(
      `Could not read the Supabase OpenAPI document: HTTP ${openApiResponse.status}.`
    );
  }

  const tableNames = getPublicTableNames((await openApiResponse.json()) as OpenApiDocument);
  if (tableNames.length === 0)
    throw new Error("No public tables discovered; refusing an empty export.");
  const data: Record<string, unknown[]> = {};
  for (const table of tableNames) {
    data[table] = await exportSupabaseTable(baseUrl, table, getApiHeaders());
  }

  const migrationFiles = await copyMigrations(backupDirectory);
  await writeFile(
    path.join(backupDirectory, "public-data.json"),
    `${JSON.stringify(data)}\n`,
    "utf8"
  );

  await writeFile(
    path.join(backupDirectory, "manifest.json"),
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        projectRef: process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([^.]+)/u)?.[1] ?? null,
        tables: tableNames,
        rowCounts: Object.fromEntries(tableNames.map((table) => [table, data[table].length])),
        migrationFiles,
        scope: "public data exported through the REST API, plus local schema migrations",
        consistentSnapshot: false,
        restorableDatabaseBackup: false,
        excluded: [
          "Supabase Auth users",
          "Supabase Storage objects",
          "Cloudflare R2 objects",
          "database roles",
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(
    "Supplemental export completed; restoration is not verified. Store sensitive exports securely outside this workspace."
  );
}

main().catch((error) => {
  console.error("Supabase backup failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
