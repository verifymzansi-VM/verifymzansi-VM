/* eslint-disable no-console */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

type Args = {
  envFile: string | null;
  json: boolean;
  strict: boolean;
  projectRef: string | null;
};

type ProjectResponse = {
  ref: string;
  name: string;
};

type PerformanceAdvisorResponse = {
  lints?: AdvisorLint[];
};

type AdvisorLint = {
  name: string;
  title: string;
  level: string;
  categories?: string[];
  description?: string;
  detail?: string;
  remediation?: string;
  metadata?: Record<string, unknown>;
};

type IndexMetadataRow = {
  schema_name: string;
  table_name: string;
  index_name: string;
  index_columns: string[];
  is_partial: boolean;
  matching_foreign_keys: string[];
};

type ClassifiedLint = {
  lint: AdvisorLint;
  state: "actionable" | "accepted";
  reason: string;
};

const acceptedApplicationIndexes: Record<string, string> = {
  idx_account_profiles_suspended_active:
    "Partial guardrail for suspended-account checks used by auth gates and admin intelligence pages.",
};

function printUsage(): void {
  console.log("");
  console.log("Check Supabase Performance Advisor findings for the current project");
  console.log("");
  console.log(
    "Usage: pnpm supabase:advisor:performance -- [--env-file=.env.local] [--project-ref=<ref>] [--json] [--strict]"
  );
  console.log("Example: pnpm supabase:advisor:performance -- --strict");
  console.log("");
}

function takeOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    envFile: null,
    json: false,
    strict: false,
    projectRef: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--env-file") {
      args.envFile = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--env-file=")) {
      args.envFile = arg.slice("--env-file=".length);
      continue;
    }

    if (arg === "--project-ref") {
      args.projectRef = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--project-ref=")) {
      args.projectRef = arg.slice("--project-ref=".length);
      continue;
    }

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--strict") {
      args.strict = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function loadEnvFile(envFile: string | null): Promise<void> {
  loadEnvConfig(process.cwd());

  const candidateFiles = envFile ? [envFile] : [".env.local", ".env"];

  for (const candidateFile of candidateFiles) {
    const resolvedPath = path.isAbsolute(candidateFile)
      ? candidateFile
      : path.join(process.cwd(), candidateFile);

    let content: string;
    try {
      content = await readFile(resolvedPath, "utf8");
    } catch (error) {
      if (
        !envFile &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }

      throw error;
    }

    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex < 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function resolveProjectRef(explicitRef: string | null): string {
  if (explicitRef) {
    return explicitRef;
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || "";

  if (!supabaseUrl) {
    throw new Error(
      "Missing Supabase project reference. Set NEXT_PUBLIC_SUPABASE_URL or pass --project-ref=<ref>."
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid http(s) URL.");
  }

  const ref = parsedUrl.hostname.split(".")[0]?.trim();
  if (!ref) {
    throw new Error("Could not derive project ref from NEXT_PUBLIC_SUPABASE_URL.");
  }

  return ref;
}

async function fetchManagementApi<T>(
  token: string,
  pathname: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`https://api.supabase.com/v1${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase Management API ${pathname} failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

function extractIndexName(lint: AdvisorLint): string | null {
  const match = lint.detail?.match(/Index \\?`([^`\\]+)\\?`/u);
  return match?.[1] ?? null;
}

async function fetchIndexMetadata(
  token: string,
  projectRef: string
): Promise<Map<string, IndexMetadataRow>> {
  const rows = await fetchManagementApi<IndexMetadataRow[]>(
    token,
    `/projects/${projectRef}/database/query`,
    {
      method: "POST",
      body: JSON.stringify({
        query: `
          WITH foreign_keys AS (
            SELECT
              table_namespace.nspname AS schema_name,
              table_class.relname AS table_name,
              constraint_record.conname AS constraint_name,
              array_agg(attribute_record.attname ORDER BY key_record.ordinality) AS columns
            FROM pg_constraint AS constraint_record
            JOIN pg_class AS table_class
              ON table_class.oid = constraint_record.conrelid
            JOIN pg_namespace AS table_namespace
              ON table_namespace.oid = table_class.relnamespace
            JOIN unnest(constraint_record.conkey) WITH ORDINALITY AS key_record(attnum, ordinality)
              ON true
            JOIN pg_attribute AS attribute_record
              ON attribute_record.attrelid = table_class.oid
              AND attribute_record.attnum = key_record.attnum
            WHERE constraint_record.contype = 'f'
            GROUP BY table_namespace.nspname, table_class.relname, constraint_record.conname
          ),
          indexes AS (
            SELECT
              index_namespace.nspname AS schema_name,
              table_class.relname AS table_name,
              index_class.relname AS index_name,
              index_record.indpred IS NOT NULL AS is_partial,
              ARRAY(
                SELECT attribute_record.attname
                FROM unnest(index_record.indkey) WITH ORDINALITY AS key_record(attnum, ordinality)
                JOIN pg_attribute AS attribute_record
                  ON attribute_record.attrelid = table_class.oid
                  AND attribute_record.attnum = key_record.attnum
                WHERE key_record.attnum > 0
                ORDER BY key_record.ordinality
              ) AS index_columns
            FROM pg_index AS index_record
            JOIN pg_class AS index_class
              ON index_class.oid = index_record.indexrelid
            JOIN pg_namespace AS index_namespace
              ON index_namespace.oid = index_class.relnamespace
            JOIN pg_class AS table_class
              ON table_class.oid = index_record.indrelid
            WHERE index_namespace.nspname = 'public'
          )
          SELECT
            indexes.schema_name,
            indexes.table_name,
            indexes.index_name,
            indexes.index_columns,
            indexes.is_partial,
            COALESCE(
              jsonb_agg(foreign_keys.constraint_name ORDER BY foreign_keys.constraint_name)
                FILTER (WHERE foreign_keys.constraint_name IS NOT NULL),
              '[]'::jsonb
            ) AS matching_foreign_keys
          FROM indexes
          LEFT JOIN foreign_keys
            ON foreign_keys.schema_name = indexes.schema_name
            AND foreign_keys.table_name = indexes.table_name
            AND indexes.index_columns[1:array_length(foreign_keys.columns, 1)] = foreign_keys.columns
          GROUP BY
            indexes.schema_name,
            indexes.table_name,
            indexes.index_name,
            indexes.index_columns,
            indexes.is_partial
          ORDER BY indexes.schema_name, indexes.table_name, indexes.index_name;
        `,
      }),
    }
  );

  return new Map(rows.map((row) => [row.index_name, row]));
}

function classifyLint(
  lint: AdvisorLint,
  indexMetadata: Map<string, IndexMetadataRow>
): ClassifiedLint {
  if (lint.name !== "unused_index") {
    return {
      lint,
      state: "actionable",
      reason: "This performance finding is not part of the accepted unused-index baseline.",
    };
  }

  const indexName = extractIndexName(lint);
  if (!indexName) {
    return {
      lint,
      state: "actionable",
      reason: "The advisor finding did not include a parseable index name.",
    };
  }

  const acceptedApplicationReason = acceptedApplicationIndexes[indexName];
  if (acceptedApplicationReason) {
    return {
      lint,
      state: "accepted",
      reason: acceptedApplicationReason,
    };
  }

  const metadata = indexMetadata.get(indexName);
  if (metadata && !metadata.is_partial && metadata.matching_foreign_keys.length > 0) {
    return {
      lint,
      state: "accepted",
      reason: `Keeps foreign key checks indexed for ${metadata.matching_foreign_keys.join(", ")}.`,
    };
  }

  return {
    lint,
    state: "actionable",
    reason:
      "Unused index is not recognized as a foreign-key support index or documented application guardrail.",
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await loadEnvFile(args.envFile);

  const accessToken = requireEnv("SUPABASE_ACCESS_TOKEN");
  const projectRef = resolveProjectRef(args.projectRef);

  const [project, performanceAdvisor, indexMetadata] = await Promise.all([
    fetchManagementApi<ProjectResponse>(accessToken, `/projects/${projectRef}`),
    fetchManagementApi<PerformanceAdvisorResponse>(
      accessToken,
      `/projects/${projectRef}/advisors/performance`
    ),
    fetchIndexMetadata(accessToken, projectRef),
  ]);

  const rawLints = performanceAdvisor.lints ?? [];
  const classifiedLints = rawLints.map((lint) => classifyLint(lint, indexMetadata));
  const actionable = classifiedLints.filter((lint) => lint.state === "actionable");
  const accepted = classifiedLints.filter((lint) => lint.state === "accepted");

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          project: {
            ref: project.ref,
            name: project.name,
          },
          summary: {
            total: classifiedLints.length,
            actionable: actionable.length,
            accepted: accepted.length,
          },
          findings: classifiedLints.map((item) => ({
            name: item.lint.name,
            title: item.lint.title,
            level: item.lint.level,
            state: item.state,
            reason: item.reason,
            detail: item.lint.detail ?? null,
            remediation: item.lint.remediation ?? null,
          })),
        },
        null,
        2
      )
    );
  } else {
    console.log(`Supabase project: ${project.name} (${project.ref})`);
    console.log("");

    if (classifiedLints.length === 0) {
      console.log("Performance Advisor reports no current performance findings.");
    } else {
      console.log(
        `Performance Advisor findings: ${classifiedLints.length} total (${actionable.length} actionable, ${accepted.length} accepted)`
      );

      for (const item of classifiedLints) {
        console.log("");
        console.log(`[${item.state.toUpperCase()}] ${item.lint.title} (${item.lint.name})`);
        console.log(`Level: ${item.lint.level}`);
        console.log(`Reason: ${item.reason}`);
        if (item.lint.detail) {
          console.log(`Detail: ${item.lint.detail}`);
        }
        if (item.lint.remediation) {
          console.log(`Remediation: ${item.lint.remediation}`);
        }
      }
    }
  }

  if (args.strict && actionable.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    "Supabase Performance Advisor check failed:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
