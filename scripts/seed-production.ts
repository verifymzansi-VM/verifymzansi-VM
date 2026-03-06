/* eslint-disable no-console */

/**
 * Production Data Seeding Script
 *
 * Seeds the production database with:
 * - Subscription plans from the runtime pricing catalog
 * - Initial admin user
 * - Initial moderator user
 *
 * Pay-per-post and add-on prices are runtime constants in src/lib/constants/pricing.ts
 * and do NOT have dedicated DB tables — no seeding required.
 *
 * Usage: npx tsx scripts/seed-production.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.
 */

import { createClient } from "@supabase/supabase-js";
import { PLANS } from "../src/lib/constants/pricing";
import { EXPECTED_ACTIVE_PLAN_ROWS } from "./seed-contract";

// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------- Build plan rows from constants ----------

type PlanRow = {
  area: string;
  tier: string;
  name: string;
  price_cents: number;
  billing_frequency: string;
  features: object;
  active: boolean;
};

function buildPlanRows(): PlanRow[] {
  const featureByKey = new Map(
    PLANS.map((plan) => [`${plan.area}:${plan.tier}`, plan.features] as const)
  );

  return EXPECTED_ACTIVE_PLAN_ROWS.map((plan) => ({
    area: plan.area,
    tier: plan.tier,
    name: plan.name,
    price_cents: plan.price_cents,
    billing_frequency: plan.billing_frequency,
    features: featureByKey.get(`${plan.area}:${plan.tier}`) ?? {},
    active: plan.active,
  }));
}

// ---------- Seeding Functions ----------

async function seedPlans() {
  console.log("Seeding subscription plans...");

  const plans = buildPlanRows();

  const { error } = await supabase.from("plans").upsert(plans, {
    onConflict: "area,tier",
  });

  if (error) {
    console.error("Failed to seed plans:", error);
    return false;
  }

  console.log(`  ✓ ${plans.length} subscription plans seeded from runtime pricing constants`);
  return true;
}

async function seedAdminUser() {
  console.log("Seeding admin user...");

  const adminEmail = process.env.ADMIN_EMAIL || "admin@verifymzansi.co.za";
  const adminPassword = process.env.ADMIN_PASSWORD || "ChangeThisPassword123!";

  // Create auth user with admin role
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: {
      display_name: "System Admin",
    },
    app_metadata: {
      role: "admin",
    },
  });

  if (authError) {
    if (authError.message?.includes("already registered")) {
      console.log("  ✓ Admin user already exists");
      return true;
    }
    console.error("  Failed to create admin user:", authError);
    return false;
  }

  if (authData?.user) {
    // Create seller profile for admin
    const { error: profileError } = await supabase.from("seller_profiles").upsert(
      {
        user_id: authData.user.id,
        display_name: "System Admin",
        phone: "+27000000000",
        location_province: "gauteng",
        location_city: "Johannesburg",
        seller_verification_status: "verified",
        account_status: "active",
      },
      {
        onConflict: "user_id",
      }
    );

    if (profileError) {
      console.warn("  ⚠ Could not create admin profile:", profileError.message);
    }
  }

  console.log(`  ✓ Admin user created: ${adminEmail}`);
  console.log(`  ⚠ IMPORTANT: Change the admin password immediately after first login!`);
  return true;
}

async function seedModeratorUser() {
  console.log("Seeding moderator user...");

  const modEmail = process.env.MODERATOR_EMAIL || "moderator@verifymzansi.co.za";
  const modPassword = process.env.MODERATOR_PASSWORD || "ChangeThisPassword456!";

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: modEmail,
    password: modPassword,
    email_confirm: true,
    user_metadata: {
      display_name: "Moderator",
    },
    app_metadata: {
      role: "moderator",
    },
  });

  if (authError) {
    if (authError.message?.includes("already registered")) {
      console.log("  ✓ Moderator user already exists");
      return true;
    }
    console.error("  Failed to create moderator user:", authError);
    return false;
  }

  if (authData?.user) {
    const { error: profileError } = await supabase.from("seller_profiles").upsert(
      {
        user_id: authData.user.id,
        display_name: "Moderator",
        phone: "+27000000001",
        location_province: "gauteng",
        location_city: "Johannesburg",
        seller_verification_status: "verified",
        account_status: "active",
      },
      {
        onConflict: "user_id",
      }
    );

    if (profileError) {
      console.warn("  ⚠ Could not create moderator profile:", profileError.message);
    }
  }

  console.log(`  ✓ Moderator user created: ${modEmail}`);
  return true;
}

// ---------- Main ----------

async function main() {
  console.log("");
  console.log("=== VerifyMzansi Production Seeding ===");
  console.log(`Target: ${SUPABASE_URL}`);
  console.log("");

  let allSuccess = true;

  allSuccess = (await seedPlans()) && allSuccess;
  allSuccess = (await seedAdminUser()) && allSuccess;
  allSuccess = (await seedModeratorUser()) && allSuccess;

  console.log("");
  console.log("Note: Pay-per-post and add-on prices are runtime constants");
  console.log("      in src/lib/constants/pricing.ts — no DB rows needed.");
  console.log("");
  if (allSuccess) {
    console.log("=== Seeding complete ✓ ===");
  } else {
    console.log("=== Seeding completed with warnings ⚠ ===");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
