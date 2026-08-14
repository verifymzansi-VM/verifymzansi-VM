/* eslint-disable no-console */

import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

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

async function fetchTableRows(baseUrl: string, table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  const pageSize = 1_000;

  for (let start = 0; ; start += pageSize) {
    const response = await fetch(`${baseUrl}/rest/v1/${table}?select=*`, {
      headers: getApiHeaders({ Range: `${start}-${start + pageSize - 1}` }),
    });

    if (!response.ok) {
      throw new Error(`Could not read ${table}: HTTP ${response.status}.`);
    }

    const page: unknown = await response.json();
    if (!Array.isArray(page)) {
      throw new Error(`Unexpected response while reading ${table}.`);
    }

    rows.push(...page);
    if (page.length < pageSize) {
      return rows;
    }
  }
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
  console.log(`Creating Supabase backup in ${backupDirectory}`);

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/u, "");
  const openApiResponse = await fetch(`${baseUrl}/rest/v1/`, { headers: getApiHeaders() });
  if (!openApiResponse.ok) {
    throw new Error(
      `Could not read the Supabase OpenAPI document: HTTP ${openApiResponse.status}.`
    );
  }

  const tableNames = getPublicTableNames((await openApiResponse.json()) as OpenApiDocument);
  const data: Record<string, unknown[]> = {};
  for (const table of tableNames) {
    data[table] = await fetchTableRows(baseUrl, table);
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
    "Backup completed. Store a copy outside this workspace if it contains production data."
  );
}

main().catch((error) => {
  console.error("Supabase backup failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
