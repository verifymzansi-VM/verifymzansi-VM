import { z } from "zod";

/** Zod schema for the contact-seller form (message, method, Turnstile token). */
export const contactSellerSchema = z.object({
  listingId: z.string().uuid("Invalid listing"),
  message: z
    .string()
    .min(5, "Message must be at least 5 characters")
    .max(1000, "Message cannot exceed 1000 characters"),
  contactMethod: z.enum(["call", "whatsapp", "form", "in_app"]).default("form"),
  turnstileToken: z.string().min(1, "Complete the CAPTCHA"),
});

/**
 * Zod schema for reporting a listing, seller, storefront, or business.
 * Requires a reason enum, a description, optional evidence URLs, and a Turnstile token.
 */
export const reportSchema = z.object({
  targetType: z.enum([
    "listing",
    "business",
    "promotion",
    "seller",
    "storefront",
    "seller_profile",
    "business_profile",
  ]),
  targetId: z.string().uuid("Invalid target"),
  reason: z.enum([
    "scam",
    "fake_listing",
    "prohibited_item",
    "harassment",
    "impersonation",
    "spam",
    "other",
  ]),
  description: z
    .string()
    .min(10, "Please describe the issue in at least 10 characters")
    .max(2000, "Description cannot exceed 2000 characters"),
  evidenceUrls: z.array(z.string().url()).max(5, "Maximum 5 evidence files").optional(),
  turnstileToken: z.string().min(1, "Complete the CAPTCHA"),
});

/** Inferred input type for {@link contactSellerSchema}. */
export type ContactSellerInput = z.infer<typeof contactSellerSchema>;
/** Inferred input type for {@link reportSchema}. */
export type ReportInput = z.infer<typeof reportSchema>;
