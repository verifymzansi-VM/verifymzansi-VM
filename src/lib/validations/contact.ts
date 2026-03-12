import { z } from "zod";

/** Zod schema for contacting a listing or promotion owner. */
export const contactAccountHolderSchema = z
  .object({
    listingId: z.string().uuid("Invalid listing").optional(),
    promotionId: z.string().uuid("Invalid promotion").optional(),
    message: z
      .string()
      .min(5, "Message must be at least 5 characters")
      .max(1000, "Message cannot exceed 1000 characters"),
    contactMethod: z.enum(["call", "whatsapp", "form", "in_app"]).default("form"),
    turnstileToken: z.string().min(1, "Complete the CAPTCHA"),
  })
  .refine((value) => value.listingId || value.promotionId, {
    message: "A valid listing or promotion is required",
    path: ["listingId"],
  })
  .transform((value) => ({
    targetId: value.promotionId ?? value.listingId!,
    targetType: (value.promotionId ? "promotion" : "listing") as "listing" | "promotion",
    message: value.message,
    contactMethod: value.contactMethod,
    turnstileToken: value.turnstileToken,
  }));

/**
 * Zod schema for reporting a listing, account profile, storefront, or business.
 * Requires a reason enum, a description, optional evidence URLs, and a Turnstile token.
 */
export const reportSchema = z.object({
  targetType: z.enum([
    "listing",
    "business",
    "promotion",
    "account_profile",
    "storefront",
    "business_profile",
  ]),
  targetId: z.string().uuid("Invalid target"),
  reason: z.enum([
    "scam",
    "misleading",
    "expired",
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

/** Inferred input type for {@link contactAccountHolderSchema}. */
export type ContactAccountHolderInput = z.infer<typeof contactAccountHolderSchema>;
/** Inferred input type for {@link reportSchema}. */
export type ReportInput = z.infer<typeof reportSchema>;
