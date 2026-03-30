/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ScriptMode = "inventory" | "wipe";

type AuthUserRecord = {
  id: string;
  email: string | null;
  role: string | null;
  created_at: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

type TableSummary = {
  table: string;
  count: number;
};

type LaunchResetSnapshot = {
  generatedAt: string;
  projectRef: string;
  supabaseUrl: string;
  mode: ScriptMode;
  sourceEnvFile: string | null;
  authUsers: AuthUserRecord[];
  tableCounts: TableSummary[];
  demoUsers: AuthUserRecord[];
  legalHoldUserIds: string[];
};

type Args = {
  mode: ScriptMode;
  envFile: string | null;
  outputPath: string | null;
  confirmProject: string | null;
};

type TableDeletePlan = {
  table: string;
  key: string;
};

type SupabaseLikeError = {
  code?: string;
  message?: string;
};

const INVENTORY_TABLES = [
  "account_profiles",
  "verification_steps",
  "verification_sessions",
  "kyc_artifacts",
  "kyc_provider_results",
  "kyc_risk_signals",
  "kyc_evidence_access_logs",
  "notifications",
  "free_posts_used",
  "otp_challenges",
  "entitlements",
  "listings",
  "businesses",
  "promotions",
  "payments",
  "invoices",
  "leads",
  "contact_events",
  "reports",
  "moderation_actions",
  "audit_logs",
  "consent_records",
  "listing_views",
  "dsar_cases",
  "buyer_verifications",
  "otp_logs",
  "media_uploads",
  "storefronts",
  "storefront_posts",
  "business_profiles",
  "business_posts",
] as const;

const DELETE_PLAN: TableDeletePlan[] = [
  { table: "kyc_provider_results", key: "id" },
  { table: "kyc_risk_signals", key: "id" },
  { table: "kyc_evidence_access_logs", key: "id" },
  { table: "verification_sessions", key: "id" },
  { table: "invoices", key: "id" },
  { table: "payments", key: "id" },
  { table: "moderation_actions", key: "id" },
  { table: "reports", key: "id" },
  { table: "listing_views", key: "id" },
  { table: "leads", key: "id" },
  { table: "contact_events", key: "id" },
  { table: "promotions", key: "id" },
  { table: "business_posts", key: "id" },
  { table: "storefront_posts", key: "id" },
  { table: "businesses", key: "id" },
  { table: "business_profiles", key: "id" },
  { table: "storefronts", key: "id" },
  { table: "listings", key: "id" },
  { table: "notifications", key: "id" },
  { table: "media_uploads", key: "id" },
  { table: "kyc_artifacts", key: "id" },
  { table: "verification_steps", key: "id" },
  { table: "otp_challenges", key: "id" },
  { table: "consent_records", key: "id" },
  { table: "entitlements", key: "id" },
  { table: "free_posts_used", key: "id" },
  { table: "dsar_cases", key: "id" },
  { table: "audit_logs", key: "id" },
  { table: "buyer_verifications", key: "id" },
  { table: "otp_logs", key: "id" },
  { table: "account_profiles", key: "id" },
] as const;

const DEMO_EMAIL_PATTERNS = [
  /^demo\..+@verifymzansi\.com$/i,
  /^dev_seed_seller\d+@test\.com$/i,
  /^dev_seller\d+@test\.com$/i,
] as const;

function takeOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    mode: "inventory",
    envFile: null,
    outputPath: null,
    confirmProject: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--execute") {
      args.mode = "wipe";
      continue;
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

    if (arg === "--output") {
      args.outputPath = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--output=")) {
      args.outputPath = arg.slice("--output=".length);
      continue;
    }

    if (arg === "--confirm-project") {
      args.confirmProject = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--confirm-project=")) {
      args.confirmProject = arg.slice("--confirm-project=".length);
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return args;
}

async function loadEnvFile(envFile: string | null): Promise<void> {
  loadEnvConfig(process.cwd());

  if (!envFile) {
    return;
  }

  const resolvedPath = path.isAbsolute(envFile) ? envFile : path.join(process.cwd(), envFile);
  const content = await readFile(resolvedPath, "utf8");

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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getProjectRef(supabaseUrl: string): string {
  const host = new URL(supabaseUrl).hostname;
  const [projectRef] = host.split(".");

  if (!projectRef) {
    throw new Error(`Unable to derive project ref from ${supabaseUrl}`);
  }

  return projectRef;
}

function createAdminClient(): SupabaseClient {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function listAllUsers(supabase: SupabaseClient): Promise<AuthUserRecord[]> {
  const users: AuthUserRecord[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });

    if (error) {
      throw error;
    }

    const pageUsers = (data.users ?? []).map((user) => ({
      id: user.id,
      email: user.email ?? null,
      role: typeof user.role === "string" ? user.role : null,
      created_at: typeof user.created_at === "string" ? user.created_at : null,
      user_metadata:
        user.user_metadata && typeof user.user_metadata === "object"
          ? (user.user_metadata as Record<string, unknown>)
          : null,
      app_metadata:
        user.app_metadata && typeof user.app_metadata === "object"
          ? (user.app_metadata as Record<string, unknown>)
          : null,
    }));

    users.push(...pageUsers);

    if (pageUsers.length < 200) {
      break;
    }

    page += 1;
  }

  return users;
}

function isDemoUser(user: AuthUserRecord): boolean {
  const email = user.email ?? "";
  return DEMO_EMAIL_PATTERNS.some((pattern) => pattern.test(email));
}

function isAdminUser(user: AuthUserRecord): boolean {
  const appRole =
    user.app_metadata && typeof user.app_metadata.role === "string"
      ? user.app_metadata.role.toLowerCase()
      : null;
  const userRole =
    user.user_metadata && typeof user.user_metadata.role === "string"
      ? user.user_metadata.role.toLowerCase()
      : null;

  return appRole === "admin" || userRole === "admin";
}

async function countRows(supabase: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });

  if (error) {
    if ((error as SupabaseLikeError).code === "PGRST205") {
      return 0;
    }

    throw error;
  }

  return count ?? 0;
}

async function getLegalHoldUserIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("account_profiles")
    .select("user_id")
    .eq("legal_hold", true);

  if (error) {
    throw error;
  }

  return (data ?? [])
    .map((row) => (typeof row.user_id === "string" ? row.user_id : null))
    .filter((value): value is string => Boolean(value));
}

async function buildSnapshot(
  supabase: SupabaseClient,
  mode: ScriptMode,
  sourceEnvFile: string | null
): Promise<LaunchResetSnapshot> {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const [authUsers, legalHoldUserIds, tableCounts] = await Promise.all([
    listAllUsers(supabase),
    getLegalHoldUserIds(supabase),
    Promise.all(
      INVENTORY_TABLES.map(async (table) => ({
        table,
        count: await countRows(supabase, table),
      }))
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    projectRef: getProjectRef(supabaseUrl),
    supabaseUrl,
    mode,
    sourceEnvFile,
    authUsers,
    tableCounts,
    demoUsers: authUsers.filter(isDemoUser),
    legalHoldUserIds,
  };
}

async function ensureOutputPath(outputPath: string): Promise<string> {
  const resolvedPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(process.cwd(), outputPath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  return resolvedPath;
}

async function writeSnapshot(
  snapshot: LaunchResetSnapshot,
  outputPath: string | null
): Promise<string> {
  const defaultName = `launch-reset-${snapshot.projectRef}-${snapshot.generatedAt.replace(/[:.]/g, "-")}.json`;
  const target = await ensureOutputPath(outputPath ?? path.join("tmp", defaultName));
  await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return target;
}

async function deleteAllRowsInTable(
  supabase: SupabaseClient,
  { table, key }: TableDeletePlan
): Promise<number> {
  let deletedCount = 0;

  while (true) {
    const { data, error } = await supabase.from(table).select(key).limit(500);

    if (error) {
      if ((error as SupabaseLikeError).code === "PGRST205") {
        return deletedCount;
      }

      throw error;
    }

    const ids = (data ?? [])
      .map((row) => row[key as keyof typeof row])
      .filter((value): value is string => typeof value === "string");

    if (ids.length === 0) {
      break;
    }

    const { error: deleteError } = await supabase.from(table).delete().in(key, ids);

    if (deleteError) {
      if ((deleteError as SupabaseLikeError).code === "PGRST205") {
        return deletedCount;
      }

      throw deleteError;
    }

    deletedCount += ids.length;
  }

  return deletedCount;
}

async function deleteAllAuthUsers(
  supabase: SupabaseClient,
  users: AuthUserRecord[]
): Promise<number> {
  let deletedCount = 0;

  for (const user of users) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      throw new Error(
        `Failed to delete auth user ${user.id} (${user.email ?? "no-email"}): ${error.message}`
      );
    }

    deletedCount += 1;
  }

  return deletedCount;
}

function printSnapshot(snapshot: LaunchResetSnapshot, outputPath: string): void {
  console.log("");
  console.log(`Launch reset ${snapshot.mode} for ${snapshot.projectRef}`);
  console.log(`Supabase URL: ${snapshot.supabaseUrl}`);
  console.log(`Snapshot: ${outputPath}`);
  console.log(`Auth users: ${snapshot.authUsers.length}`);
  console.log(`Demo-pattern users: ${snapshot.demoUsers.length}`);
  console.log(`Legal-hold profiles: ${snapshot.legalHoldUserIds.length}`);
  console.log("");

  for (const summary of snapshot.tableCounts) {
    console.log(`  ${summary.table}: ${summary.count}`);
  }
}

async function runWipe(supabase: SupabaseClient, snapshot: LaunchResetSnapshot): Promise<void> {
  if (snapshot.legalHoldUserIds.length > 0) {
    throw new Error(
      `Refusing wipe: found ${snapshot.legalHoldUserIds.length} account_profiles rows with legal_hold=true.`
    );
  }

  const adminUsers = snapshot.authUsers.filter(isAdminUser);
  if (adminUsers.length === 0) {
    throw new Error("Refusing wipe: no admin users found to preserve.");
  }

  const usersToDelete = snapshot.authUsers.filter((user) => !isAdminUser(user));

  console.log("");
  console.log("Deleting account-linked application data...");

  for (const step of DELETE_PLAN) {
    const deletedCount = await deleteAllRowsInTable(supabase, step);
    console.log(`  cleared ${step.table}: ${deletedCount}`);
  }

  console.log("");
  console.log("Deleting non-admin auth users...");
  const deletedUsers = await deleteAllAuthUsers(supabase, usersToDelete);
  console.log(`  deleted auth.users: ${deletedUsers}`);
  console.log(`  preserved admin users: ${adminUsers.length}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await loadEnvFile(args.envFile);

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const projectRef = getProjectRef(supabaseUrl);

  if (args.mode === "wipe" && args.confirmProject !== projectRef) {
    throw new Error(
      `Refusing wipe for ${projectRef}. Re-run with --confirm-project=${projectRef} after reviewing the snapshot.`
    );
  }

  const supabase = createAdminClient();
  const snapshot = await buildSnapshot(supabase, args.mode, args.envFile);
  const outputPath = await writeSnapshot(snapshot, args.outputPath);
  printSnapshot(snapshot, outputPath);

  if (args.mode === "inventory") {
    return;
  }

  await runWipe(supabase, snapshot);

  const postWipeSnapshot = await buildSnapshot(supabase, "inventory", args.envFile);
  const postWipePath = await writeSnapshot(
    postWipeSnapshot,
    outputPath.replace(/\.json$/u, ".post-wipe.json")
  );

  console.log("");
  console.log(`Post-wipe snapshot: ${postWipePath}`);
  console.log(`Remaining auth users: ${postWipeSnapshot.authUsers.length}`);
}

main().catch((error) => {
  console.error("Launch reset failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
