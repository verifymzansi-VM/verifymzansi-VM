/* eslint-disable no-console */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { verifySupabaseSchema } from "./check-supabase-schema";

loadEnvConfig(process.cwd());

const strictMode = process.env.STRICT_DB_TESTS === "true" || process.env.CI === "true";
const REQUIRED_FEATURE_FLAG_KEYS = [
  "kyc_v2_flow",
  "kyc_gps_location",
  "kyc_evidence_desk",
] as const;

function skipOrFail(message: string): never | void {
  if (strictMode) {
    throw new Error(message);
  }
  console.warn(`DB tests skipped: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function mask(value: string): string {
  return `${value.slice(0, 10)}...`;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function verifyFeatureFlagRls(
  url: string,
  anonKey: string,
  serviceRoleKey: string
): Promise<void> {
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const service = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: flags, error: readErr } = await anon
    .from("feature_flags")
    .select("key,enabled")
    .limit(20);
  assert(!readErr, `Anon cannot read feature_flags: ${readErr?.message}`);
  assert(Array.isArray(flags), "feature_flags read returned no array");

  for (const key of REQUIRED_FEATURE_FLAG_KEYS) {
    assert(
      flags.some((row) => row.key === key),
      `Missing required feature flag key: ${key}`
    );
  }

  const flagKey = `db_contract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { error: anonInsertErr } = await anon
    .from("feature_flags")
    .insert({ key: flagKey, enabled: false, description: "rls test" });
  assert(!!anonInsertErr, "Anon insert into feature_flags should fail but succeeded");

  const { error: serviceInsertErr } = await service
    .from("feature_flags")
    .insert({ key: flagKey, enabled: false, description: "service role test" });
  assert(
    !serviceInsertErr,
    `Service role insert into feature_flags failed: ${serviceInsertErr?.message}`
  );

  await service.from("feature_flags").delete().eq("key", flagKey);
  console.log("  [OK] Feature flag RLS checks passed");
}

async function verifyReportsRls(
  url: string,
  anonKey: string,
  serviceRoleKey: string
): Promise<void> {
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const service = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const reportPayload = {
    target_id: randomUUID(),
    target_type: "listing",
    area: "MZANSI_MARKET",
    category: "scam",
    severity: "high",
    description: "This is a synthetic report payload for RLS verification only.",
    reporter_ip_hash: `test_${Date.now()}`,
  };

  const { error: anonErr } = await anon.from("reports").insert(reportPayload);
  assert(!!anonErr, "Anon insert into reports should fail but succeeded");

  const { data: serviceInsert, error: serviceErr } = await service
    .from("reports")
    .insert(reportPayload)
    .select("id")
    .single();
  assert(!serviceErr, `Service role insert into reports failed: ${serviceErr?.message}`);
  assert(serviceInsert?.id, "Service role insert into reports returned no id");

  await service.from("reports").delete().eq("id", serviceInsert.id);
  console.log("  [OK] Reports RLS checks passed");
}

async function verifyRoleHelpers(url: string, serviceRoleKey: string): Promise<void> {
  const service = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: hasRoleErr } = await service.rpc("has_role", {
    required_role: "admin",
  });
  assert(!hasRoleErr, `RPC has_role unavailable: ${hasRoleErr?.message}`);

  const { error: hasAnyRoleErr } = await service.rpc("has_any_role", {
    roles: ["admin", "moderator"],
  });
  assert(!hasAnyRoleErr, `RPC has_any_role unavailable: ${hasAnyRoleErr?.message}`);

  console.log("  [OK] RBAC helper RPC functions are reachable");
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serviceRoleKey || !anonKey) {
    return skipOrFail(
      "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required"
    );
  }
  if (!isValidHttpUrl(url)) {
    return skipOrFail("NEXT_PUBLIC_SUPABASE_URL must be a valid http(s) URL");
  }

  console.log("Running DB and RLS checks...");
  console.log(`Target project: ${mask(url)}`);

  const schema = await verifySupabaseSchema({ url, serviceRoleKey });
  assert(schema.ok, "Schema verification failed. Run `pnpm run db:verify-schema` for details.");
  console.log("  [OK] Required schema tables are queryable");

  await verifyFeatureFlagRls(url, anonKey, serviceRoleKey);
  await verifyReportsRls(url, anonKey, serviceRoleKey);
  await verifyRoleHelpers(url, serviceRoleKey);

  console.log("DB test suite passed.");
}

main().catch((error) => {
  console.error("DB test suite failed:", error);
  process.exit(1);
});
