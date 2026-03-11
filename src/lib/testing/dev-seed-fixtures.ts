import {
  BUSINESS_CATEGORY_LABELS,
  CATEGORY_LABELS,
  type BusinessCategory,
  type BusinessType,
  type ListingCategory,
  type PromotionType,
} from "@/types/enums";

export interface DevSeedMember {
  email: string;
  name: string;
  phone: string;
  location_province: string;
  location_city: string;
}

/** @deprecated Use DevSeedMember */
export type DevSeedSeller = DevSeedMember;

export interface DevSeedListingFixture {
  category: ListingCategory;
  title: string;
  description: string;
  photos: string[];
  price_cents: number;
  price_negotiable: boolean;
  location_province: string;
  location_city: string;
  contact_methods: Array<"call" | "whatsapp" | "form">;
  condition?: "new" | "like_new" | "good" | "fair" | "for_parts";
  attributes?: Record<string, unknown>;
}

export interface DevSeedBusinessFixture {
  slug: string;
  business_name: string;
  business_type: BusinessType;
  category: BusinessCategory;
  description: string;
  cover_photo: string;
  logo_url?: string | null;
  cover_video?: string | null;
  video_thumbnail?: string | null;
  gallery_photos?: string[];
  location_province: string;
  location_city: string;
  phone: string;
  whatsapp?: string | null;
  email: string;
  website?: string | null;
  services_offered: string[];
  service_areas?: Record<string, unknown> | null;
  business_details?: Record<string, unknown> | null;
  operating_hours?: Record<string, unknown>;
  payment_methods_accepted?: string[];
  delivery_options?: string[];
}

export interface DevSeedPromotionFixture {
  business_slug: string;
  category_key: BusinessCategory;
  title: string;
  description: string;
  promotion_type: PromotionType;
  photos: string[];
  videos?: string[];
  video_thumbnail?: string | null;
  price_cents?: number | null;
  price_negotiable?: boolean;
  contact_methods?: Array<"call" | "whatsapp" | "form">;
  schedule?: "upcoming" | "ongoing";
}

export interface DevSeedBusinessRowRef {
  id: string;
  slug: string | null;
  owner_id: string;
  location_province: string;
  location_city: string;
}

const DEFAULT_OPERATING_HOURS = {
  monday: "08:00-17:00",
  tuesday: "08:00-17:00",
  wednesday: "08:00-17:00",
  thursday: "08:00-17:00",
  friday: "08:00-17:00",
  saturday: "09:00-13:00",
  sunday: "closed",
} satisfies Record<string, unknown>;

export const DEV_SEED_MEMBERS: DevSeedMember[] = [
  {
    email: "dev_seed_seller1@test.com",
    name: "Dev Seed Member One",
    phone: "+27000000010",
    location_province: "Gauteng",
    location_city: "Johannesburg",
  },
];

export const DEV_SEED_LISTING_FIXTURES: DevSeedListingFixture[] = [
  {
    category: "property",
    title: "[Seed] Family Home in Soweto",
    description:
      "Three-bedroom family home with secure parking, fitted kitchen, and easy access to schools and taxis.",
    photos: ["/images/promo/seed-mall.png"],
    price_cents: 14500000,
    price_negotiable: true,
    location_province: "Gauteng",
    location_city: "Johannesburg",
    contact_methods: ["call", "whatsapp"],
    condition: "good",
    attributes: {
      property_type: "house",
      bedrooms: 3,
      bathrooms: 2,
      parking_spots: 2,
      furnished: false,
    },
  },
  {
    category: "vehicles",
    title: "[Seed] Toyota Hilux 2021 2.8 GD-6",
    description:
      "Well-kept bakkie with full service history, canopy, tow bar, and long-distance comfort.",
    photos: ["/images/promo/seed-hilux.png"],
    price_cents: 45000000,
    price_negotiable: true,
    location_province: "Western Cape",
    location_city: "Cape Town",
    contact_methods: ["call", "form"],
    condition: "like_new",
    attributes: {
      make: "Toyota",
      model: "Hilux",
      year: 2021,
      mileage_km: 68500,
      transmission: "automatic",
      fuel_type: "diesel",
      body_type: "bakkie",
      colour: "White",
    },
  },
  {
    category: "auto_parts",
    title: "[Seed] VW Polo Brake Pad Set",
    description:
      "Front brake pad set for VW Polo models with fitting guide included and same-day dispatch available.",
    photos: ["/images/promo/seed-plumber.png"],
    price_cents: 185000,
    price_negotiable: false,
    location_province: "KwaZulu-Natal",
    location_city: "Durban",
    contact_methods: ["whatsapp"],
    condition: "new",
    attributes: {
      part_type: "brakes",
      compatible_make: "Volkswagen",
      compatible_model: "Polo",
      oem_or_aftermarket: "aftermarket",
    },
  },
  {
    category: "electronics",
    title: "[Seed] Sony PlayStation 5 Bundle",
    description:
      "Console bundle with two controllers, charging dock, and recent racing titles already installed.",
    photos: ["/images/promo/seed-ps5.png"],
    price_cents: 1100000,
    price_negotiable: false,
    location_province: "Gauteng",
    location_city: "Sandton",
    contact_methods: ["whatsapp", "call"],
    condition: "like_new",
    attributes: {
      device_type: "Gaming Console",
      brand: "Sony",
      model_name: "PlayStation 5",
      storage_gb: 825,
      warranty_months: 8,
    },
  },
  {
    category: "home_lifestyle",
    title: "[Seed] Modern L-Shape Sofa",
    description:
      "Comfortable sectional sofa in charcoal fabric, ideal for family lounges or Airbnb refreshes.",
    photos: ["/images/promo/seed-sofa.png"],
    price_cents: 800000,
    price_negotiable: true,
    location_province: "KwaZulu-Natal",
    location_city: "Durban",
    contact_methods: ["whatsapp"],
    condition: "good",
    attributes: {
      sub_category: "furniture",
      material: "Fabric",
    },
  },
  {
    category: "jobs_services",
    title: "[Seed] Weekend Event MC Services",
    description:
      "Professional MC available for launches, weddings, and community events with bilingual hosting experience.",
    photos: ["/images/promo/seed-mall-canalwalk.png"],
    price_cents: 350000,
    price_negotiable: true,
    location_province: "Eastern Cape",
    location_city: "Gqeberha",
    contact_methods: ["form", "whatsapp"],
    condition: "good",
    attributes: {
      job_type: "freelance",
      remote: false,
      salary_range: "From R3,500 per event",
    },
  },
];

export const DEV_SEED_BUSINESS_FIXTURES: DevSeedBusinessFixture[] = [
  {
    slug: "seed-fashion-accessories",
    business_name: "Seed Nomsa Style Studio",
    business_type: "standalone_shop",
    category: "fashion_accessories",
    description:
      "Locally styled clothing, shoes, and accessories for everyday wear and special occasions.",
    cover_photo: "/images/promo/seed-mall-sandton.png",
    logo_url: "/images/logo-transparent.png",
    location_province: "Gauteng",
    location_city: "Johannesburg",
    phone: "+27000001001",
    whatsapp: "+27000001001",
    email: "fashion.seed@verifymzansi.test",
    services_offered: ["Boutique styling", "Alterations", "Gift packaging"],
    business_details: {
      type: "standalone_shop",
      street_address: "18 Jellicoe Avenue",
      suburb: "Rosebank",
      walk_in_policy: "walk_ins_welcome",
    },
  },
  {
    slug: "seed-electronics-tech",
    business_name: "Seed Bytewave Tech Hub",
    business_type: "standalone_shop",
    category: "electronics_tech",
    description:
      "Repairs, accessories, and device upgrades for phones, laptops, gaming, and small office tech.",
    cover_photo: "/images/promo/seed-ps5.png",
    location_province: "Western Cape",
    location_city: "Cape Town",
    phone: "+27000001002",
    whatsapp: "+27000001002",
    email: "tech.seed@verifymzansi.test",
    services_offered: ["Phone repairs", "Laptop upgrades", "Accessory sales"],
    business_details: {
      type: "standalone_shop",
      street_address: "44 Loop Street",
      suburb: "Cape Town City Centre",
      walk_in_policy: "walk_ins_welcome",
    },
  },
  {
    slug: "seed-groceries-essentials",
    business_name: "Seed Fresh Basket Grocer",
    business_type: "standalone_shop",
    category: "groceries_essentials",
    description:
      "Neighbourhood grocery shop stocking daily essentials, pantry staples, and fresh produce packs.",
    cover_photo: "/images/promo/seed-mall-africa.png",
    location_province: "KwaZulu-Natal",
    location_city: "Durban",
    phone: "+27000001003",
    whatsapp: "+27000001003",
    email: "grocer.seed@verifymzansi.test",
    services_offered: ["Fresh produce", "Bulk pantry packs", "Same-day collection"],
    business_details: {
      type: "standalone_shop",
      street_address: "9 Florida Road",
      suburb: "Morningside",
      walk_in_policy: "walk_ins_welcome",
    },
    delivery_options: ["in_store", "collection"],
  },
  {
    slug: "seed-health-beauty",
    business_name: "Seed Radiance Wellness Lounge",
    business_type: "home_business",
    category: "health_beauty",
    description:
      "Beauty treatments, wellness consultations, and curated skincare for appointments throughout the week.",
    cover_photo: "/images/promo/seed-mall-menlyn.png",
    location_province: "Mpumalanga",
    location_city: "Mbombela",
    phone: "+27000001004",
    whatsapp: "+27000001004",
    email: "wellness.seed@verifymzansi.test",
    services_offered: ["Facials", "Skincare advice", "Makeup bookings"],
    business_details: {
      type: "home_business",
      service_suburb: "West Acres",
      appointment_required: true,
      customer_pickup_allowed: false,
    },
  },
  {
    slug: "seed-home-living",
    business_name: "Seed Warm Home Interiors",
    business_type: "standalone_shop",
    category: "home_living",
    description:
      "Furniture, decor, and practical home-living pieces for apartments, family homes, and guest spaces.",
    cover_photo: "/images/promo/seed-sofa.png",
    location_province: "Free State",
    location_city: "Bloemfontein",
    phone: "+27000001005",
    whatsapp: "+27000001005",
    email: "home.seed@verifymzansi.test",
    services_offered: ["Furniture sourcing", "Interior decor", "Space styling"],
    business_details: {
      type: "standalone_shop",
      street_address: "21 Nelson Mandela Drive",
      suburb: "Westdene",
      walk_in_policy: "walk_ins_welcome",
    },
    delivery_options: ["delivery", "collection"],
  },
  {
    slug: "seed-food-dining",
    business_name: "Seed Township Table Kitchen",
    business_type: "market_stall",
    category: "food_dining",
    description:
      "Fresh meals, catering trays, and crowd-friendly food packs for weekday lunches and local events.",
    cover_photo: "/images/promo/seed-mall-gateway.png",
    location_province: "Gauteng",
    location_city: "Soweto",
    phone: "+27000001006",
    whatsapp: "+27000001006",
    email: "food.seed@verifymzansi.test",
    services_offered: ["Takeaway meals", "Event catering", "Office lunch packs"],
    business_details: {
      type: "market_stall",
      market_name: "Vilakazi Street Market",
      trading_days: ["Friday", "Saturday", "Sunday"],
      trading_hours: "10:00-20:00",
    },
  },
  {
    slug: "seed-trade-maintenance",
    business_name: "Seed Mvelase Plumbing Services",
    business_type: "mobile_service",
    category: "trade_maintenance",
    description:
      "Call-out plumbing, leak detection, geyser replacement, and preventive maintenance for homes and shops.",
    cover_photo: "/images/promo/seed-plumber.png",
    location_province: "Gauteng",
    location_city: "Pretoria",
    phone: "+27000001007",
    whatsapp: "+27000001007",
    email: "trades.seed@verifymzansi.test",
    services_offered: ["Plumbing", "Leak detection", "Geyser installation"],
    service_areas: { areas: ["Pretoria", "Centurion", "Midrand"] },
    business_details: {
      type: "mobile_service",
      travel_radius_km: 45,
      callout_fee_from: 450,
      emergency_callouts: true,
    },
    delivery_options: ["delivery"],
  },
  {
    slug: "seed-professional-services",
    business_name: "Seed Ledger Lane Advisory",
    business_type: "online_only",
    category: "professional_services",
    description:
      "Remote bookkeeping, payroll support, and SME admin systems for growing teams and side hustles.",
    cover_photo: "/images/promo/seed-mall.png",
    location_province: "Gauteng",
    location_city: "Johannesburg",
    phone: "+27000001008",
    whatsapp: "+27000001008",
    email: "advisory.seed@verifymzansi.test",
    website: "https://professional-seed.verifymzansi.test",
    services_offered: ["Bookkeeping", "Payroll setup", "SME compliance support"],
    service_areas: { areas: ["South Africa"] },
    business_details: {
      type: "online_only",
      primary_order_channel: "website",
      order_url: "https://professional-seed.verifymzansi.test/book",
      delivery_regions: ["South Africa"],
      support_response_time: "Within 2 business hours",
    },
    delivery_options: ["nationwide"],
  },
  {
    slug: "seed-education-training",
    business_name: "Seed Bright Path Tutors",
    business_type: "home_business",
    category: "education_training",
    description:
      "After-school tutoring and exam prep for primary and high-school learners in maths, science, and English.",
    cover_photo: "/images/promo/seed-mall-canalwalk.png",
    location_province: "Limpopo",
    location_city: "Polokwane",
    phone: "+27000001009",
    whatsapp: "+27000001009",
    email: "education.seed@verifymzansi.test",
    services_offered: ["Maths tutoring", "Science tutoring", "Exam preparation"],
    business_details: {
      type: "home_business",
      service_suburb: "Bendor",
      appointment_required: true,
      customer_pickup_allowed: false,
    },
  },
  {
    slug: "seed-events-entertainment",
    business_name: "Seed Shisa Event Co",
    business_type: "market_stall",
    category: "events_entertainment",
    description:
      "Community event planning, stage hosting, and vendor coordination for launches, markets, and festivals.",
    cover_photo: "/images/promo/seed-mall-africa.png",
    location_province: "Eastern Cape",
    location_city: "Gqeberha",
    phone: "+27000001010",
    whatsapp: "+27000001010",
    email: "events.seed@verifymzansi.test",
    services_offered: ["Event hosting", "Vendor coordination", "Launch support"],
    business_details: {
      type: "market_stall",
      market_name: "Baakens Valley Pop-Up",
      trading_days: ["Saturday"],
      trading_hours: "09:00-17:00",
    },
  },
  {
    slug: "seed-automotive-transport",
    business_name: "Seed DriveSure Mobility",
    business_type: "mobile_service",
    category: "automotive_transport",
    description:
      "Mobile diagnostics, shuttle bookings, and vehicle support for commuters, SMEs, and event logistics.",
    cover_photo: "/images/promo/seed-hilux.png",
    location_province: "North West",
    location_city: "Rustenburg",
    phone: "+27000001011",
    whatsapp: "+27000001011",
    email: "auto.seed@verifymzansi.test",
    services_offered: ["Vehicle diagnostics", "Airport shuttle bookings", "Fleet support"],
    service_areas: { areas: ["Rustenburg", "Sun City", "Johannesburg"] },
    business_details: {
      type: "mobile_service",
      travel_radius_km: 120,
      callout_fee_from: 550,
      emergency_callouts: false,
    },
  },
  {
    slug: "seed-general-other",
    business_name: "Seed Mzansi Community Market",
    business_type: "standalone_shop",
    category: "general_other",
    description:
      "General retail, gift hampers, and neighbourhood notices for buyers who want a trusted local contact point.",
    cover_photo: "/images/promo/seed-mall-menlyn.png",
    location_province: "Northern Cape",
    location_city: "Kimberley",
    phone: "+27000001012",
    whatsapp: "+27000001012",
    email: "general.seed@verifymzansi.test",
    services_offered: ["Gift hampers", "Community notices", "General retail"],
    business_details: {
      type: "standalone_shop",
      street_address: "7 Chapel Street",
      suburb: "Belgravia",
      walk_in_policy: "walk_ins_welcome",
    },
  },
];

export const DEV_SEED_PROMOTION_FIXTURES: DevSeedPromotionFixture[] = [
  {
    business_slug: "seed-fashion-accessories",
    category_key: "fashion_accessories",
    title: "[Seed] Fashion Drop Weekend Sale",
    description: "Save on curated looks, handbags, and sneakers this weekend while stock lasts.",
    promotion_type: "deal",
    photos: ["/images/promo/promo-1.png"],
    price_cents: 29900,
    price_negotiable: false,
  },
  {
    business_slug: "seed-electronics-tech",
    category_key: "electronics_tech",
    title: "[Seed] Laptop Tune-Up Bundle",
    description:
      "Discounted device cleanup, SSD upgrades, and accessory bundle for students and home offices.",
    promotion_type: "service",
    photos: ["/images/promo/promo-2.png"],
    price_cents: 79900,
  },
  {
    business_slug: "seed-groceries-essentials",
    category_key: "groceries_essentials",
    title: "[Seed] Family Pantry Combo",
    description: "Bulk pantry staples and produce box combo prepared for quick weekly collection.",
    promotion_type: "product",
    photos: ["/images/promo/promo-3.png"],
    price_cents: 54900,
  },
  {
    business_slug: "seed-health-beauty",
    category_key: "health_beauty",
    title: "[Seed] Glow Session Booking Offer",
    description:
      "Book a skincare consultation and receive a reduced-rate treatment package this month.",
    promotion_type: "service",
    photos: ["/images/promo/promo-4.png"],
    price_cents: 65000,
  },
  {
    business_slug: "seed-home-living",
    category_key: "home_living",
    title: "[Seed] Apartment Refresh Package",
    description:
      "Furniture and decor bundle pricing for compact spaces, student pads, and guest suites.",
    promotion_type: "deal",
    photos: ["/images/promo/promo-5.png"],
    price_cents: 210000,
    price_negotiable: true,
  },
  {
    business_slug: "seed-food-dining",
    category_key: "food_dining",
    title: "[Seed] Lunch Pack Catering Special",
    description:
      "Order weekday lunch packs for your team or event and get discounted bulk pricing.",
    promotion_type: "deal",
    photos: ["/images/promo/promo-6.png"],
    price_cents: 12000,
  },
  {
    business_slug: "seed-trade-maintenance",
    category_key: "trade_maintenance",
    title: "[Seed] Leak Check Call-Out Offer",
    description:
      "Reduced call-out fee for early leak detection and plumbing inspections this week.",
    promotion_type: "service",
    photos: ["/images/promo/seed-plumber.png"],
    price_cents: 45000,
  },
  {
    business_slug: "seed-professional-services",
    category_key: "professional_services",
    title: "[Seed] Payroll Setup Starter Pack",
    description:
      "Flat-rate onboarding for payroll and bookkeeping workflows for small teams and freelancers.",
    promotion_type: "service",
    photos: ["/images/promo/seed-mall.png"],
    price_cents: 95000,
  },
  {
    business_slug: "seed-education-training",
    category_key: "education_training",
    title: "[Seed] Exam Prep Intensive",
    description:
      "Focused tutoring package covering revision plans, worksheets, and mock exam support.",
    promotion_type: "service",
    photos: ["/images/promo/seed-mall-canalwalk.png"],
    price_cents: 85000,
  },
  {
    business_slug: "seed-events-entertainment",
    category_key: "events_entertainment",
    title: "[Seed] Community Market Takeover",
    description:
      "Upcoming vendor market with live hosting, family activities, and booking slots for local members.",
    promotion_type: "event",
    photos: ["/images/promo/seed-mall-africa.png"],
    price_cents: null,
    schedule: "upcoming",
  },
  {
    business_slug: "seed-automotive-transport",
    category_key: "automotive_transport",
    title: "[Seed] Fleet Check and Shuttle Offer",
    description:
      "Weekend diagnostics plus transport support pricing for teams, groups, and event logistics.",
    promotion_type: "service",
    photos: ["/images/promo/seed-hilux.png"],
    price_cents: 135000,
  },
  {
    business_slug: "seed-general-other",
    category_key: "general_other",
    title: "[Seed] Local Spotlight Promo Pack",
    description:
      "General retail and neighbourhood spotlight package for brands that need quick local visibility.",
    promotion_type: "general",
    photos: ["/images/promo/seed-mall-menlyn.png"],
    price_cents: 49900,
  },
];

/** @deprecated Use DEV_SEED_MEMBERS */
export const DEV_SEED_SELLERS = DEV_SEED_MEMBERS;

function assignOwnerId(ownerIds: string[], index: number): string {
  if (ownerIds.length === 0) {
    throw new Error("At least one owner ID is required to build development seed rows.");
  }

  return ownerIds[index % ownerIds.length];
}

export function buildDevSeedListings(ownerIds: string[]) {
  const publishedAt = new Date().toISOString();

  return DEV_SEED_LISTING_FIXTURES.map((fixture, index) => ({
    owner_id: assignOwnerId(ownerIds, index),
    area: "MZANSI_MARKET" as const,
    category: fixture.category,
    title: fixture.title,
    description: fixture.description,
    photos: fixture.photos,
    videos: [],
    price_cents: fixture.price_cents,
    price_negotiable: fixture.price_negotiable,
    location_province: fixture.location_province,
    location_city: fixture.location_city,
    contact_methods: fixture.contact_methods,
    condition: fixture.condition ?? null,
    attributes: fixture.attributes ?? {},
    status: "live" as const,
    published_at: publishedAt,
    featured: false,
    urgent: false,
  }));
}

export function buildDevSeedBusinesses(ownerIds: string[]) {
  const publishedAt = new Date().toISOString();

  return DEV_SEED_BUSINESS_FIXTURES.map((fixture, index) => ({
    owner_id: assignOwnerId(ownerIds, index),
    area: "MZANSI_BUSINESS" as const,
    business_type: fixture.business_type,
    business_name: fixture.business_name,
    slug: fixture.slug,
    description: fixture.description,
    category: fixture.category,
    logo_url: fixture.logo_url ?? null,
    cover_photo: fixture.cover_photo,
    cover_video: fixture.cover_video ?? null,
    video_thumbnail: fixture.video_thumbnail ?? null,
    gallery_photos: fixture.gallery_photos ?? [],
    location_province: fixture.location_province,
    location_city: fixture.location_city,
    phone: fixture.phone,
    whatsapp: fixture.whatsapp ?? null,
    email: fixture.email,
    website: fixture.website ?? null,
    services_offered: fixture.services_offered,
    service_areas: fixture.service_areas ?? null,
    business_details: fixture.business_details ?? null,
    operating_hours: fixture.operating_hours ?? DEFAULT_OPERATING_HOURS,
    payment_methods_accepted: fixture.payment_methods_accepted ?? ["cash", "card", "eft"],
    delivery_options: fixture.delivery_options ?? ["in_store", "collection"],
    status: "live" as const,
    published_at: publishedAt,
  }));
}

export function buildDevSeedPromotions(businessRows: DevSeedBusinessRowRef[]) {
  const businessBySlug = new Map(
    businessRows
      .filter((row): row is DevSeedBusinessRowRef & { slug: string } => Boolean(row.slug))
      .map((row) => [row.slug, row])
  );
  const now = new Date();

  return DEV_SEED_PROMOTION_FIXTURES.map((fixture) => {
    const business = businessBySlug.get(fixture.business_slug);
    if (!business) {
      throw new Error(`Missing seeded business row for slug ${fixture.business_slug}`);
    }

    let startDate: string | null = null;
    let endDate: string | null = null;

    if (fixture.schedule === "upcoming") {
      startDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      endDate = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
    } else if (fixture.schedule === "ongoing") {
      startDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
      endDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
    }

    return {
      owner_id: business.owner_id,
      business_id: business.id,
      title: fixture.title,
      description: fixture.description,
      promotion_type: fixture.promotion_type,
      category: BUSINESS_CATEGORY_LABELS[fixture.category_key],
      category_key: fixture.category_key,
      photos: fixture.photos,
      videos: fixture.videos ?? [],
      video_thumbnail: fixture.video_thumbnail ?? null,
      price_cents: fixture.price_cents ?? null,
      price_negotiable: fixture.price_negotiable ?? false,
      location_province: business.location_province,
      location_city: business.location_city,
      contact_methods: fixture.contact_methods ?? ["call", "whatsapp"],
      start_date: startDate,
      end_date: endDate,
      status: "live" as const,
      published_at: now.toISOString(),
    };
  });
}

function getCounts<T extends string>(values: T[]) {
  return values.reduce(
    (acc, value) => {
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    },
    {} as Record<T, number>
  );
}

export const DEV_SEED_LISTING_CATEGORY_COUNTS = getCounts(
  DEV_SEED_LISTING_FIXTURES.map((fixture) => fixture.category)
);

export const DEV_SEED_BUSINESS_CATEGORY_COUNTS = getCounts(
  DEV_SEED_BUSINESS_FIXTURES.map((fixture) => fixture.category)
);

export const DEV_SEED_PROMOTION_CATEGORY_COUNTS = getCounts(
  DEV_SEED_PROMOTION_FIXTURES.map((fixture) => fixture.category_key)
);

export const DEV_SEED_LISTING_LABELS = DEV_SEED_LISTING_FIXTURES.map(
  (fixture) => CATEGORY_LABELS[fixture.category]
);
