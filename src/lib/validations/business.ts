import { z } from "zod";

/**
 * Zod schema for creating or updating a business profile.
 * Validates name, URL-safe slug, industry, optional description/media/contact.
 */
export const businessProfileSchema = z.object({
  business_name: z
    .string()
    .min(2, "Business name must be at least 2 characters")
    .max(100, "Business name cannot exceed 100 characters"),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(60, "Slug cannot exceed 60 characters")
    .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers and hyphens"),
  industry: z.string().min(1, "Industry is required"),
  description: z.string().max(3000, "Description cannot exceed 3000 characters").optional(),
  logo_url: z.string().url().optional().or(z.literal("")),
  banner_url: z.string().url().optional().or(z.literal("")),
  website: z.string().url("Enter a valid URL").optional().or(z.literal("")),
  province: z.string().min(1, "Province is required"),
  city: z.string().min(1, "City is required"),
  whatsapp: z
    .string()
    .regex(/^(\+27|0)[6-8][0-9]{8}$/, "Enter a valid SA number")
    .optional()
    .or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
});

/** Zod schema for creating a business post (update, case study, offer, hiring). */
export const businessPostSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(120, "Title cannot exceed 120 characters"),
  body: z.string().max(5000, "Post cannot exceed 5000 characters").optional(),
  media_urls: z.array(z.string().url()).max(8, "Maximum 8 media items").optional(),
  post_type: z.enum(["update", "case_study", "offer", "hiring"]).default("update"),
});

/** Inferred input type for {@link businessProfileSchema}. */
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;
/** Inferred input type for {@link businessPostSchema}. */
export type BusinessPostInput = z.infer<typeof businessPostSchema>;
