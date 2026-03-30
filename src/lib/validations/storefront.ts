import { z } from "zod";

/**
 * Zod schema for creating or updating a mall storefront.
 * Validates name, slug, optional tagline/description, location, and contact.
 */
export const storefrontSchema = z.object({
  name: z
    .string()
    .min(3, "Store name must be at least 3 characters")
    .max(80, "Store name cannot exceed 80 characters"),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(60, "Slug cannot exceed 60 characters")
    .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers and hyphens"),
  tagline: z.string().max(150, "Tagline cannot exceed 150 characters").optional(),
  description: z.string().max(2000, "Description cannot exceed 2000 characters").optional(),
  logo_url: z.string().url().optional().or(z.literal("")),
  banner_url: z.string().url().optional().or(z.literal("")),
  province: z.string().min(1, "Province is required").max(50),
  city: z.string().min(1, "City is required").max(80),
  whatsapp: z
    .string()
    .regex(/^(\+27|0)[6-8][0-9]{8}$/, "Enter a valid SA number")
    .optional()
    .or(z.literal("")),
  operating_hours: z.string().max(200).optional(),
});

/** Zod schema for creating a storefront post (update, promotion, event). */
export const storefrontPostSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(120, "Title cannot exceed 120 characters"),
  body: z.string().max(3000, "Post cannot exceed 3000 characters").optional(),
  media_urls: z.array(z.string().url()).max(5, "Maximum 5 media items").optional(),
  post_type: z.enum(["update", "promotion", "event"]).default("update"),
});

/** Inferred input type for {@link storefrontSchema}. */
export type StorefrontInput = z.infer<typeof storefrontSchema>;
/** Inferred input type for {@link storefrontPostSchema}. */
export type StorefrontPostInput = z.infer<typeof storefrontPostSchema>;
