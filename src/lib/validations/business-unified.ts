import { z } from "zod";
import { isTrustedPlatformMediaUrl } from "@/lib/utils/media-url";

const saPhoneRegex = /^(\+27|0)[6-8][0-9]{8}$/;

export const BUSINESS_TYPES = [
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

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const mediaUrlField = (label: string) =>
  z
    .string()
    .url()
    .refine(isTrustedPlatformMediaUrl, {
      message: `${label} must be hosted on the VerifyMzansi platform`,
    })
    .optional()
    .or(z.literal(""));

const serviceAreasSchema = z.object({
  areas: z.array(z.string().trim().min(1)).min(1, "Add at least one service area."),
});

const mallStoreDetailsSchema = z.object({
  type: z.literal("mall_store"),
  floor_or_wing: optionalText(80),
  nearest_entrance: optionalText(120),
  parking_notes: optionalText(300),
});

const standaloneShopDetailsSchema = z.object({
  type: z.literal("standalone_shop"),
  street_address: z.string().trim().min(1, "Street address is required.").max(160),
  suburb: z.string().trim().min(1, "Suburb is required.").max(80),
  landmark: optionalText(120),
  walk_in_policy: z
    .enum(["walk_ins_welcome", "appointments_preferred", "appointment_only"])
    .optional(),
});

const homeBusinessDetailsSchema = z.object({
  type: z.literal("home_business"),
  service_suburb: z.string().trim().min(1, "Service suburb is required.").max(80),
  appointment_required: z.boolean(),
  customer_pickup_allowed: z.boolean(),
  visitor_notes: optionalText(300),
});

const mobileServiceDetailsSchema = z.object({
  type: z.literal("mobile_service"),
  travel_radius_km: z.number().finite().min(0).optional(),
  callout_fee_from: z.number().finite().min(0).optional(),
  emergency_callouts: z.boolean(),
});

const onlineOnlyDetailsSchema = z.object({
  type: z.literal("online_only"),
  primary_order_channel: z
    .enum([
      "website",
      "whatsapp",
      "instagram",
      "facebook",
      "marketplace",
      "phone",
      "email",
      "other",
    ])
    .optional(),
  order_url: z.string().url("Enter a valid order URL."),
  delivery_regions: z.array(z.string().trim().min(1)).min(1, "Add at least one delivery region."),
  support_response_time: optionalText(120),
});

const marketStallDetailsSchema = z.object({
  type: z.literal("market_stall"),
  market_name: z.string().trim().min(1, "Market name is required.").max(120),
  stall_label: optionalText(80),
  trading_days: z.array(z.string().trim().min(1)).min(1, "Add at least one trading day."),
  trading_hours: z.string().trim().min(1, "Trading hours are required.").max(120),
});

export const businessDetailsSchema = z.discriminatedUnion("type", [
  mallStoreDetailsSchema,
  standaloneShopDetailsSchema,
  homeBusinessDetailsSchema,
  mobileServiceDetailsSchema,
  onlineOnlyDetailsSchema,
  marketStallDetailsSchema,
]);

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
    store_number: z.string().trim().max(20).optional(),
    mall_id: z.string().uuid().optional(),
    map_directions: z
      .string()
      .url("Enter a valid map directions URL.")
      .optional()
      .or(z.literal("")),

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
    logo_url: mediaUrlField("Logo"),
    cover_photo: mediaUrlField("Cover photo"),
    cover_video: mediaUrlField("Cover video"),
    video_thumbnail: mediaUrlField("Video thumbnail"),
    gallery_photos: z
      .array(
        z.string().url().refine(isTrustedPlatformMediaUrl, {
          message: "Gallery photos must be hosted on the VerifyMzansi platform",
        })
      )
      .max(5, "Maximum 5 gallery photos")
      .optional()
      .default([]),

    // Details
    services_offered: z.array(z.string().max(200)).max(30).optional().default([]),
    service_areas: serviceAreasSchema.optional(),
    business_details: businessDetailsSchema.nullable().optional(),
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
    if (data.business_type === "mall_store" && !data.store_number?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Store number is required for mall stores.",
        path: ["store_number"],
      });
    }

    if (data.business_type === "mobile_service" && !data.service_areas?.areas?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Service areas are required for mobile services.",
        path: ["service_areas"],
      });
    }

    if (data.business_details && data.business_details.type !== data.business_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Business details type must match the selected business type.",
        path: ["business_details", "type"],
      });
    }

    const requiredDetailFields: Partial<Record<(typeof BUSINESS_TYPES)[number], string[]>> = {
      standalone_shop: ["street_address", "suburb"],
      home_business: ["service_suburb"],
      online_only: ["primary_order_channel", "order_url", "delivery_regions"],
      market_stall: ["market_name", "trading_days", "trading_hours"],
    };

    const missingFields = requiredDetailFields[data.business_type];
    if (missingFields && !data.business_details) {
      for (const field of missingFields) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "This field is required.",
          path: ["business_details", field],
        });
      }
    }
  });

/** Inferred input type for {@link businessSchema}. */
export type BusinessInput = z.infer<typeof businessSchema>;
