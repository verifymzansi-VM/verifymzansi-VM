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

export const LEGACY_FORBIDDEN_TABLES = ["seller_profiles"] as const;

export const REQUIRED_ACCOUNT_PROFILE_COLUMNS = [
  "id",
  "user_id",
  "display_name",
  "phone",
  "pending_phone",
  "account_verification_status",
  "account_status",
  "location_verified_at",
  "legal_name_locked_at",
  "contact_last_phone_change_at",
  "contact_last_email_change_at",
  "pending_email",
  "suspended_until",
  "legal_hold",
  "created_at",
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

type LegacyTableCheck = {
  table: string;
  absent: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

type AccountProfileColumnCheck = {
  table: typeof ACCOUNT_PROFILE_TABLE_NAME;
  columns: readonly string[];
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

const ACCOUNT_PROFILE_TABLE_NAME = "account_profiles" as const;

export type SchemaVerificationResult = {
  ok: boolean;
  projectUrl: string;
  checks: SchemaTableCheck[];
  accountProfileColumnCheck: AccountProfileColumnCheck | null;
  legacyTableChecks: LegacyTableCheck[];
  ownerColumnChecks: OwnerColumnCheck[];
  missingTables: string[];
  unexpectedLegacyTables: string[];
  missingOwnerColumns: string[];
  otherErrors: Array<{ table: string; code: string; message: string }>;
  legacyTableErrors: Array<{ table: string; code: string; message: string }>;
};

type VerifyOptions = {
  url?: string;
  serviceRoleKey?: string;
  tables?: readonly string[];
  legacyTables?: readonly string[];
  requireAccountProfileColumns?: boolean;
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
  const legacyTables = options.legacyTables ?? LEGACY_FORBIDDEN_TABLES;
  const requireAccountProfileColumns = options.requireAccountProfileColumns ?? true;

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

  const legacyTableChecks: LegacyTableCheck[] = [];
  for (const table of legacyTables) {
    const { error } = await supabase.from(table).select("id, created_at").limit(1);
    const absent = error?.code === "PGRST205";
    legacyTableChecks.push({
      table,
      absent,
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
    });
  }

  const unexpectedLegacyTables = legacyTableChecks
    .filter((item) => !item.absent && item.errorCode === null)
    .map((item) => item.table);

  const legacyTableErrors = legacyTableChecks
    .filter((item) => !item.absent && item.errorCode !== null)
    .map((item) => ({
      table: item.table,
      code: item.errorCode ?? "unknown",
      message: item.errorMessage ?? "Unknown error",
    }));

  let accountProfileColumnCheck: AccountProfileColumnCheck | null = null;
  if (requireAccountProfileColumns && tables.includes(ACCOUNT_PROFILE_TABLE_NAME)) {
    const columnSelect = REQUIRED_ACCOUNT_PROFILE_COLUMNS.join(", ");
    const { error } = await supabase.from(ACCOUNT_PROFILE_TABLE_NAME).select(columnSelect).limit(1);
    accountProfileColumnCheck = {
      table: ACCOUNT_PROFILE_TABLE_NAME,
      columns: REQUIRED_ACCOUNT_PROFILE_COLUMNS,
      ok: !error,
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
    };
  }

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
    ok:
      missingTables.length === 0 &&
      otherErrors.length === 0 &&
      missingOwnerColumns.length === 0 &&
      unexpectedLegacyTables.length === 0 &&
      legacyTableErrors.length === 0 &&
      (accountProfileColumnCheck?.ok ?? true),
    projectUrl,
    checks,
    accountProfileColumnCheck,
    legacyTableChecks,
    ownerColumnChecks,
    missingTables,
    unexpectedLegacyTables,
    missingOwnerColumns,
    otherErrors,
    legacyTableErrors,
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
  if (result.accountProfileColumnCheck) {
    if (result.accountProfileColumnCheck.ok) {
      console.log("Account profile column contract");
      console.log(
        `  [OK] ${result.accountProfileColumnCheck.table} exposes required columns: ${result.accountProfileColumnCheck.columns.join(", ")}`
      );
    } else {
      console.log("Account profile column contract");
      console.log(
        `  [FAIL] ${result.accountProfileColumnCheck.table} missing required columns (${result.accountProfileColumnCheck.errorCode ?? "unknown"}) ${result.accountProfileColumnCheck.errorMessage ?? "Unknown error"}`
      );
    }
    console.log("");
  }

  console.log("Legacy table absence checks");
  for (const check of result.legacyTableChecks) {
    if (check.absent) {
      console.log(`  [OK] ${check.table} is absent (as expected)`);
      continue;
    }

    if (check.errorCode) {
      console.log(
        `  [FAIL] ${check.table} check errored (${check.errorCode}) ${check.errorMessage ?? "Unknown error"}`
      );
      continue;
    }

    console.log(`  [FAIL] ${check.table} is still queryable (legacy table should be gone)`);
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

  if (result.accountProfileColumnCheck && !result.accountProfileColumnCheck.ok) {
    console.log(
      `Account profile column contract failed for ${result.accountProfileColumnCheck.table}. Required columns: ${result.accountProfileColumnCheck.columns.join(", ")}`
    );
  }

  if (result.unexpectedLegacyTables.length > 0) {
    console.log(`Legacy tables still queryable: ${result.unexpectedLegacyTables.join(", ")}`);
    console.log(
      "The hard rename is incomplete. Ensure old seller_* tables are removed from runtime contract."
    );
  }

  if (result.legacyTableErrors.length > 0) {
    console.log("Legacy table checks returned unexpected errors:");
    for (const error of result.legacyTableErrors) {
      console.log(`  - ${error.table}: [${error.code}] ${error.message}`);
    }
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
