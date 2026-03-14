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
    .max(120, "Title cannot exceed 120 characters"),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters")
    .max(5000, "Description cannot exceed 5000 characters"),
  price_zar: priceSchema,
  negotiable: z.boolean().default(false),
  province: z.string().min(1, "Province is required"),
  city: z.string().min(1, "City is required"),
  category: z.enum([
    "property",
    "vehicles",
    "auto_parts",
    "electronics",
    "home_lifestyle",
    "jobs_services",
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
  videos: z.array(trustedMediaUrl).max(9, "Maximum 9 videos").default([]),
  videoThumbnail: trustedMediaUrl.nullable().optional(),
  town: z.string().trim().max(120, "Town / suburb must be 120 characters or fewer").optional(),
  contactMethods: z
    .array(z.enum(CONTACT_METHODS))
    .min(1, "Choose at least one contact method.")
    .default(["call"]),
});

// ── Category-specific attributes ────────────────────────────
const propertyAttrs = z.object({
  property_type: z.enum(["house", "apartment", "land", "commercial", "room"]),
  bedrooms: z.number().int().min(0).max(20).optional(),
  bathrooms: z.number().int().min(0).max(10).optional(),
  size_sqm: z.number().min(1).max(100000).optional(),
  parking_spots: z.number().int().min(0).max(10).optional(),
  furnished: z.boolean().optional(),
  pets_allowed: z.boolean().optional(),
});

const carsAttrs = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
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
});

const autoPartsAttrs = z.object({
  part_type: z.string().min(1, "Part type is required"),
  compatible_make: z.string().optional(),
  compatible_model: z.string().optional(),
  oem_or_aftermarket: z.enum(["oem", "aftermarket"]).optional(),
});

const electronicsAttrs = z.object({
  device_type: z.enum(ELECTRONICS_DEVICE_TYPES),
  brand: z.string().min(1, "Brand is required"),
  model_name: z.string().optional(),
  storage_gb: z.number().int().min(1).optional(),
  screen_size_inches: z.number().min(1).max(100).optional(),
  warranty_months: z.number().int().min(0).optional(),
});

const homeLifestyleAttrs = z.object({
  sub_category: z
    .enum(["furniture", "appliances", "garden", "decor", "clothing", "other"])
    .optional(),
  material: z.string().max(50).optional(),
});

const jobsAttrs = z.object({
  job_type: z.enum(["full_time", "part_time", "contract", "freelance"]),
  remote: z.boolean().optional(),
  salary_range: z.string().max(60).optional(),
});

// ── Discriminated union by category ─────────────────────────
/**
 * Zod discriminated-union schema for marketplace listings.
 * Validates base fields (title, description, price, location, category, images)
 * plus category-specific attribute objects (property, cars, auto_parts, etc.).
 */
export const listingSchema = z.discriminatedUnion("category", [
  listingBase.extend({ category: z.literal("property"), attributes: propertyAttrs }),
  listingBase.extend({ category: z.literal("vehicles"), attributes: carsAttrs }),
  listingBase.extend({ category: z.literal("auto_parts"), attributes: autoPartsAttrs }),
  listingBase.extend({ category: z.literal("electronics"), attributes: electronicsAttrs }),
  listingBase.extend({ category: z.literal("home_lifestyle"), attributes: homeLifestyleAttrs }),
  listingBase.extend({ category: z.literal("jobs_services"), attributes: jobsAttrs }),
]);

/** Inferred input type for {@link listingSchema}. */
export type ListingInput = z.infer<typeof listingSchema>;
