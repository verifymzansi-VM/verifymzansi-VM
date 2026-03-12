/* eslint-disable no-console */

/**
 * Development Data Seeding Script
 *
 * Seeds the development database with:
 * - Dedicated seed sellers
 * - One live listing per Mzansi Market category
 * - One live business per Mzansi Business category
 * - One live promotion per business category
 *
 * Images use realistic seed images generated to showcase the UI accurately.
 *
 * Usage: npm run seed:dev
 */

import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import {
  DEV_SEED_BUSINESS_FIXTURES,
  DEV_SEED_SELLERS,
  buildDevSeedBusinesses,
  buildDevSeedListings,
  buildDevSeedPromotions,
} from "../src/lib/testing/dev-seed-fixtures";

// Load environment variables from .env.local or .env
loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const ACCOUNTS_ONLY_MODE =
  process.argv.includes("--accounts-only") || process.env.SEED_DEV_ACCOUNTS_ONLY === "1";

const LEGACY_DEV_SEED_EMAIL_PATTERNS = [
  /^dev_seed_seller\d+@test\.com$/i,
  /^dev_seller\d+@test\.com$/i,
];

function isLegacyDevSeedEmail(email: string | undefined): email is string {
  return Boolean(email && LEGACY_DEV_SEED_EMAIL_PATTERNS.some((pattern) => pattern.test(email)));
}

async function listAuthUsersByEmail(email: string) {
  const matches = [] as Array<{ id: string; email?: string }>;
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw error;
    }

    const users = data.users ?? [];
    matches.push(
      ...users
        .filter((user) => user.email?.toLowerCase() === email.toLowerCase())
        .map((user) => ({ id: user.id, email: user.email }))
    );

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return matches;
}

async function listLegacySeedAuthUsers() {
  const matches = [] as Array<{ id: string; email?: string }>;
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw error;
    }

    const users = data.users ?? [];
    matches.push(
      ...users
        .filter((user) => isLegacyDevSeedEmail(user.email))
        .map((user) => ({ id: user.id, email: user.email }))
    );

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return matches;
}

async function ensureSeedSeller(user: {
  email: string;
  name: string;
  phone: string;
  location_province: string;
  location_city: string;
}) {
  const existingAuthUsers = await listAuthUsersByEmail(user.email);
  let userId: string | null = existingAuthUsers[0]?.id ?? null;

  if (!userId) {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: "Password123!",
      email_confirm: true,
      user_metadata: { role: "member", display_name: user.name },
      app_metadata: { role: "member" },
    });

    userId = authData?.user?.id ?? null;

    if (
      authError &&
      (authError.message?.includes("already registered") ||
        authError.code === "email_exists" ||
        authError.code === "user_already_exists")
    ) {
      const matchingUsers = await listAuthUsersByEmail(user.email);
      userId = matchingUsers[0]?.id ?? null;
    } else if (authError) {
      console.error(`  Failed to create ${user.email}:`, authError);
    }
  }

  if (!userId) return null;

  await supabase.from("account_profiles").upsert(
    {
      user_id: userId,
      display_name: user.name,
      phone: user.phone,
      location_province: user.location_province,
      location_city: user.location_city,
      account_verification_status: "verified",
      account_status: "active",
    },
    { onConflict: "user_id" }
  );

  return userId;
}

async function deleteRowsForOwners(ownerIds: string[]) {
  if (ownerIds.length === 0) return;

  const cleanupSteps = [
    { table: "promotions", columns: ["owner_id", "seller_id"] },
    { table: "businesses", columns: ["owner_id", "seller_id"] },
    { table: "listings", columns: ["owner_id", "seller_id"] },
    { table: "business_posts", columns: ["owner_id", "seller_id"] },
    { table: "business_profiles", columns: ["owner_id", "seller_id"] },
    { table: "storefront_posts", columns: ["owner_id", "seller_id"] },
    { table: "storefronts", columns: ["owner_id", "seller_id"] },
    { table: "leads", columns: ["owner_id", "seller_id"] },
    { table: "contact_events", columns: ["owner_id", "seller_id"] },
    { table: "moderation_actions", columns: ["target_owner_id", "target_seller_id"] },
    { table: "audit_logs", columns: ["target_owner_id", "target_seller_id", "actor_id"] },
    { table: "seller_profiles", columns: ["user_id"] },
    { table: "verification_steps", columns: ["user_id"] },
    { table: "kyc_artifacts", columns: ["user_id"] },
    { table: "kyc_provider_results", columns: ["user_id"] },
    { table: "kyc_risk_signals", columns: ["user_id"] },
    { table: "entitlements", columns: ["user_id"] },
    { table: "payments", columns: ["user_id"] },
    { table: "invoices", columns: ["user_id"] },
    { table: "consent_records", columns: ["user_id"] },
    { table: "notifications", columns: ["user_id"] },
    { table: "free_posts_used", columns: ["user_id"] },
    { table: "otp_challenges", columns: ["user_id"] },
  ] as const;

  for (const step of cleanupSteps) {
    let cleaned = false;
    let lastError: string | null = null;

    for (const column of step.columns) {
      const { error } = await supabase.from(step.table).delete().in(column, ownerIds);

      if (!error) {
        cleaned = true;
        break;
      }

      lastError = error.message;

      if (
        error.code === "PGRST204" ||
        error.message.includes("schema cache") ||
        error.message.includes("does not exist")
      ) {
        continue;
      }

      break;
    }

    if (!cleaned && lastError) {
      console.warn(`  Warning cleaning ${step.table}:`, lastError);
    }
  }
}

async function cleanupExistingSeedRows(sellerIds: string[]) {
  if (sellerIds.length === 0) return;

  console.log("  Cleaning previous seed rows...");

  await deleteRowsForOwners(sellerIds);
}

async function pruneLegacySeedAccounts(activeSellerIds: string[]) {
  const retainedIds = new Set(activeSellerIds);
  const legacyAuthUsers = await listLegacySeedAuthUsers();
  const removableIds = legacyAuthUsers
    .map((user) => user.id)
    .filter((userId) => !retainedIds.has(userId));

  if (removableIds.length === 0) {
    return;
  }

  console.log(`  Removing ${removableIds.length} legacy seed account(s)...`);
  await deleteRowsForOwners(removableIds);

  const { error: profileDeleteError } = await supabase
    .from("account_profiles")
    .delete()
    .in("user_id", removableIds);

  if (profileDeleteError) {
    console.warn("  Warning cleaning account_profiles:", profileDeleteError.message);
  }

  for (const userId of removableIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      console.warn(`  Warning deleting auth user ${userId}:`, error.message);
    }
  }
}

async function seedDevelopmentData() {
  console.log("Seeding development data...");

  const sellerIds: string[] = [];

  console.log("  Seeding sellers...");
  for (const seller of DEV_SEED_SELLERS) {
    const userId = await ensureSeedSeller(seller);
    if (userId) {
      sellerIds.push(userId);
    }
  }

  console.log(`  ✓ ${sellerIds.length} sellers ready.`);
  await cleanupExistingSeedRows(sellerIds);
  await pruneLegacySeedAccounts(sellerIds);

  if (sellerIds.length === 0) {
    console.error("No seed sellers are available; aborting development seed.");
    process.exit(1);
  }

  if (ACCOUNTS_ONLY_MODE) {
    console.log("  Accounts-only mode enabled; skipping content reseeding.");
    console.log("=== Development account cleanup complete ✓ ===");
    return;
  }

  console.log("  Seeding Mzansi Market listings...");
  const listings = buildDevSeedListings(sellerIds);
  const { error: listingsError } = await supabase.from("listings").insert(listings);
  if (listingsError) {
    console.error("  Error seeding listings:", listingsError);
  } else {
    console.log(`  ✓ Seeded ${listings.length} Mzansi Market listings`);
  }

  console.log("  Seeding Mzansi Business profiles...");
  const businesses = buildDevSeedBusinesses(sellerIds);
  const { data: insertedBusinesses, error: businessesError } = await supabase
    .from("businesses")
    .insert(businesses)
    .select("id, slug, owner_id, location_province, location_city");
  if (businessesError) {
    console.error("  Error seeding businesses:", businessesError);
  } else {
    console.log(`  ✓ Seeded ${businesses.length} Mzansi Business profiles`);
  }

  if (!insertedBusinesses || insertedBusinesses.length !== DEV_SEED_BUSINESS_FIXTURES.length) {
    console.error("  Unable to resolve all seeded businesses for promotion linking.");
    process.exit(1);
  }

  console.log("  Seeding Promotions & Events...");
  const promotions = buildDevSeedPromotions(insertedBusinesses);
  const { error: promotionsError } = await supabase.from("promotions").insert(promotions);
  if (promotionsError) {
    console.error("  Error seeding promotions:", promotionsError);
  } else {
    console.log(`  ✓ Seeded ${promotions.length} promotions`);
  }

  console.log("=== Development seeding complete ✓ ===");
}

seedDevelopmentData().catch(console.error);
