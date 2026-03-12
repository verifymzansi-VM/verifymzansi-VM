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

export const OWNER_COMPAT_TABLES = ["listings", "promotions", "businesses"] as const;
export type OwnerCompatibilityMode = "owner_id" | "seller_id";

type SchemaTableCheck = {
  table: string;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

type OwnerColumnCheck = {
  table: (typeof OWNER_COMPAT_TABLES)[number];
  ok: boolean;
  mode: OwnerCompatibilityMode | null;
  ownerIdError: string | null;
  sellerIdError: string | null;
};

export type SchemaVerificationResult = {
  ok: boolean;
  projectUrl: string;
  checks: SchemaTableCheck[];
  ownerColumnChecks: OwnerColumnCheck[];
  missingTables: string[];
  missingOwnerColumns: string[];
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

  const ownerColumnChecks: OwnerColumnCheck[] = [];
  for (const table of OWNER_COMPAT_TABLES) {
    const ownerResult = await supabase.from(table).select("id, owner_id").limit(1);
    const sellerResult = await supabase.from(table).select("id, seller_id").limit(1);

    const ownerWorks = !ownerResult.error;
    const sellerWorks = !sellerResult.error;
    const mode = ownerWorks ? "owner_id" : sellerWorks ? "seller_id" : null;

    ownerColumnChecks.push({
      table,
      ok: mode !== null,
      mode,
      ownerIdError: ownerResult.error?.message ?? null,
      sellerIdError: sellerResult.error?.message ?? null,
    });
  }

  const missingOwnerColumns = ownerColumnChecks
    .filter((item) => !item.ok)
    .map((item) => item.table);

  return {
    ok: missingTables.length === 0 && otherErrors.length === 0 && missingOwnerColumns.length === 0,
    projectUrl,
    checks,
    ownerColumnChecks,
    missingTables,
    missingOwnerColumns,
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

  console.log("");
  console.log("Ownership column compatibility");
  for (const check of result.ownerColumnChecks) {
    if (check.ok && check.mode) {
      console.log(`  [OK] ${check.table} -> ${check.mode}`);
      continue;
    }

    console.log(
      `  [FAIL] ${check.table} (owner_id: ${check.ownerIdError || "missing"}, seller_id: ${check.sellerIdError || "missing"})`
    );
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

  if (result.missingOwnerColumns.length > 0) {
    console.log(`Ownership compatibility missing on: ${result.missingOwnerColumns.join(", ")}`);
    console.log("Each marketplace table must expose either owner_id or seller_id.");
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
