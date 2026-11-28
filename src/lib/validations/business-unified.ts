import { customerAccessSchema } from "@/lib/forms/customer-access";
import { z } from "zod";
import { isTrustedPlatformMediaUrl } from "@/lib/utils/media-url";
import { businessNumber, WHATSAPP_NEEDS_MOBILE } from "@/lib/utils/phone";
import { BUSINESS_TEXT_LIMITS } from "./business-limits";
import {
  externalUrlOrEmptySchema,
  externalUrlSchema,
  hasSpoofingChars,
  NO_HIDDEN_CHARS_MESSAGE,
  postMediaMetadataFields,
} from "./shared";

/** Tourism activities whose visitors join at a meeting point or are collected. */
const TOUR_ACTIVITIES = new Set(["tour_operator", "safari_wildlife", "adventure_activities"]);

const BUSINESS_TYPES = [
  "mall_store",
  "standalone_shop",
  "home_business",
  "mobile_service",
  "online_only",
  "market_stall",
] as const;

const BUSINESS_CATEGORIES = [
  "health_medical",
  "beauty_personal",
  "fitness_wellness",
  "cleaning_garden",
  "automotive_services",
  "transport_storage",
  "pets_animals",
  "community_personal",

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
  "tourism_hospitality",
  "general_other",
] as const;

/** Payment methods a business can tick (labels in src/lib/forms/business-form.ts). */
export const PAYMENT_METHODS = [
  "cash",
  "card",
  "eft",
  "snapscan",
  "capitec_pay",
  "zapper",
  "card_machine",
  "cash_on_delivery",
  "instant_eft",
  "other",
] as const;

/** What visitors find at the premises: business_details.visitor_features. */
export const VISITOR_FEATURES = ["parking", "wheelchair_access", "kid_friendly"] as const;

const WALK_IN_POLICIES = [
  "walk_ins_welcome",
  "appointments_preferred",
  "appointment_only",
] as const;

/** Visit facts any business type may carry inside business_details. */
const visitFields = {
  walk_in_policy: z.enum(WALK_IN_POLICIES).optional(),
  visitor_features: z.array(z.enum(VISITOR_FEATURES)).max(VISITOR_FEATURES.length).optional(),
};

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

/** category_details.booking_url: an external link, or empty. */
export const bookingUrlSchema = externalUrlOrEmptySchema("Enter a valid booking link.");

const serviceAreasSchema = z.object({
  areas: z.array(z.string().trim().min(1).max(120)).min(1, "Add at least one service area."),
});

const mallStoreDetailsSchema = z.object({
  type: z.literal("mall_store"),
  mall_name: z.string().trim().min(1, "Mall name is required.").max(120),
  mall_address: optionalText(200),
  mall_summary: optionalText(600),
  mall_photos: z
    .array(
      z.string().url().refine(isTrustedPlatformMediaUrl, {
        message: "Mall photos must be hosted on the VerifyMzansi platform",
      })
    )
    .max(10, "Maximum 10 mall photos")
    .optional()
    .default([]),
  floor_or_wing: optionalText(80),
  nearest_entrance: optionalText(120),
  parking_notes: optionalText(300),
  ...visitFields,
});

const standaloneShopDetailsSchema = z.object({
  type: z.literal("standalone_shop"),
  building_name: optionalText(120),
  suite_or_unit: optionalText(40),
  street_address: z.string().trim().min(1, "Street address is required.").max(160),
  suburb: z.string().trim().min(1, "Suburb is required.").max(80),
  landmark: optionalText(120),
  ...visitFields,
});

const homeBusinessDetailsSchema = z.object({
  type: z.literal("home_business"),
  service_suburb: z.string().trim().min(1, "Service suburb is required.").max(80),
  appointment_required: z.boolean(),
  customer_pickup_allowed: z.boolean(),
  visitor_notes: optionalText(300),
  ...visitFields,
});

const mobileServiceDetailsSchema = z.object({
  type: z.literal("mobile_service"),
  travel_radius_km: z.number().finite().min(0).optional(),
  callout_fee_from: z.number().finite().min(0).optional(),
  emergency_callouts: z.boolean(),
  ...visitFields,
});

const onlineOnlyDetailsSchema = z.object({
  type: z.literal("online_only"),
  primary_order_channel: z.enum([
    "website",
    "whatsapp",
    "instagram",
    "facebook",
    "marketplace",
    "phone",
    "email",
    "other",
  ]),
  order_url: externalUrlSchema("Enter a valid order URL."),
  delivery_regions: z.array(z.string().trim().min(1).max(120)).optional(),
  support_response_time: optionalText(120),
  ...visitFields,
});

const marketStallDetailsSchema = z.object({
  type: z.literal("market_stall"),
  market_name: z.string().trim().min(1, "Market name is required.").max(120),
  stall_label: optionalText(80),
  trading_days: z.array(z.string().trim().min(1).max(40)).min(1, "Add at least one trading day."),
  trading_hours: z.string().trim().min(1, "Trading hours are required.").max(120),
  ...visitFields,
});

const businessDetailsSchema = z.discriminatedUnion("type", [
  mallStoreDetailsSchema,
  standaloneShopDetailsSchema,
  homeBusinessDetailsSchema,
  mobileServiceDetailsSchema,
  onlineOnlyDetailsSchema,
  marketStallDetailsSchema,
]);

/**
 * Forms that describe access with customer_access keep only the visit facts
 * (walk-ins, visitor features) in business_details, without the older
 * type-specific address fields.
 */
const visitOnlyDetailsSchema = z.strictObject({ type: z.enum(BUSINESS_TYPES), ...visitFields });
const VISIT_ONLY_KEYS = new Set(["type", ...Object.keys(visitFields)]);

/** Visit-only details, or the full type-specific details with their own errors. */
const businessDetailsField = z.unknown().transform((value, ctx) => {
  const visitOnly =
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).every((key) => VISIT_ONLY_KEYS.has(key));
  const result = (visitOnly ? visitOnlyDetailsSchema : businessDetailsSchema).safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) ctx.addIssue({ ...issue });
  return z.NEVER;
});

/**
 * Zod schema for creating or updating a unified Mzansi Business.
 * Replaces both storefrontSchema and businessProfileSchema.
 * Conditional fields depend on `business_type`.
 */
export const businessSchema = z
  .object({
    business_name: z
      .string()
      .trim()
      .refine((value) => !hasSpoofingChars(value), NO_HIDDEN_CHARS_MESSAGE)
      .min(2, "Business name must be at least 2 characters")
      .max(BUSINESS_TEXT_LIMITS.name, "Business name cannot exceed 100 characters"),
    slug: z
      .string()
      .min(3, "Slug must be at least 3 characters")
      .max(60, "Slug cannot exceed 60 characters")
      .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers and hyphens"),
    business_type: z.enum(BUSINESS_TYPES),
    category: z.enum(BUSINESS_CATEGORIES),
    subcategory: optionalText(80),
    description: z
      .string()
      .trim()
      .refine((value) => !hasSpoofingChars(value), NO_HIDDEN_CHARS_MESSAGE)
      .max(BUSINESS_TEXT_LIMITS.description, "Description cannot exceed 3000 characters")
      .optional()
      .default(""),

    // Location (optional for online_only)
    location_province: z.string().max(50).optional().default(""),
    location_city: z.string().max(80).optional().default(""),
    location_town: z
      .string()
      .trim()
      .max(120, "Town / suburb must be 120 characters or fewer")
      .optional(),
    location_address: z
      .string()
      .trim()
      .max(300, "Address must be 300 characters or fewer")
      .optional(),
    store_number: z.string().trim().max(20).optional(),
    map_directions: externalUrlOrEmptySchema("Enter a valid map directions URL."),

    // Contact
    // Calls take a landline, a mobile or 087/0800/0860/0861, WhatsApp a mobile
    // only (businessNumber, the same rule as the database's click-to-view
    // command).
    phone: z
      .string()
      .refine((value) => businessNumber(value) !== null, "Enter a valid SA number")
      .optional()
      .or(z.literal("")),
    whatsapp: z
      .string()
      .superRefine((value, ctx) => {
        const found = businessNumber(value);
        if (found?.kind !== "mobile")
          ctx.addIssue({
            code: "custom",
            message: found ? WHATSAPP_NEEDS_MOBILE : "Enter a valid SA number",
          });
      })
      .optional()
      .or(z.literal("")),
    website: externalUrlOrEmptySchema("Enter a valid URL"),

    // Media
    logo_url: mediaUrlField("Logo"),
    cover_photo: mediaUrlField("Cover photo"),
    cover_video: mediaUrlField("Video"),
    video_thumbnail: mediaUrlField("Video thumbnail"),
    gallery_photos: z
      .array(
        z.string().url().refine(isTrustedPlatformMediaUrl, {
          message: "Gallery photos must be hosted on the VerifyMzansi platform",
        })
      )
      .max(10, "Maximum 10 gallery photos")
      .optional()
      .default([]),

    // Details
    contact_methods: z
      .array(z.enum(["call", "whatsapp", "website", "form"]))
      .min(1)
      .optional(),
    services_offered: z.array(z.string().max(200)).max(30).optional().default([]),
    service_areas: serviceAreasSchema.optional(),
    business_details: businessDetailsField.nullable().optional(),
    // Shape-checked per category by sanitizeCategoryDetails; the size cap
    // stops a single post bloating the row.
    category_details: z
      .record(z.string().max(60), z.unknown())
      .refine((value) => JSON.stringify(value).length <= 20_000, "Too many details")
      .optional()
      .default({}),
    // Optional public business profile extras. These have no dedicated DB
    // columns — the API payload builder folds them into
    // category_details.business_profile.
    year_established: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
    bbbee_level: z
      .enum([
        "level_1",
        "level_2",
        "level_3",
        "level_4",
        "level_5",
        "level_6",
        "level_7",
        "level_8",
        "non_compliant",
        "exempt",
      ])
      .optional(),
    languages_spoken: optionalText(200),
    load_shedding_ready: z.boolean().optional(),
    number_of_employees: z.enum(["1", "2_5", "6_10", "11_50", "51_200", "200_plus"]).optional(),
    // Mon_Fri / Sat / Sun / Public_holidays free text (e.g. "08:00 - 17:00",
    // "Closed") and two yes/no flags; other keys are dropped. Readers that
    // expect text skip the flags.
    operating_hours: z
      .object({
        Mon_Fri: z.string().trim().max(60).optional(),
        Sat: z.string().trim().max(60).optional(),
        Sun: z.string().trim().max(60).optional(),
        Public_holidays: z.string().trim().max(60).optional(),
        Open_24_hours: z.boolean().optional(),
        By_appointment: z.boolean().optional(),
      })
      .optional()
      .default({}),
    payment_methods_accepted: z.array(z.enum(PAYMENT_METHODS)).optional().default([]),
    delivery_options: z
      .array(z.enum(["in_store", "delivery", "collection", "nationwide"]))
      .optional()
      .default([]),
    social_links: z.record(z.string(), externalUrlOrEmptySchema()).optional(),
    layout_template: z.enum(["cinematic", "showcase", "professional"]).nullable().optional(),
    ...postMediaMetadataFields,
    trialDays: z
      .union([z.literal(7), z.literal(30)])
      .optional()
      .default(7),
    termsAccepted: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    // Any business may link to its own booking page (category_details.booking_url).
    const bookingUrl = data.category_details?.booking_url;
    if (bookingUrl !== undefined && !bookingUrlSchema.safeParse(bookingUrl).success)
      ctx.addIssue({
        code: "custom",
        path: ["category_details", "booking_url"],
        message: "Enter a valid booking link.",
      });
    if (data.category_details?.customer_access !== undefined) {
      const result = customerAccessSchema.safeParse(data.category_details.customer_access);
      if (!result.success) {
        for (const issue of result.error.issues)
          ctx.addIssue({
            code: "custom",
            path: ["category_details", "customer_access", ...issue.path],
            message: issue.message,
          });
      } else {
        if (result.data.methods.some((m) => m !== "online")) {
          if (!data.location_province?.trim())
            ctx.addIssue({
              code: "custom",
              path: ["location_province"],
              message: "Select a province.",
            });
          if (!data.location_city?.trim())
            ctx.addIssue({
              code: "custom",
              path: ["location_city"],
              message: "Select a city or town.",
            });
        }
        if (result.data.publishAddress && !data.location_address?.trim())
          ctx.addIssue({
            code: "custom",
            path: ["location_address"],
            message:
              "Enter the visitor address you want to publish, or turn off public address visibility.",
          });
        // Tours and experiences that meet visitors need a meeting point or an address.
        const meetingPoint = data.category_details?.meeting_point;
        if (
          data.category === "tourism_hospitality" &&
          TOUR_ACTIVITIES.has(data.subcategory ?? "") &&
          result.data.methods.includes("visit") &&
          !data.location_address?.trim() &&
          !(typeof meetingPoint === "string" && meetingPoint.trim())
        )
          ctx.addIssue({
            code: "custom",
            path: ["category_details", "meeting_point"],
            message: "Describe where visitors meet you, or add a visitor address.",
          });
        if (typeof meetingPoint === "string" && meetingPoint.length > 200)
          ctx.addIssue({
            code: "custom",
            path: ["category_details", "meeting_point"],
            message: "Keep the meeting point to 200 characters or fewer.",
          });
      }
      if (!data.description?.trim())
        ctx.addIssue({
          code: "custom",
          path: ["description"],
          message: "Tell customers about your business.",
        });
      if (data.contact_methods?.includes("call") && !data.phone?.trim())
        ctx.addIssue({
          code: "custom",
          path: ["phone"],
          message: "Add a phone number for phone calls.",
        });
      if (data.contact_methods?.includes("whatsapp") && !data.whatsapp?.trim())
        ctx.addIssue({ code: "custom", path: ["whatsapp"], message: "Add a WhatsApp number." });
      if (data.contact_methods?.includes("website") && !data.website?.trim())
        ctx.addIssue({ code: "custom", path: ["website"], message: "Add a website address." });
      if (
        !data.contact_methods?.includes("form") &&
        ![data.phone, data.whatsapp, data.website].some((v) => v?.trim())
      )
        ctx.addIssue({
          code: "custom",
          path: ["phone"],
          message: "Add at least one contact method: phone, WhatsApp or website.",
        });
      return;
    }

    // Province + city required for all types except online_only
    if (data.business_type !== "online_only") {
      if (!data.location_province?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Province is required.",
          path: ["location_province"],
        });
      }
      if (!data.location_city?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "City is required.",
          path: ["location_city"],
        });
      }
    }

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
      mall_store: ["mall_name"],
      standalone_shop: ["street_address", "suburb"],
      home_business: ["service_suburb"],
      online_only: ["primary_order_channel", "order_url"],
      market_stall: ["market_name", "trading_days", "trading_hours"],
    };

    const fieldLabels: Record<string, string> = {
      mall_name: "Mall name is required.",
      street_address: "Street address is required.",
      suburb: "Suburb is required.",
      service_suburb: "Service suburb is required.",
      primary_order_channel: "Primary order channel is required.",
      order_url: "Order URL is required.",
      market_name: "Market name is required.",
      trading_days: "Trading days are required.",
      trading_hours: "Trading hours are required.",
    };

    const missingFields = requiredDetailFields[data.business_type];
    if (missingFields && !data.business_details) {
      for (const field of missingFields) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: fieldLabels[field] ?? `${field} is required.`,
          path: ["business_details", field],
        });
      }
    }
  });

/** Inferred input type for {@link businessSchema}. */
type _BusinessInput = z.infer<typeof businessSchema>;
