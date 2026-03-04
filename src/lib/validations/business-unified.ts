import { z } from "zod";

const saPhoneRegex = /^(\+27|0)[6-8][0-9]{8}$/;

const BUSINESS_TYPES = [
  "mall_store",
  "standalone_shop",
  "home_business",
  "mobile_service",
  "online_only",
  "market_stall",
] as const;

const BUSINESS_CATEGORIES = [
  "fashion_accessories",
  "electronics_tech",
  "groceries_essentials",
  "health_beauty",
  "home_living",
  "food_dining",
  "trade_maintenance",
  "professional_services",
  "education_training",
  "events_entertainment",
  "automotive_transport",
  "general_other",
] as const;

/**
 * Zod schema for creating or updating a unified Mzansi Business.
 * Replaces both storefrontSchema and businessProfileSchema.
 * Conditional fields depend on `business_type`.
 */
export const businessSchema = z
  .object({
    business_name: z
      .string()
      .min(2, "Business name must be at least 2 characters")
      .max(100, "Business name cannot exceed 100 characters"),
    slug: z
      .string()
      .min(3, "Slug must be at least 3 characters")
      .max(60, "Slug cannot exceed 60 characters")
      .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers and hyphens"),
    business_type: z.enum(BUSINESS_TYPES),
    category: z.enum(BUSINESS_CATEGORIES),
    description: z
      .string()
      .max(3000, "Description cannot exceed 3000 characters")
      .optional()
      .default(""),

    // Location
    location_province: z.string().min(1, "Province is required"),
    location_city: z.string().min(1, "City is required"),
    store_number: z.string().max(20).optional(),
    mall_id: z.string().uuid().optional(),
    map_directions: z.string().url().optional().or(z.literal("")),

    // Contact
    phone: z.string().regex(saPhoneRegex, "Enter a valid SA number").optional().or(z.literal("")),
    whatsapp: z
      .string()
      .regex(saPhoneRegex, "Enter a valid SA number")
      .optional()
      .or(z.literal("")),
    email: z.string().email().optional().or(z.literal("")),
    website: z.string().url("Enter a valid URL").optional().or(z.literal("")),

    // Media
    logo_url: z.string().url().optional().or(z.literal("")),
    cover_photo: z.string().url().optional().or(z.literal("")),
    cover_video: z.string().url().optional().or(z.literal("")),
    video_thumbnail: z.string().url().optional().or(z.literal("")),
    gallery_photos: z
      .array(z.string().url())
      .max(5, "Maximum 5 gallery photos")
      .optional()
      .default([]),

    // Details
    services_offered: z.array(z.string().max(200)).max(30).optional().default([]),
    service_areas: z.record(z.string(), z.unknown()).optional(),
    operating_hours: z.record(z.string(), z.unknown()).optional().default({}),
    payment_methods_accepted: z
      .array(z.enum(["cash", "card", "eft", "snapscan", "capitec_pay", "other"]))
      .optional()
      .default([]),
    delivery_options: z
      .array(z.enum(["in_store", "delivery", "collection", "nationwide"]))
      .optional()
      .default([]),
    social_links: z.record(z.string(), z.string().url()).optional(),
  })
  .superRefine((data, ctx) => {
    // Mall stores require store_number
    if (data.business_type === "mall_store" && !data.store_number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Store number is required for mall stores",
        path: ["store_number"],
      });
    }
    // Mobile services should have service_areas
    if (
      data.business_type === "mobile_service" &&
      (!data.service_areas || Object.keys(data.service_areas).length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Service areas are required for mobile services",
        path: ["service_areas"],
      });
    }
  });

/** Inferred input type for {@link businessSchema}. */
export type BusinessInput = z.infer<typeof businessSchema>;
