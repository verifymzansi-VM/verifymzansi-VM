/**
 * Development Data Seeding Script
 *
 * Seeds the development database with:
 * - Dummy sellers
 * - Test listings in Mzansi Market
 * - Test storefronts in Mall Shops
 * - Test business profiles in Business Ads
 *
 * Images use realistic seed images generated to showcase the UI accurately.
 *
 * Usage: npm run seed:dev
 */

import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";

// Load environment variables from .env.local or .env
loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function seedDevelopmentData() {
  console.log("Seeding development data...");

  // 1. Create Dummy Sellers
  const users = [
    { email: "dev_seller1@test.com", name: "Dev Seller One", phone: "+27000000010" },
    { email: "dev_seller2@test.com", name: "Dev Seller Two", phone: "+27000000011" },
    { email: "dev_mallrenter@test.com", name: "Dev Mall Shop Owner", phone: "+27000000012" },
  ];

  const sellerIds: string[] = [];

  console.log("  Seeding sellers...");
  for (const u of users) {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: u.email,
      password: "Password123!",
      email_confirm: true,
      user_metadata: { role: "seller", display_name: u.name },
    });

    let userId = authData?.user?.id;

    if (
      authError &&
      (authError.message?.includes("already registered") ||
        authError.code === "email_exists" ||
        authError.code === "user_already_exists")
    ) {
      // Find the existing user
      const { data: existing } = await supabase
        .from("seller_profiles")
        .select("user_id")
        .eq("display_name", u.name)
        .limit(1)
        .single();
      if (existing) userId = existing.user_id;
    } else if (authError) {
      console.error(`  Failed to create ${u.email}:`, authError);
    }

    if (userId) {
      sellerIds.push(userId);
      await supabase.from("seller_profiles").upsert(
        {
          user_id: userId,
          display_name: u.name,
          phone: u.phone,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          seller_verification_status: "verified",
          account_status: "active",
        },
        { onConflict: "user_id" }
      );
    }
  }

  console.log(`  ✓ ${sellerIds.length} sellers ready.`);

  // 2. Mzansi Market Listings
  if (sellerIds.length > 0) {
    console.log("  Seeding Mzansi Market listings...");

    // Remove old dummy listings for these sellers before creating new ones
    await supabase.from("listings").delete().in("seller_id", sellerIds);

    const listings = [
      {
        seller_id: sellerIds[0],
        area: "MZANSI_MARKET",
        category: "electronics",
        title: "Sony PlayStation 5",
        description: "Brand new PS5 with 2 controllers and FIFA 23.",
        photos: ["/images/promo/seed-ps5.png"],
        price_cents: 1100000,
        price_negotiable: false,
        location_province: "Gauteng",
        location_city: "Sandton",
        contact_methods: ["whatsapp", "call"],
        status: "live",
      },
      {
        seller_id: sellerIds[1],
        area: "MZANSI_MARKET",
        category: "vehicles",
        title: "Toyota Hilux 2021",
        description: "Excellent condition, full service history.",
        photos: ["/images/promo/seed-hilux.png"],
        price_cents: 45000000,
        price_negotiable: true,
        location_province: "Western Cape",
        location_city: "Cape Town",
        contact_methods: ["form"],
        status: "live",
      },
      {
        seller_id: sellerIds[0],
        area: "MZANSI_MARKET",
        category: "home_lifestyle",
        title: "Modern L-Shape Sofa",
        description: "Barely used grey sofa. Pick up only.",
        photos: ["/images/promo/seed-sofa.png"],
        price_cents: 800000,
        price_negotiable: true,
        location_province: "KwaZulu-Natal",
        location_city: "Durban",
        contact_methods: ["whatsapp"],
        status: "live",
      },
    ];

    const { error: listingsError } = await supabase.from("listings").insert(listings);
    if (listingsError) console.error("  Error seeding listings:", listingsError);
    else console.log("  ✓ Seeded Mzansi Market listings");
  }

  // 3. Mall Shops Storefronts
  if (sellerIds.length >= 3) {
    console.log("  Seeding Mall Shops storefronts...");
    const { data: malls } = await supabase
      .from("malls")
      .select("id, name, location_province, location_city")
      .limit(5);

    // Remove old dummy storefronts for this seller
    await supabase.from("storefronts").delete().eq("seller_id", sellerIds[2]);

    if (malls && malls.length > 0) {
      const mallImages = [
        "/images/promo/seed-mall-sandton.png",
        "/images/promo/seed-mall-africa.png",
        "/images/promo/seed-mall-menlyn.png",
        "/images/promo/seed-mall-gateway.png",
        "/images/promo/seed-mall-canalwalk.png",
      ];

      const storefronts = malls.map((mall, i) => ({
        seller_id: sellerIds[2],
        area: "MALL_SHOPS",
        mall_id: mall.id,
        mall_name: mall.name,
        cover_photo: mallImages[i % mallImages.length],
        description: `A premium shop in ${mall.name} offering the best quality products for all your needs.`,
        store_number: `Shop L${i + 1}0`,
        location_province: mall.location_province,
        location_city: mall.location_city,
        operating_hours: {
          monday: "09:00-17:00",
          tuesday: "09:00-17:00",
          wednesday: "09:00-17:00",
          thursday: "09:00-17:00",
          friday: "09:00-17:00",
          saturday: "09:00-15:00",
          sunday: "closed",
        },
        phone: "+27000000100",
        status: "live",
      }));

      const { error: storefrontsError } = await supabase.from("storefronts").insert(storefronts);
      if (storefrontsError) console.error("  Error seeding storefronts:", storefrontsError);
      else console.log(`  ✓ Seeded ${storefronts.length} Mall Shops storefronts`);
    } else {
      console.log("  ⚠ No malls found. Please ensure the malls migration ran.");
    }
  }

  // 4. Business Profiles
  if (sellerIds.length >= 2) {
    console.log("  Seeding Business Profiles...");

    // Remove old dummy businesses for this seller
    await supabase.from("business_profiles").delete().eq("seller_id", sellerIds[1]);

    const businesses = [
      {
        seller_id: sellerIds[1],
        area: "BUSINESS_ADS",
        cover_photo: "/images/promo/seed-plumber.png",
        business_name: "Mvelase Plumbing Services",
        about:
          "Professional plumbing services with over 10 years of experience in leak detection and geyser replacement.",
        services_offered: ["Plumbing", "Geyser Installation", "Leak Detection"],
        service_areas: { regions: ["Gauteng", "Pretoria"] },
        operating_hours: {
          monday: "08:00-18:00",
          tuesday: "08:00-18:00",
          wednesday: "08:00-18:00",
          thursday: "08:00-18:00",
          friday: "08:00-18:00",
          saturday: "08:00-13:00",
          sunday: "Emergency only",
        },
        phone: "+27000000200",
        email: "info@mvelaseplumbing.test",
        status: "live",
      },
    ];

    const { error: businessError } = await supabase.from("business_profiles").insert(businesses);
    if (businessError) console.error("  Error seeding business profiles:", businessError);
    else console.log("  ✓ Seeded Business Ads profiles");
  }

  console.log("=== Development seeding complete ✓ ===");
}

seedDevelopmentData().catch(console.error);
