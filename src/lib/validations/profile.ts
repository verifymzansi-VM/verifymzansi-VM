import { z } from "zod";
import { saPhoneSchema } from "./shared";

/**
 * Zod schema for account profile updates.
 * Validates display name, bio, phone (SA format), province, and city.
 */
export const profileUpdateSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(50, "Display name cannot exceed 50 characters"),
  bio: z.string().trim().max(300, "Bio cannot exceed 300 characters").optional().or(z.literal("")),
  phone: z.union([saPhoneSchema, z.literal("")]).optional(),
  province: z.string().max(100, "Province value is too long").optional().or(z.literal("")),
  city: z.string().max(100, "City value is too long").optional().or(z.literal("")),
  avatarUrl: z.string().url("Invalid avatar URL").max(500).optional().or(z.literal("")),
});

/** Inferred type for profile update payloads. */
type _ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/**
 * Zod schema for settings page display name update.
 * Validates only the display name field.
 */
const _settingsDisplayNameSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(50, "Display name cannot exceed 50 characters"),
});

/** Inferred type for settings display name update. */
type _SettingsDisplayNameInput = z.infer<typeof _settingsDisplayNameSchema>;
