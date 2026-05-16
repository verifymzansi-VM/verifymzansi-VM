import { z } from "zod";
import {
  platformMediaUrlArraySchema,
  platformMediaUrlSchema,
  postLocationFields,
  postMediaMetadataFields,
  priceSchema,
  externalUrlOrEmptySchema,
} from "./shared";
import type { BusinessCategory } from "@/types/enums";

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
    ...postLocationFields,
    contact_methods: z
      .array(z.enum(["call", "whatsapp", "form"]))
      .min(1, "At least one contact method is required"),
    images: platformMediaUrlArraySchema(
      10,
      "Images must be hosted on the VerifyMzansi platform",
      "Maximum 10 images"
    ),
    videos: platformMediaUrlArraySchema(
      3,
      "Videos must be hosted on the VerifyMzansi platform",
      "Maximum 3 videos"
    )
      .optional()
      .default([]),
    video_thumbnail: platformMediaUrlSchema(
      "Video thumbnail must be hosted on the VerifyMzansi platform"
    ).optional(),
    ...postMediaMetadataFields,
    termsAccepted: z.boolean().optional().default(false),
    logo_url: platformMediaUrlSchema("Logo must be hosted on the VerifyMzansi platform").optional(),
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
        tickets_url: externalUrlOrEmptySchema("Enter a valid ticketing URL"),
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
