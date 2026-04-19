import { z } from "zod";
import { priceSchema } from "./shared";
import { isTrustedPlatformMediaUrl } from "@/lib/utils/media-url";
import { ELECTRONICS_DEVICE_TYPES } from "@/lib/constants/categories";
import type { ContactMethod } from "@/types/enums";

const CONTACT_METHODS: [ContactMethod, ...ContactMethod[]] = ["call", "whatsapp", "form", "in_app"];
const trustedMediaUrl = z.string().url().refine(isTrustedPlatformMediaUrl, {
  message: "Media must be hosted on the VerifyMzansi platform",
});

// ── Shared listing fields ───────────────────────────────────
const listingBase = z.object({
  title: z
    .string()
    .min(5, "Title must be at least 5 characters")
    .max(100, "Title cannot exceed 100 characters"),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters")
    .max(5000, "Description cannot exceed 5000 characters"),
  price_zar: priceSchema,
  negotiable: z.boolean().default(false),
  province: z.string().min(1, "Province is required").max(50),
  city: z.string().min(1, "City is required").max(80),
  category: z.enum([
    "property",
    "vehicles",
    "auto_parts",
    "electronics",
    "home_lifestyle",
    "jobs_services",
    "farming_agriculture",
    "baby_kids",
  ]),
  condition: z.enum(["new", "like_new", "good", "fair", "for_parts"]).optional(),
  images: z
    .array(
      trustedMediaUrl.refine((url) => {
        return !/\.(mp4|webm|ogg|mov)(?:[?#]|$)/i.test(url);
      }, "Images must be image URLs")
    )
    .min(1, "At least 1 image is required")
    .max(10, "Maximum 10 images"),
  videos: z.array(trustedMediaUrl).max(2, "Maximum 2 videos").default([]),
  videoThumbnail: trustedMediaUrl.nullable().optional(),
  logo_url: trustedMediaUrl.nullable().optional(),
  town: z.string().trim().max(120, "Town / suburb must be 120 characters or fewer").optional(),
  address: z.string().trim().max(300, "Address must be 300 characters or fewer").optional(),
  contactMethods: z
    .array(z.enum(CONTACT_METHODS))
    .min(1, "Choose at least one contact method.")
    .default(["call"]),
  media_width: z.number().int().positive().optional(),
  media_height: z.number().int().positive().optional(),
  focal_x: z.number().min(0).max(1).optional(),
  focal_y: z.number().min(0).max(1).optional(),
});

// ── Category-specific attributes ────────────────────────────
const propertyAttrs = z.object({
  property_type: z.enum(["house", "apartment", "land", "commercial", "room"]),
  listing_intent: z.enum(["sale", "rent"]),
  monthly_rent_zar: z.number().min(0).optional(),
  bedrooms: z.number().int().min(0).max(20).optional(),
  bathrooms: z.number().int().min(0).max(10).optional(),
  floor_size_sqm: z.number().min(1).max(100000).optional(),
  erf_size_sqm: z.number().min(1).max(1000000).optional(),
  levy_zar: z.number().min(0).optional(),
  rates_taxes_zar: z.number().min(0).optional(),
  property_subtype: z
    .enum([
      "townhouse",
      "cluster",
      "simplex",
      "duplex",
      "freestanding",
      "sectional_title",
      "estate",
    ])
    .optional(),
  parking_spots: z.number().int().min(0).max(10).optional(),
  furnished: z.boolean().optional(),
  pets_allowed: z.boolean().optional(),
  security_features: z.array(z.string()).optional(),
  pool: z.boolean().optional(),
  garden: z.enum(["none", "small", "medium", "large", "communal"]).optional(),
  domestic_quarters: z.boolean().optional(),
  garage: z.number().int().min(0).max(20).optional(),
  carport: z.number().int().min(0).max(20).optional(),
  energy_features: z.array(z.string()).optional(),
  water_source: z.array(z.string()).optional(),
  fibre: z.enum(["not_available", "fibre_ready", "fibre_installed"]).optional(),
  available_from: z.string().max(30).optional(),
});

const carsAttrs = z.object({
  make: z.string().min(1, "Make is required").max(80),
  model: z.string().min(1, "Model is required").max(80),
  variant: z.string().max(100).optional(),
  year: z
    .number()
    .int()
    .min(1950)
    .max(new Date().getFullYear() + 1),
  mileage_km: z.number().int().min(0).max(999999),
  transmission: z.enum(["manual", "automatic"]),
  fuel_type: z.enum(["petrol", "diesel", "electric", "hybrid"]),
  body_type: z.enum(["sedan", "hatchback", "suv", "bakkie", "van", "coupe", "other"]).optional(),
  colour: z.string().max(30).optional(),
  engine_capacity_cc: z.number().int().min(50).max(10000).optional(),
  drive_type: z.enum(["2wd", "4wd", "awd"]).optional(),
  number_of_doors: z.enum(["2", "3", "4", "5"]).optional(),
  service_history: z.enum(["full", "partial", "none"]),
  number_of_owners: z.number().int().min(1).max(20).optional(),
  accident_free: z.boolean().optional(),
  registration_province: z.string().max(30).optional(),
  extras: z.array(z.string()).optional(),
  finance_available: z.boolean().optional(),
  trade_in_accepted: z.boolean().optional(),
});

const autoPartsAttrs = z.object({
  part_type: z.string().min(1, "Part type is required").max(100),
  compatible_make: z.string().max(80).optional(),
  compatible_model: z.string().max(80).optional(),
  oem_or_aftermarket: z.enum(["oem", "aftermarket"]).optional(),
  part_condition: z.enum(["new", "used", "refurbished"]),
  warranty_included: z.boolean().optional(),
  fitment_included: z.boolean().optional(),
  compatible_year_range: z.string().max(30).optional(),
});

const electronicsAttrs = z.object({
  device_type: z.enum(ELECTRONICS_DEVICE_TYPES),
  brand: z.string().min(1, "Brand is required").max(80),
  model_name: z.string().max(100).optional(),
  storage_gb: z.number().int().min(1).optional(),
  screen_size_inches: z.number().min(1).max(100).optional(),
  warranty_months: z.number().int().min(0).optional(),
  network_lock: z.enum(["unlocked", "vodacom", "mtn", "cell_c", "telkom", "rain"]).optional(),
  battery_health_pct: z.number().int().min(0).max(100).optional(),
  ram_gb: z.number().int().min(1).max(256).optional(),
  original_accessories: z.boolean().optional(),
  activation_lock_clear: z.boolean().optional(),
});

const homeLifestyleAttrs = z.object({
  sub_category: z.enum([
    "furniture",
    "appliances",
    "garden",
    "decor",
    "clothing",
    "baby_kids",
    "sports_outdoor",
    "musical_instruments",
    "books_stationery",
    "tools_equipment",
    "other",
  ]),
  material: z.string().max(50).optional(),
  brand: z.string().max(80).optional(),
  dimensions: z.string().max(60).optional(),
  delivery_available: z.boolean().optional(),
  power_rating: z.string().max(30).optional(),
});

const jobsAttrs = z.object({
  job_type: z.enum([
    "full_time",
    "part_time",
    "contract",
    "freelance",
    "internship",
    "learnership",
    "volunteer",
  ]),
  location_type: z.enum(["on_site", "remote", "hybrid"]),
  industry: z.string().max(80).optional(),
  experience_level: z
    .enum(["entry_level", "junior", "mid_level", "senior", "executive"])
    .optional(),
  qualification_required: z
    .enum(["none", "matric", "certificate", "diploma", "degree", "postgraduate"])
    .optional(),
  salary_min: z.number().min(0).optional(),
  salary_max: z.number().min(0).optional(),
  salary_period: z.enum(["per_hour", "per_day", "per_month", "per_year"]).optional(),
  company_name: z.string().max(120).optional(),
  benefits: z.array(z.string()).optional(),
  ee_preference: z.enum(["not_applicable", "aa_candidates_preferred", "open_to_all"]).optional(),
  application_deadline: z.string().max(30).optional(),
});

const farmingAgricultureAttrs = z.object({
  farm_category: z.enum([
    "livestock",
    "crops_seeds",
    "equipment_machinery",
    "farm_land",
    "feeds_supplements",
    "farming_services",
    "other",
  ]),
  livestock_type: z
    .enum(["cattle", "sheep", "goats", "poultry", "pigs", "horses", "game", "other"])
    .optional(),
  breed: z.string().max(80).optional(),
  age_months: z.number().int().min(0).optional(),
  quantity: z.number().int().min(1).optional(),
  equipment_condition: z.enum(["new", "used", "refurbished"]).optional(),
  hectares: z.number().min(0).optional(),
  irrigation: z.enum(["none", "drip", "sprinkler", "pivot", "flood"]).optional(),
  delivery_available: z.boolean().optional(),
});

const babyKidsAttrs = z.object({
  item_type: z.enum([
    "clothing",
    "toys",
    "prams_strollers",
    "car_seats",
    "feeding",
    "nursery_furniture",
    "maternity",
    "school_supplies",
    "other",
  ]),
  age_group: z
    .enum([
      "newborn_0_3m",
      "infant_3_12m",
      "toddler_1_3y",
      "preschool_3_6y",
      "school_age_6_12y",
      "teen_12_plus",
    ])
    .optional(),
  gender: z.enum(["unisex", "boys", "girls"]).optional(),
  brand: z.string().max(80).optional(),
  safety_certified: z.boolean().optional(),
});

// ── Discriminated union by category ─────────────────────────
/**
 * Zod discriminated-union schema for marketplace listings.
 * Validates base fields (title, description, price, location, category, images)
 * plus category-specific attribute objects (property, cars, auto_parts, etc.).
 */
export const listingSchema = z
  .discriminatedUnion("category", [
    listingBase.extend({ category: z.literal("property"), attributes: propertyAttrs }),
    listingBase.extend({ category: z.literal("vehicles"), attributes: carsAttrs }),
    listingBase.extend({ category: z.literal("auto_parts"), attributes: autoPartsAttrs }),
    listingBase.extend({ category: z.literal("electronics"), attributes: electronicsAttrs }),
    listingBase.extend({ category: z.literal("home_lifestyle"), attributes: homeLifestyleAttrs }),
    listingBase.extend({ category: z.literal("jobs_services"), attributes: jobsAttrs }),
    listingBase.extend({
      category: z.literal("farming_agriculture"),
      attributes: farmingAgricultureAttrs,
    }),
    listingBase.extend({ category: z.literal("baby_kids"), attributes: babyKidsAttrs }),
  ])
  .superRefine((data, ctx) => {
    if (data.category === "jobs_services" && data.condition) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Condition is not applicable to jobs and services listings",
        path: ["condition"],
      });
    }
  });

/** Inferred input type for {@link listingSchema}. */
export type ListingInput = z.infer<typeof listingSchema>;
