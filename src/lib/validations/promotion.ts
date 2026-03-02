import { z } from "zod";
import { priceSchema } from "./shared";

/**
 * Zod schema for standalone promotion / advertisement creation and editing.
 * Validates all fields required for a standalone ad that is NOT tied to a
 * listing, storefront, or business profile.
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
  price_zar: priceSchema.optional(),
  negotiable: z.boolean().default(false),
  province: z.string().min(1, "Province is required"),
  city: z.string().min(1, "City is required"),
  contact_methods: z
    .array(z.enum(["call", "whatsapp", "form"]))
    .min(1, "At least one contact method is required"),
  images: z
    .array(
      z
        .string()
        .url()
        .refine(
          (url) => {
            try {
              const parsed = new URL(url);
              return (
                parsed.hostname === "media.verifymzansi.co.za" ||
                parsed.hostname.endsWith(".r2.cloudflarestorage.com") ||
                parsed.hostname.endsWith(".supabase.co")
              );
            } catch {
              return false;
            }
          },
          { message: "Images must be hosted on the VerifyMzansi platform" }
        )
    )
    .min(1, "At least 1 image is required")
    .max(10, "Maximum 10 images"),
  videos: z.array(z.string().url()).max(3, "Maximum 3 videos").optional().default([]),
  video_thumbnail: z.string().url().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
});

/** Inferred input type for {@link promotionSchema}. */
export type PromotionInput = z.infer<typeof promotionSchema>;
