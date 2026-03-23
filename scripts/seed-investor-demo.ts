import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment."
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const DEMO_PASSWORD = "InvestorDemo2026!";

type DemoMemberKey = "naledi" | "ayanda" | "kabelo" | "aisha" | "siphokazi";

type DemoMember = {
  key: DemoMemberKey;
  email: string;
  displayName: string;
  locationProvince: string;
  locationCity: string;
};

const demoMembers: DemoMember[] = [
  {
    key: "naledi",
    email: "demo.naledi@verifymzansi.com",
    displayName: "Naledi Mokoena",
    locationProvince: "Gauteng",
    locationCity: "Johannesburg",
  },
  {
    key: "ayanda",
    email: "demo.ayanda@verifymzansi.com",
    displayName: "Ayanda Dube",
    locationProvince: "KwaZulu-Natal",
    locationCity: "Durban",
  },
  {
    key: "kabelo",
    email: "demo.kabelo@verifymzansi.com",
    displayName: "Kabelo Ndlovu",
    locationProvince: "Western Cape",
    locationCity: "Cape Town",
  },
  {
    key: "aisha",
    email: "demo.aisha@verifymzansi.com",
    displayName: "Aisha Patel",
    locationProvince: "Western Cape",
    locationCity: "Cape Town",
  },
  {
    key: "siphokazi",
    email: "demo.siphokazi@verifymzansi.com",
    displayName: "Siphokazi Mthembu",
    locationProvince: "KwaZulu-Natal",
    locationCity: "Durban",
  },
];

const media = {
  apartment:
    "https://images.unsplash.com/photo-1741927378831-e51b54d27a02?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&ixlib=rb-4.1.0&q=60&w=3000",
  pickupTruck:
    "https://images.unsplash.com/photo-1590142035743-0ffa020065e6?auto=format&fit=crop&fm=jpg&q=60&w=3000",
  creatorDesk:
    "https://images.unsplash.com/photo-1748667955709-d2f4ed0f06d4?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&ixlib=rb-4.1.0&q=60&w=3000",
  workspaceBundle:
    "https://images.unsplash.com/photo-1760712491426-ef0e797b8c52?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&ixlib=rb-4.1.0&q=60&w=3000",
  boutique:
    "https://images.unsplash.com/photo-1769107805511-0bb7075fca27?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&ixlib=rb-4.1.0&q=60&w=3000",
  salon:
    "https://images.unsplash.com/photo-1633681138600-295fcd688876?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&ixlib=rb-4.1.0&q=60&w=3000",
  coffeeShop:
    "https://images.unsplash.com/photo-1749626588174-09f86a67a5aa?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&ixlib=rb-4.1.0&q=60&w=3000",
  espressoMachine:
    "https://images.unsplash.com/photo-1553787495-8889c105840b?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&ixlib=rb-4.1.0&q=60&w=3000",
  phoneRepair:
    "https://images.unsplash.com/photo-1550041473-d296a3a8a18a?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&ixlib=rb-4.1.0&q=60&w=3000",
  produce:
    "https://images.unsplash.com/photo-1763098845190-7afabaae7d69?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&ixlib=rb-4.1.0&q=60&w=3000",
  nightMarket:
    "https://images.unsplash.com/photo-1761853321384-1d62bbbf7172?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&ixlib=rb-4.1.0&q=60&w=3000",
  workshopAudience:
    "https://images.unsplash.com/photo-1768448808550-3148cce53a19?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&ixlib=rb-4.1.0&q=60&w=3000",
};

const timestamps = {
  mar17: "2026-03-17T08:15:00.000Z",
  mar18: "2026-03-18T09:45:00.000Z",
  mar19: "2026-03-19T10:30:00.000Z",
  mar20: "2026-03-20T11:20:00.000Z",
  mar21: "2026-03-21T12:10:00.000Z",
  mar22: "2026-03-22T13:00:00.000Z",
  mar23: "2026-03-23T07:40:00.000Z",
  apr04: "2026-04-04T08:00:00.000Z",
  apr04End: "2026-04-04T14:00:00.000Z",
  apr11: "2026-04-11T08:30:00.000Z",
  apr11End: "2026-04-11T12:30:00.000Z",
  apr18: "2026-04-18T16:00:00.000Z",
  apr18End: "2026-04-18T20:30:00.000Z",
  feb28: "2026-02-28T15:00:00.000Z",
  feb28End: "2026-02-28T21:00:00.000Z",
  boostUntil: "2026-04-30T23:59:59.000Z",
  featureUntil: "2026-05-15T23:59:59.000Z",
};

async function listAllUsersByEmail() {
  const userMap = new Map<string, string>();
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw error;
    }

    const users = data.users ?? [];
    for (const user of users) {
      if (user.email) {
        userMap.set(user.email.toLowerCase(), user.id);
      }
    }

    if (users.length < 200) {
      break;
    }

    page += 1;
  }

  return userMap;
}

async function ensureDemoMembers() {
  const existingUsers = await listAllUsersByEmail();
  const ownerIds = new Map<DemoMemberKey, string>();

  for (const member of demoMembers) {
    const existingId = existingUsers.get(member.email.toLowerCase());

    if (existingId) {
      const { error } = await supabase.auth.admin.updateUserById(existingId, {
        email: member.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: {
          display_name: member.displayName,
          role: "member",
          demo_seed: "investor_2026_03",
        },
      });

      if (error) {
        throw error;
      }

      ownerIds.set(member.key, existingId);
      continue;
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email: member.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: {
        display_name: member.displayName,
        role: "member",
        demo_seed: "investor_2026_03",
      },
    });

    if (error || !data.user) {
      throw error ?? new Error(`Failed to create demo user ${member.email}`);
    }

    ownerIds.set(member.key, data.user.id);
  }

  const accountProfiles = demoMembers.map((member) => ({
    user_id: ownerIds.get(member.key),
    display_name: member.displayName,
    account_verification_status: "verified",
    account_status: "active",
    location_province: member.locationProvince,
    location_city: member.locationCity,
    profile_completeness_score: 100,
    updated_at: timestamps.mar23,
  }));

  const { error: profileError } = await supabase
    .from("account_profiles")
    .upsert(accountProfiles, { onConflict: "user_id" });

  if (profileError) {
    throw profileError;
  }

  return ownerIds;
}

function buildBusinesses(ownerIds: Map<DemoMemberKey, string>) {
  return [
    {
      id: "5c9dfa01-fc96-47a0-9ab4-55ca7f42c901",
      owner_id: ownerIds.get("naledi"),
      area: "MZANSI_BUSINESS",
      business_type: "standalone_shop",
      business_name: "Harvest & Grind Roastery",
      slug: "harvest-grind-roastery",
      description:
        "A neighbourhood coffee bar and micro-roastery built for commuters, founders, and client meetings. Harvest & Grind serves small-batch roasts, breakfast pastries, and private tasting sessions, with reliable Wi-Fi and fast takeaway service during the Sandton morning rush.",
      category: "food_dining",
      cover_photo: media.coffeeShop,
      gallery_photos: [media.coffeeShop, media.espressoMachine],
      location_province: "Gauteng",
      location_city: "Sandton",
      phone: "0114472100",
      whatsapp: "0824109012",
      email: "hello@harvestandgrind.za",
      services_offered: [
        "Specialty coffee",
        "Corporate coffee catering",
        "Private tasting sessions",
      ],
      operating_hours: {
        Mon_Fri: "06:30 - 18:00",
        Sat: "07:00 - 16:00",
        Sun: "08:00 - 14:00",
      },
      payment_methods_accepted: ["cash", "card", "eft", "snapscan"],
      delivery_options: ["in_store", "collection"],
      map_directions: "https://maps.google.com/?q=Sandton+Johannesburg",
      business_details: {
        type: "standalone_shop",
        street_address: "22 Gwen Lane",
        suburb: "Sandown",
        landmark: "Across from the Gautrain station",
        walk_in_policy: "walk_ins_welcome",
      },
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: timestamps.featureUntil,
      published_at: timestamps.mar20,
      created_at: timestamps.mar20,
      updated_at: timestamps.mar23,
    },
    {
      id: "8d4b15d5-9e89-42b7-90d4-a96404ba7302",
      owner_id: ownerIds.get("ayanda"),
      area: "MZANSI_BUSINESS",
      business_type: "standalone_shop",
      business_name: "Lumiere Beauty Studio",
      slug: "lumiere-beauty-studio",
      description:
        "A polished salon studio for bridal glam, soft-glam makeovers, lash appointments, and event-ready styling. Lumiere focuses on punctual bookings, premium hygiene standards, and natural finishes that photograph beautifully for weddings, launches, and special occasions.",
      category: "health_beauty",
      cover_photo: media.salon,
      gallery_photos: [media.salon],
      location_province: "KwaZulu-Natal",
      location_city: "Umhlanga",
      phone: "0315614400",
      whatsapp: "0725518840",
      email: "bookings@lumierebeauty.co.za",
      services_offered: [
        "Bridal makeup",
        "Soft-glam appointments",
        "Brow shaping",
        "Event styling",
      ],
      operating_hours: {
        Mon_Fri: "09:00 - 18:00",
        Sat: "08:00 - 16:00",
        Sun: "By appointment",
      },
      payment_methods_accepted: ["card", "eft", "snapscan"],
      delivery_options: ["in_store"],
      map_directions: "https://maps.google.com/?q=Umhlanga+Durban",
      business_details: {
        type: "standalone_shop",
        street_address: "14 Zenith Drive",
        suburb: "Umhlanga Ridge",
        landmark: "Level 1 opposite Gateway parking entrance 3",
        walk_in_policy: "appointments_preferred",
      },
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: timestamps.featureUntil,
      published_at: timestamps.mar19,
      created_at: timestamps.mar19,
      updated_at: timestamps.mar23,
    },
    {
      id: "d95ea204-347a-4f5d-b4f6-5af1d6e75c43",
      owner_id: ownerIds.get("kabelo"),
      area: "MZANSI_BUSINESS",
      business_type: "mobile_service",
      business_name: "CircuitFix Mobile Repairs",
      slug: "circuitfix-mobile-repairs",
      description:
        "On-site phone, tablet, and laptop repairs for busy professionals and small teams. CircuitFix handles screen replacements, charging-port repairs, diagnostics, and software recovery with same-day turnaround across key Cape Town business districts.",
      category: "electronics_tech",
      cover_photo: media.phoneRepair,
      gallery_photos: [media.phoneRepair],
      location_province: "Western Cape",
      location_city: "Cape Town",
      phone: "0213007712",
      whatsapp: "0768801344",
      email: "support@circuitfix.co.za",
      services_offered: [
        "Screen replacements",
        "Laptop diagnostics",
        "Battery swaps",
        "Data migration",
      ],
      service_areas: {
        areas: ["Cape Town CBD", "Bellville", "Century City", "Somerset West"],
      },
      operating_hours: {
        Mon_Fri: "08:00 - 18:30",
        Sat: "09:00 - 14:00",
      },
      payment_methods_accepted: ["card", "eft"],
      delivery_options: ["delivery", "collection"],
      business_details: {
        type: "mobile_service",
        travel_radius_km: 30,
        callout_fee_from: 150,
        emergency_callouts: true,
      },
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: timestamps.featureUntil,
      published_at: timestamps.mar21,
      created_at: timestamps.mar21,
      updated_at: timestamps.mar23,
    },
    {
      id: "0feb345b-37a2-4e0b-bf32-b75c84a1f2ea",
      owner_id: ownerIds.get("aisha"),
      area: "MZANSI_BUSINESS",
      business_type: "home_business",
      business_name: "Atelier Sunday",
      slug: "atelier-sunday",
      description:
        "A home-based fashion atelier producing polished occasionwear capsules, custom fittings, and small-batch styling edits. Atelier Sunday is designed for clients who want boutique-level attention, flexible pickups, and pieces that feel premium without department-store pricing.",
      category: "fashion_accessories",
      cover_photo: media.boutique,
      gallery_photos: [media.boutique],
      location_province: "Western Cape",
      location_city: "Cape Town",
      phone: "0215559033",
      whatsapp: "0798455532",
      email: "hello@ateliersunday.co.za",
      services_offered: ["Private fittings", "Capsule collections", "Style edits"],
      operating_hours: {
        Mon_Fri: "10:00 - 17:00",
        Sat: "09:00 - 13:00",
      },
      payment_methods_accepted: ["eft", "card"],
      delivery_options: ["collection", "nationwide"],
      business_details: {
        type: "home_business",
        service_suburb: "Gardens",
        appointment_required: true,
        customer_pickup_allowed: true,
        visitor_notes: "Studio visits are booked in 45-minute fitting slots.",
      },
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: timestamps.featureUntil,
      published_at: timestamps.mar18,
      created_at: timestamps.mar18,
      updated_at: timestamps.mar23,
    },
    {
      id: "c07ef0fd-826f-4d79-a11f-15ae1e36fc0c",
      owner_id: ownerIds.get("siphokazi"),
      area: "MZANSI_BUSINESS",
      business_type: "market_stall",
      business_name: "Neighbourhood Fresh Market",
      slug: "neighbourhood-fresh-market",
      description:
        "A bustling produce-led market stall focused on seasonal fruit, ready-packed veggie boxes, and locally made pantry items. The stall is styled for repeat foot traffic, gifting, and small family shops, with flexible weekend bundles and tasting-led activations.",
      category: "groceries_essentials",
      cover_photo: media.produce,
      gallery_photos: [media.produce],
      location_province: "KwaZulu-Natal",
      location_city: "Durban",
      phone: "0314920023",
      whatsapp: "0781134910",
      email: "orders@neighbourhoodfresh.co.za",
      services_offered: ["Fresh produce crates", "Market pre-orders", "Tasting tables"],
      operating_hours: {
        Mon_Fri: "Closed",
        Sat: "07:30 - 15:00",
        Sun: "08:00 - 13:00",
      },
      payment_methods_accepted: ["cash", "card", "eft"],
      delivery_options: ["collection", "delivery"],
      business_details: {
        type: "market_stall",
        market_name: "I Heart Market",
        stall_label: "Row B, Stall 14",
        trading_days: ["Saturday", "Sunday"],
        trading_hours: "07:30 - 15:00",
      },
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: timestamps.featureUntil,
      published_at: timestamps.mar22,
      created_at: timestamps.mar22,
      updated_at: timestamps.mar23,
    },
  ];
}

function buildListings(ownerIds: Map<DemoMemberKey, string>) {
  return [
    {
      id: "4a1f9ba8-f1bc-43b0-8ae4-31972ec7b001",
      owner_id: ownerIds.get("naledi"),
      area: "MZANSI_MARKET",
      category: "property",
      title: "Sandton 2-bedroom apartment with skyline views and inverter backup",
      description:
        "Modern 2-bedroom, 2-bathroom apartment in a secure Sandton block with a full generator-backed common area, fibre, basement parking, and a bright open-plan lounge. Ideal for professionals who want a polished lock-up-and-go space close to Gautrain, offices, and restaurants.",
      photos: [media.apartment],
      videos: [],
      price_cents: 245000000,
      price_negotiable: true,
      location_province: "Gauteng",
      location_city: "Sandton",
      location_suburb: "Morningside",
      contact_methods: ["call", "whatsapp", "form"],
      attributes: {
        property_type: "apartment",
        bedrooms: 2,
        bathrooms: 2,
        parking_spots: 2,
        size_sqm: 118,
        furnished: true,
        pets_allowed: false,
      },
      condition: "like_new",
      status: "live",
      boost_until: timestamps.boostUntil,
      featured: true,
      published_at: timestamps.mar22,
      created_at: timestamps.mar22,
      updated_at: timestamps.mar23,
    },
    {
      id: "7388ac5a-0e4d-4a2a-a97f-e7b5e5c32f02",
      owner_id: ownerIds.get("kabelo"),
      area: "MZANSI_MARKET",
      category: "vehicles",
      title: "2021 Toyota Hilux Raider 2.8 GD-6 4x4 auto",
      description:
        "Clean, one-owner Hilux Raider with full-service history, leather trim, reverse camera, tow bar, tonneau cover, and long-distance comfort. Maintained for business travel and weekend escapes, with no accident history and all paperwork ready for transfer.",
      photos: [media.pickupTruck],
      videos: [],
      price_cents: 64990000,
      price_negotiable: true,
      location_province: "Western Cape",
      location_city: "Cape Town",
      location_suburb: "Century City",
      contact_methods: ["call", "whatsapp"],
      attributes: {
        make: "Toyota",
        model: "Hilux",
        year: 2021,
        mileage_km: 68400,
        transmission: "automatic",
        fuel_type: "diesel",
        body_type: "bakkie",
        colour: "White",
      },
      condition: "good",
      status: "live",
      boost_until: timestamps.boostUntil,
      featured: true,
      published_at: timestamps.mar21,
      created_at: timestamps.mar21,
      updated_at: timestamps.mar23,
    },
    {
      id: "a05e5d78-94bd-4ff6-a6c9-f7eb9950ab03",
      owner_id: ownerIds.get("aisha"),
      area: "MZANSI_MARKET",
      category: "electronics",
      title: "Sony A7C II creator bundle with lens, mic and travel tripod",
      description:
        "Lightweight mirrorless creator bundle assembled for content shoots, lookbooks, and short-form brand work. Includes camera body, starter lens, on-camera mic, extra battery, and compact tripod in a setup that is easy to transport and quick to deploy.",
      photos: [media.creatorDesk],
      videos: [],
      price_cents: 3899900,
      price_negotiable: false,
      location_province: "Western Cape",
      location_city: "Cape Town",
      location_suburb: "Gardens",
      contact_methods: ["whatsapp", "form"],
      attributes: {
        device_type: "Cameras & Drones",
        brand: "Sony",
        model_name: "A7C II",
        warranty_months: 10,
      },
      condition: "like_new",
      status: "live",
      boost_until: timestamps.boostUntil,
      featured: false,
      published_at: timestamps.mar23,
      created_at: timestamps.mar23,
      updated_at: timestamps.mar23,
    },
    {
      id: "1e66a361-c24d-40f4-9bba-0dd1710da404",
      owner_id: ownerIds.get("aisha"),
      area: "MZANSI_MARKET",
      category: "electronics",
      title: "MacBook Air + iPhone remote-work setup bundle",
      description:
        "A clean Apple remote-work pairing for founders, consultants, and social managers who need to move fast. Includes a MacBook Air, iPhone, protective sleeves, and a streamlined desk setup that is ideal for email, presentations, content review, and admin on the go.",
      photos: [media.workspaceBundle],
      videos: [],
      price_cents: 2699900,
      price_negotiable: true,
      location_province: "Western Cape",
      location_city: "Cape Town",
      location_suburb: "Sea Point",
      contact_methods: ["whatsapp", "form"],
      attributes: {
        device_type: "Laptop",
        brand: "Apple",
        model_name: "MacBook Air + iPhone setup",
        storage_gb: 256,
        warranty_months: 6,
      },
      condition: "good",
      status: "live",
      boost_until: timestamps.boostUntil,
      featured: false,
      published_at: timestamps.mar20,
      created_at: timestamps.mar20,
      updated_at: timestamps.mar23,
    },
    {
      id: "aafc7f3b-c610-4759-8361-9114045ec405",
      owner_id: ownerIds.get("aisha"),
      area: "MZANSI_MARKET",
      category: "home_lifestyle",
      title: "Boutique display rail and curated occasionwear clearance set",
      description:
        "A ready-to-stage boutique presentation set featuring curated dresses, rails, and display pieces styled for a premium storefront or event pop-up. Ideal for investors wanting to see how fashion inventory can be merchandised with a soft, editorial retail finish.",
      photos: [media.boutique],
      videos: [],
      price_cents: 1450000,
      price_negotiable: true,
      location_province: "Western Cape",
      location_city: "Cape Town",
      location_suburb: "Gardens",
      contact_methods: ["whatsapp", "form"],
      attributes: {
        sub_category: "clothing",
        material: "Mixed boutique inventory",
      },
      condition: "good",
      status: "live",
      boost_until: timestamps.boostUntil,
      featured: false,
      published_at: timestamps.mar18,
      created_at: timestamps.mar18,
      updated_at: timestamps.mar23,
    },
    {
      id: "8dc0df3b-7380-4d5d-92ff-7098c2ad1e06",
      owner_id: ownerIds.get("ayanda"),
      area: "MZANSI_MARKET",
      category: "home_lifestyle",
      title: "Salon station package with mirrors, chairs and reception desk",
      description:
        "A clean 4-station salon setup with ornate mirrors, client chairs, cabinetry, and a compact reception area. Suitable for a beauty studio launch, expansion into a second room, or a polished investor preview showing how beauty operators can merchandise a professional interior.",
      photos: [media.salon],
      videos: [],
      price_cents: 1890000,
      price_negotiable: true,
      location_province: "KwaZulu-Natal",
      location_city: "Umhlanga",
      location_suburb: "Umhlanga Ridge",
      contact_methods: ["call", "whatsapp"],
      attributes: {
        sub_category: "furniture",
        material: "Mirror glass, steel and laminate",
      },
      condition: "good",
      status: "live",
      boost_until: timestamps.boostUntil,
      featured: false,
      published_at: timestamps.mar19,
      created_at: timestamps.mar19,
      updated_at: timestamps.mar23,
    },
    {
      id: "2ac2c6c1-6b40-459f-b567-1550dbdbad07",
      owner_id: ownerIds.get("naledi"),
      area: "MZANSI_MARKET",
      category: "home_lifestyle",
      title: "Commercial 2-group espresso machine for cafe rollout",
      description:
        "Reliable 2-group espresso machine configured for a busy morning service and sized for a neighbourhood coffee bar, event trailer, or studio showroom. Perfect for demonstrating how hospitality sellers can present premium equipment inside a business-ready marketplace listing.",
      photos: [media.espressoMachine],
      videos: [],
      price_cents: 5400000,
      price_negotiable: true,
      location_province: "Gauteng",
      location_city: "Johannesburg",
      location_suburb: "Rosebank",
      contact_methods: ["call", "whatsapp", "form"],
      attributes: {
        sub_category: "appliances",
        material: "Commercial stainless steel",
      },
      condition: "good",
      status: "live",
      boost_until: timestamps.boostUntil,
      featured: false,
      published_at: timestamps.mar17,
      created_at: timestamps.mar17,
      updated_at: timestamps.mar23,
    },
    {
      id: "f37cf015-16d4-48ff-9d25-a8ee2980c408",
      owner_id: ownerIds.get("siphokazi"),
      area: "MZANSI_MARKET",
      category: "jobs_services",
      title: "Workshop host and event moderator packages for launches",
      description:
        "Experienced event host available for breakfasts, product launches, pitch nights, and community workshops. Packages include agenda shaping, audience facilitation, sponsor cueing, and light stage management for brands that want a credible, polished front-of-room presence.",
      photos: [media.workshopAudience],
      videos: [],
      price_cents: 850000,
      price_negotiable: true,
      location_province: "KwaZulu-Natal",
      location_city: "Durban",
      location_suburb: "Morningside",
      contact_methods: ["whatsapp", "form"],
      attributes: {
        job_type: "freelance",
        remote: false,
        salary_range: "From R8 500 per event",
      },
      condition: null,
      status: "live",
      boost_until: timestamps.boostUntil,
      featured: true,
      published_at: timestamps.mar23,
      created_at: timestamps.mar23,
      updated_at: timestamps.mar23,
    },
  ];
}

function buildPromotions(ownerIds: Map<DemoMemberKey, string>) {
  return [
    {
      id: "fd852dde-55e0-4d8f-a0cd-8ca1bea1de11",
      owner_id: ownerIds.get("naledi"),
      business_id: "5c9dfa01-fc96-47a0-9ab4-55ca7f42c901",
      title: "Sunrise Flat White Two-for-One",
      description:
        "Bring a colleague between 07:00 and 10:00 and get a second flat white on the house. Designed to drive commuter traffic, early meetings, and repeat weekday footfall.",
      promotion_type: "deal",
      category: "Coffee special",
      category_key: "food_dining",
      photos: [media.coffeeShop],
      videos: [],
      price_cents: 4500,
      price_negotiable: false,
      location_province: "Gauteng",
      location_city: "Sandton",
      contact_methods: ["call", "whatsapp"],
      start_date: timestamps.mar23,
      end_date: timestamps.apr04End,
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: timestamps.featureUntil,
      view_count: 412,
      published_at: timestamps.mar23,
      created_at: timestamps.mar23,
      updated_at: timestamps.mar23,
    },
    {
      id: "5bf27f33-87f4-4d72-9940-7fc64f4bb512",
      owner_id: ownerIds.get("naledi"),
      business_id: "5c9dfa01-fc96-47a0-9ab4-55ca7f42c901",
      title: "Latte Art Saturday Session",
      description:
        "A small-group tasting and latte art class for curious coffee drinkers, creators, and teams wanting a memorable Saturday activity in Sandton. Includes a guided tasting flight and practical milk-texturing tips.",
      promotion_type: "event",
      category: "Coffee workshop",
      category_key: "education_training",
      photos: [media.coffeeShop],
      videos: [],
      price_cents: 35000,
      price_negotiable: false,
      location_province: "Gauteng",
      location_city: "Sandton",
      contact_methods: ["whatsapp", "form"],
      start_date: timestamps.apr04,
      end_date: timestamps.apr04End,
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: null,
      view_count: 186,
      published_at: timestamps.mar20,
      created_at: timestamps.mar20,
      updated_at: timestamps.mar23,
    },
    {
      id: "8612363b-b7e2-43e4-9e85-7dd7ef456513",
      owner_id: ownerIds.get("ayanda"),
      business_id: "8d4b15d5-9e89-42b7-90d4-a96404ba7302",
      title: "Bridal Glam Trial Bookings Open",
      description:
        "Book a full bridal trial with skin prep, soft-glam face charting, and a look tailored for studio lighting, outdoor ceremonies, and content capture. Limited appointments available ahead of the winter wedding calendar.",
      promotion_type: "service",
      category: "Beauty packages",
      category_key: "health_beauty",
      photos: [media.salon],
      videos: [],
      price_cents: 180000,
      price_negotiable: false,
      location_province: "KwaZulu-Natal",
      location_city: "Umhlanga",
      contact_methods: ["call", "whatsapp"],
      start_date: timestamps.mar22,
      end_date: timestamps.apr11End,
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: timestamps.featureUntil,
      view_count: 265,
      published_at: timestamps.mar22,
      created_at: timestamps.mar22,
      updated_at: timestamps.mar23,
    },
    {
      id: "5882f561-8fd2-435d-88c7-6074f5420e14",
      owner_id: ownerIds.get("kabelo"),
      business_id: "d95ea204-347a-4f5d-b4f6-5af1d6e75c43",
      title: "Same-Day Screen Replacement Special",
      description:
        "Fast turnaround on cracked-screen repairs for selected iPhone and Samsung models, with pickup and drop-off available in core Cape Town business zones. Ideal for professionals who cannot afford a full day without their primary device.",
      promotion_type: "deal",
      category: "Device repair",
      category_key: "electronics_tech",
      photos: [media.phoneRepair],
      videos: [],
      price_cents: 99900,
      price_negotiable: false,
      location_province: "Western Cape",
      location_city: "Cape Town",
      contact_methods: ["call", "whatsapp"],
      start_date: timestamps.mar21,
      end_date: timestamps.apr18End,
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: timestamps.featureUntil,
      view_count: 391,
      published_at: timestamps.mar21,
      created_at: timestamps.mar21,
      updated_at: timestamps.mar23,
    },
    {
      id: "8fe3ebee-6234-4a78-a969-78236e9bd615",
      owner_id: ownerIds.get("aisha"),
      business_id: "0feb345b-37a2-4e0b-bf32-b75c84a1f2ea",
      title: "Autumn Capsule Drop: Limited Release",
      description:
        "A tightly edited occasionwear release featuring soft neutrals, easy tailoring, and boutique finishing details. Produced in small quantities for clients who want fashion-first photography and premium presentation.",
      promotion_type: "product",
      category: "Fashion capsule",
      category_key: "fashion_accessories",
      photos: [media.boutique],
      videos: [],
      price_cents: 129900,
      price_negotiable: false,
      location_province: "Western Cape",
      location_city: "Cape Town",
      contact_methods: ["whatsapp", "form"],
      start_date: timestamps.mar20,
      end_date: timestamps.apr18End,
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: null,
      view_count: 208,
      published_at: timestamps.mar20,
      created_at: timestamps.mar20,
      updated_at: timestamps.mar23,
    },
    {
      id: "53afcf54-b8f1-4f9f-a913-d1bc884e0816",
      owner_id: ownerIds.get("siphokazi"),
      business_id: "c07ef0fd-826f-4d79-a11f-15ae1e36fc0c",
      title: "Weekend Fresh Produce Crates",
      description:
        "Pre-order a seasonal fruit and veg crate packed for families, apartment kitchens, and gifting. The offer is designed to show how a simple weekly special can drive repeat market pickups and WhatsApp pre-orders.",
      promotion_type: "deal",
      category: "Produce box",
      category_key: "groceries_essentials",
      photos: [media.produce],
      videos: [],
      price_cents: 34900,
      price_negotiable: false,
      location_province: "KwaZulu-Natal",
      location_city: "Durban",
      contact_methods: ["whatsapp", "form"],
      start_date: timestamps.mar23,
      end_date: timestamps.apr11End,
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: null,
      view_count: 174,
      published_at: timestamps.mar23,
      created_at: timestamps.mar23,
      updated_at: timestamps.mar23,
    },
    {
      id: "d56fd1c6-f6ff-4f65-bc8b-1de69d47ef17",
      owner_id: ownerIds.get("siphokazi"),
      business_id: "c07ef0fd-826f-4d79-a11f-15ae1e36fc0c",
      title: "Saturday Makers & Tasting Market",
      description:
        "A curated community market with produce tastings, baked goods, gifting tables, and a relaxed family-friendly atmosphere. Built to showcase how the events surface looks when a local operator runs recurring weekend activations.",
      promotion_type: "event",
      category: "Community market",
      category_key: "events_entertainment",
      photos: [media.nightMarket],
      videos: [],
      price_cents: 0,
      price_negotiable: false,
      location_province: "KwaZulu-Natal",
      location_city: "Durban",
      contact_methods: ["whatsapp", "form"],
      start_date: timestamps.apr11,
      end_date: timestamps.apr11End,
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: timestamps.featureUntil,
      view_count: 322,
      published_at: timestamps.mar22,
      created_at: timestamps.mar22,
      updated_at: timestamps.mar23,
    },
    {
      id: "1c1fc19a-f77b-4d07-b436-ae4ef0ee2c18",
      owner_id: ownerIds.get("naledi"),
      business_id: null,
      title: "Women in Business Breakfast: Building Trust Online",
      description:
        "A practical breakfast session for founders, brand managers, and service operators on turning credibility into visibility. The format includes a short keynote, audience Q&A, and networking built specifically for investor and partner conversations.",
      promotion_type: "event",
      category: "Business breakfast",
      category_key: "education_training",
      photos: [media.workshopAudience],
      videos: [],
      price_cents: 25000,
      price_negotiable: false,
      location_province: "Gauteng",
      location_city: "Johannesburg",
      contact_methods: ["form"],
      start_date: timestamps.apr18,
      end_date: timestamps.apr18End,
      status: "live",
      boost_until: timestamps.boostUntil,
      featured_until: null,
      view_count: 147,
      published_at: timestamps.mar23,
      created_at: timestamps.mar23,
      updated_at: timestamps.mar23,
    },
    {
      id: "cb8c3165-c1bc-4f9c-9d3b-b6b414ddc519",
      owner_id: ownerIds.get("siphokazi"),
      business_id: "c07ef0fd-826f-4d79-a11f-15ae1e36fc0c",
      title: "December Night Market Pop-Up",
      description:
        "A previous seasonal pop-up featuring food stalls, gifting tables, and live entertainment. Kept visible in history to demonstrate how completed events appear inside the archived events experience.",
      promotion_type: "event",
      category: "Night market",
      category_key: "events_entertainment",
      photos: [media.nightMarket],
      videos: [],
      price_cents: 0,
      price_negotiable: false,
      location_province: "KwaZulu-Natal",
      location_city: "Durban",
      contact_methods: ["form"],
      start_date: timestamps.feb28,
      end_date: timestamps.feb28End,
      status: "live",
      boost_until: null,
      featured_until: null,
      view_count: 509,
      published_at: timestamps.feb28,
      created_at: timestamps.feb28,
      updated_at: timestamps.mar23,
    },
  ];
}

async function upsertRows(table: "businesses" | "listings" | "promotions", rows: object[]) {
  const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });

  if (error) {
    throw error;
  }
}

async function printSummary() {
  const [listings, businesses, promotions] = await Promise.all([
    supabase
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("status", "live")
      .eq("area", "MZANSI_MARKET"),
    supabase
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .eq("status", "live")
      .eq("area", "MZANSI_BUSINESS"),
    supabase.from("promotions").select("id", { count: "exact", head: true }).eq("status", "live"),
  ]);

  process.stdout.write(
    `${JSON.stringify(
      {
        liveListings: listings.count ?? 0,
        liveBusinesses: businesses.count ?? 0,
        livePromotions: promotions.count ?? 0,
      },
      null,
      2
    )}\n`
  );
}

async function main() {
  process.stdout.write("Seeding investor demo content...\n");

  const ownerIds = await ensureDemoMembers();
  await upsertRows("businesses", buildBusinesses(ownerIds));
  await upsertRows("listings", buildListings(ownerIds));
  await upsertRows("promotions", buildPromotions(ownerIds));

  process.stdout.write("Seed complete.\n");
  await printSummary();
}

main().catch((error) => {
  console.error("Investor demo seed failed:");
  console.error(error);
  process.exit(1);
});
