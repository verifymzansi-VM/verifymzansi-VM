import { z } from "zod";
import {
  citySchema,
  createPostTitleSchema,
  provinceSchema,
  saNumberOrEmptySchema,
  slugSchema,
  urlOrEmptySchema,
} from "./shared";

/**
 * Zod schema for creating or updating a business profile.
 * Validates name, URL-safe slug, industry, optional description/media/contact.
 */
export const businessProfileSchema = z.object({
  business_name: z
    .string()
    .min(2, "Business name must be at least 2 characters")
    .max(100, "Business name cannot exceed 100 characters"),
  slug: slugSchema,
  industry: z.string().min(1, "Industry is required").max(100),
  description: z.string().max(3000, "Description cannot exceed 3000 characters").optional(),
  logo_url: urlOrEmptySchema,
  banner_url: urlOrEmptySchema,
  website: z.string().url("Enter a valid URL").optional().or(z.literal("")),
  province: provinceSchema,
  city: citySchema,
  whatsapp: saNumberOrEmptySchema,
  email: z.string().email().optional().or(z.literal("")),
  year_established: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  cipc_registration: z.string().max(30).optional(),
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
  languages_spoken: z.string().max(200).optional(),
  load_shedding_ready: z.boolean().optional(),
  number_of_employees: z.enum(["1", "2_5", "6_10", "11_50", "51_200", "200_plus"]).optional(),
});

/** Zod schema for creating a business post (update, case study, offer, hiring). */
export const businessPostSchema = z.object({
  title: createPostTitleSchema(),
  body: z.string().max(5000, "Post cannot exceed 5000 characters").optional(),
  media_urls: z.array(z.string().url()).max(8, "Maximum 8 media items").optional(),
  post_type: z.enum(["update", "case_study", "offer", "hiring"]).default("update"),
});

/** Inferred input type for {@link businessProfileSchema}. */
type _BusinessProfileInput = z.infer<typeof businessProfileSchema>;
/** Inferred input type for {@link businessPostSchema}. */
type _BusinessPostInput = z.infer<typeof businessPostSchema>;
