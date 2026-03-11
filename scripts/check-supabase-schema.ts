/* eslint-disable no-console */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

export const REQUIRED_TABLES = [
  "listings",
  "promotions",
  "account_profiles",
  "plans",
  "storefronts",
  "businesses",
  "otp_challenges",
  "verification_steps",
  "verification_sessions",
  "kyc_artifacts",
] as const;

type SchemaTableCheck = {
  table: string;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

export type SchemaVerificationResult = {
  ok: boolean;
  projectUrl: string;
  checks: SchemaTableCheck[];
  missingTables: string[];
  otherErrors: Array<{ table: string; code: string; message: string }>;
};

type VerifyOptions = {
  url?: string;
  serviceRoleKey?: string;
  tables?: readonly string[];
};

function requireEnv(name: string, value?: string): string {
  const resolved = value ?? process.env[name];
  if (!resolved) {
    throw new Error(`Missing env var: ${name}`);
  }
  return resolved;
}

export async function verifySupabaseSchema(
  options: VerifyOptions = {}
): Promise<SchemaVerificationResult> {
  const projectUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", options.url);
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", options.serviceRoleKey);
  const tables = options.tables ?? REQUIRED_TABLES;

  const supabase = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const checks: SchemaTableCheck[] = [];

  for (const table of tables) {
    const { error } = await supabase.from(table).select("id, created_at").limit(1);
    checks.push({
      table,
      ok: !error,
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
    });
  }

  const missingTables = checks
    .filter((item) => item.errorCode === "PGRST205")
    .map((item) => item.table);

  const otherErrors = checks
    .filter((item) => !item.ok && item.errorCode !== "PGRST205")
    .map((item) => ({
      table: item.table,
      code: item.errorCode ?? "unknown",
      message: item.errorMessage ?? "Unknown error",
    }));

  return {
    ok: missingTables.length === 0 && otherErrors.length === 0,
    projectUrl,
    checks,
    missingTables,
    otherErrors,
  };
}

export function printSchemaVerificationResult(result: SchemaVerificationResult): void {
  console.log("");
  console.log("Supabase schema verification");
  console.log(`Project: ${result.projectUrl}`);
  console.log("");

  for (const check of result.checks) {
    if (check.ok) {
      console.log(`  [OK] ${check.table}`);
      continue;
    }

    const code = check.errorCode ?? "unknown";
    const message = check.errorMessage ?? "Unknown error";
    console.log(`  [FAIL] ${check.table} (${code}) ${message}`);
  }

  if (result.ok) {
    console.log("");
    console.log("Schema verification passed.");
    return;
  }

  console.log("");
  if (result.missingTables.length > 0) {
    console.log(
      `Missing from PostgREST schema cache (PGRST205): ${result.missingTables.join(", ")}`
    );
    console.log(
      "Apply migrations to the linked Supabase project and refresh PostgREST schema cache:"
    );
    console.log("  1) supabase db push");
    console.log("  2) NOTIFY pgrst, 'reload schema';");
  }

  if (result.otherErrors.length > 0) {
    console.log("Additional Supabase errors:");
    for (const error of result.otherErrors) {
      console.log(`  - ${error.table}: [${error.code}] ${error.message}`);
    }
  }
}

async function runCli(): Promise<void> {
  const result = await verifySupabaseSchema();
  printSchemaVerificationResult(result);

  if (!result.ok) {
    process.exit(1);
  }
}

const currentScriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (currentScriptPath.endsWith("/scripts/check-supabase-schema.ts")) {
  runCli().catch((error) => {
    console.error("Schema verification crashed:", error);
    process.exit(1);
  });
}
