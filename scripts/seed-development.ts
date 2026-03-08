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

async function ensureSeedSeller(user: {
  email: string;
  name: string;
  phone: string;
  location_province: string;
  location_city: string;
}) {
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: user.email,
    password: "Password123!",
    email_confirm: true,
    user_metadata: { role: "seller", display_name: user.name },
    app_metadata: { role: "seller" },
  });

  let userId = authData?.user?.id;

  if (
    authError &&
    (authError.message?.includes("already registered") ||
      authError.code === "email_exists" ||
      authError.code === "user_already_exists")
  ) {
    const { data: existing } = await supabase
      .from("seller_profiles")
      .select("user_id")
      .eq("display_name", user.name)
      .limit(1)
      .single();
    if (existing) userId = existing.user_id;
  } else if (authError) {
    console.error(`  Failed to create ${user.email}:`, authError);
  }

  if (!userId) return null;

  await supabase.from("seller_profiles").upsert(
    {
      user_id: userId,
      display_name: user.name,
      phone: user.phone,
      location_province: user.location_province,
      location_city: user.location_city,
      seller_verification_status: "verified",
      account_status: "active",
    },
    { onConflict: "user_id" }
  );

  return userId;
}

async function cleanupExistingSeedRows(sellerIds: string[]) {
  if (sellerIds.length === 0) return;

  console.log("  Cleaning previous seed rows...");

  const cleanupSteps = [
    { table: "promotions", column: "seller_id" },
    { table: "businesses", column: "seller_id" },
    { table: "listings", column: "seller_id" },
    { table: "business_posts", column: "seller_id" },
    { table: "business_profiles", column: "seller_id" },
    { table: "storefront_posts", column: "seller_id" },
    { table: "storefronts", column: "seller_id" },
  ] as const;

  for (const step of cleanupSteps) {
    const { error } = await supabase.from(step.table).delete().in(step.column, sellerIds);
    if (error) {
      console.warn(`  Warning cleaning ${step.table}:`, error.message);
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

  if (sellerIds.length === 0) {
    console.error("No seed sellers are available; aborting development seed.");
    process.exit(1);
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
    .select("id, slug, seller_id, location_province, location_city");
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
