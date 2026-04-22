import { z } from "zod";
import { priceSchema } from "./shared";
import type { BusinessCategory } from "@/types/enums";
import { isTrustedPlatformMediaUrl } from "@/lib/utils/media-url";

const BUSINESS_CATEGORY_VALUES = [
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
] as const satisfies readonly BusinessCategory[];

/**
 * Zod schema for standalone promotion / advertisement creation and editing.
 * Validates all fields required for a standalone ad that is NOT tied to a
 * listing, storefront, or business profile.
 * Optionally links to a Mzansi Business via business_id.
 */
export const promotionSchema = z
  .object({
    title: z
      .string()
      .min(5, "Title must be at least 5 characters")
      .max(120, "Title cannot exceed 120 characters"),
    description: z
      .string()
      .min(20, "Description must be at least 20 characters")
      .max(5000, "Description cannot exceed 5000 characters"),
    promotion_type: z.literal("event"),
    category: z.string().trim().min(1).max(100).optional(),
    category_key: z.enum(BUSINESS_CATEGORY_VALUES).optional(),
    price_zar: priceSchema.optional(),
    negotiable: z.boolean().default(false),
    province: z.string().min(1, "Province is required").max(50),
    city: z.string().min(1, "City is required").max(80),
    location_town: z.string().trim().min(1).max(120).optional(),
    location_address: z.string().trim().min(1).max(300).optional(),
    contact_methods: z
      .array(z.enum(["call", "whatsapp", "form"]))
      .min(1, "At least one contact method is required"),
    images: z
      .array(
        z.string().url().refine(isTrustedPlatformMediaUrl, {
          message: "Images must be hosted on the VerifyMzansi platform",
        })
      )
      .max(10, "Maximum 10 images"),
    videos: z
      .array(
        z.string().url().refine(isTrustedPlatformMediaUrl, {
          message: "Videos must be hosted on the VerifyMzansi platform",
        })
      )
      .max(3, "Maximum 3 videos")
      .optional()
      .default([]),
    video_thumbnail: z
      .string()
      .url()
      .refine(isTrustedPlatformMediaUrl, {
        message: "Video thumbnail must be hosted on the VerifyMzansi platform",
      })
      .optional(),
    media_width: z.number().int().positive().optional(),
    media_height: z.number().int().positive().optional(),
    focal_x: z.number().min(0).max(1).optional(),
    focal_y: z.number().min(0).max(1).optional(),
    logo_url: z
      .string()
      .url()
      .refine(isTrustedPlatformMediaUrl, {
        message: "Logo must be hosted on the VerifyMzansi platform",
      })
      .optional(),
    start_date: z.string().datetime().optional(),
    end_date: z.string().datetime().optional(),
    business_id: z.string().uuid().optional(),
    /** Structured event details (JSONB) — optional for enriched events */
    event_details: z
      .object({
        event_type: z.string().max(80).optional(),
        venue_name: z.string().max(200).optional(),
        venue_capacity: z.number().int().min(0).optional(),
        ticket_tiers: z
          .array(
            z.object({
              name: z.string().min(1).max(80),
              price_cents: z.number().int().min(0).nullable(),
            })
          )
          .max(10)
          .optional(),
        tickets_url: z.string().url().max(2000).optional().or(z.literal("")),
        age_restriction: z.string().max(20).optional(),
        dress_code: z.string().max(300).optional(),
        lineup: z.string().max(2000).optional(),
        parking_available: z.boolean().optional(),
        accessibility: z.array(z.string().max(80)).optional(),
        food_drinks_available: z.boolean().optional(),
        bring_your_own: z.string().max(500).optional(),
      })
      .optional(),
  })
  .refine((data) => data.images.length > 0 || data.videos.length > 0, {
    message: "Add at least 1 photo or video",
    path: ["images"],
  })
  .refine(
    (data) => {
      if (data.start_date && data.end_date) {
        return new Date(data.end_date) >= new Date(data.start_date);
      }
      return true;
    },
    { message: "End date must be on or after start date", path: ["end_date"] }
  );

/** Inferred input type for {@link promotionSchema}. */
type _PromotionInput = z.infer<typeof promotionSchema>;
