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
  "general_other",
] as const satisfies readonly BusinessCategory[];

/**
 * Zod schema for standalone promotion / advertisement creation and editing.
 * Validates all fields required for a standalone ad that is NOT tied to a
 * listing, storefront, or business profile.
 * Optionally links to a Mzansi Business via business_id.
 */
export const promotionSchema = z.object({
  title: z
    .string()
    .min(5, "Title must be at least 5 characters")
    .max(120, "Title cannot exceed 120 characters"),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters")
    .max(5000, "Description cannot exceed 5000 characters"),
  promotion_type: z.enum(["product", "service", "event", "deal", "general"]),
  category: z.string().max(100).optional(),
  category_key: z.enum(BUSINESS_CATEGORY_VALUES).optional(),
  price_zar: priceSchema.optional(),
  negotiable: z.boolean().default(false),
  province: z.string().min(1, "Province is required"),
  city: z.string().min(1, "City is required"),
  contact_methods: z
    .array(z.enum(["call", "whatsapp", "form"]))
    .min(1, "At least one contact method is required"),
  images: z
    .array(
      z.string().url().refine(isTrustedPlatformMediaUrl, {
        message: "Images must be hosted on the VerifyMzansi platform",
      })
    )
    .min(1, "At least 1 image is required")
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
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  business_id: z.string().uuid().optional(),
});

/** Inferred input type for {@link promotionSchema}. */
export type PromotionInput = z.infer<typeof promotionSchema>;
