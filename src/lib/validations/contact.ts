import { z } from "zod";
import { saPhoneSchema } from "./shared";

/** Zod schema for contacting a listing or promotion owner. */
export const contactAccountHolderSchema = z
  .object({
    listingId: z.string().uuid("Invalid listing").optional(),
    businessId: z.string().uuid("Invalid business").optional(),
    promotionId: z.string().uuid("Invalid promotion").optional(),
    buyerName: z.string().trim().min(2).max(80).optional(),
    buyerEmail: z.string().trim().email().max(254).optional(),
    buyerPhone: saPhoneSchema.optional(),
    message: z
      .string()
      .trim()
      .min(10, "Message must be at least 10 characters")
      .max(1000, "Message cannot exceed 1000 characters"),
    contactMethod: z.enum(["call", "whatsapp", "form", "in_app"]).default("form"),
    turnstileToken: z.string().min(1, "Complete the CAPTCHA"),
  })
  .refine(
    (value) => [value.listingId, value.promotionId, value.businessId].filter(Boolean).length === 1,
    {
      message: "Exactly one listing, promotion or business is required",
      path: ["listingId"],
    }
  )
  .transform((value) => ({
    targetId: value.businessId ?? value.promotionId ?? value.listingId!,
    targetType: (value.businessId ? "business" : value.promotionId ? "promotion" : "listing") as
      | "listing"
      | "promotion"
      | "business",
    message: value.message,
    buyerName: value.buyerName,
    buyerEmail: value.buyerEmail,
    buyerPhone: value.buyerPhone,
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
  evidenceUrls: z
    .array(
      z
        .string()
        .url()
        .refine((u) => /^https?:\/\//i.test(u), "Only http/https URLs are allowed")
    )
    .max(5, "Maximum 5 evidence files")
    .optional(),
  turnstileToken: z.string().min(1, "Complete the CAPTCHA"),
});

/** Inferred input type for {@link contactAccountHolderSchema}. */
type _ContactAccountHolderInput = z.infer<typeof contactAccountHolderSchema>;
/** Inferred input type for {@link reportSchema}. */
type _ReportInput = z.infer<typeof reportSchema>;
