import { z } from "zod";
import { saPhoneSchema } from "./shared";

/**
 * Names a person could mistake for the platform or its staff. Checked by the
 * update route only when the name changes, so an existing name never blocks
 * saving other profile fields.
 */
export function isReservedDisplayName(name: string): boolean {
  return RESERVED_NAME.test(name);
}

const RESERVED_NAME = /verify\s*mzansi|\b(admin|administrator|moderator|support|staff|official)\b/i;

/** Same letters-only rule as sign-up (plus "." for initials and accents). */
function displayNameSchema() {
  return z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(50, "Display name cannot exceed 50 characters")
    .regex(/^[\p{L}\p{M}\s'.-]+$/u, "Use letters only in your name");
}

/**
 * Zod schema for account profile updates.
 * Validates display name, bio, phone (SA format), province, and city.
 */
export const profileUpdateSchema = z.object({
  displayName: displayNameSchema(),
  bio: z.string().trim().max(300, "Bio cannot exceed 300 characters").optional().or(z.literal("")),
  phone: z.union([saPhoneSchema, z.literal("")]).optional(),
  province: z.string().max(100, "Province value is too long").optional().or(z.literal("")),
  city: z.string().max(100, "City value is too long").optional().or(z.literal("")),
  avatarUrl: z
    .string()
    .url("Invalid avatar URL")
    .max(500)
    .refine(isOwnAvatarStorageUrl, "Upload your avatar through the profile page")
    .optional()
    .or(z.literal("")),
});

/** Avatars are only ever served from this project's Supabase avatars bucket. */
function isOwnAvatarStorageUrl(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  return Boolean(supabaseUrl) && url.startsWith(`${supabaseUrl}/storage/v1/object/public/avatars/`);
}

/** Inferred type for profile update payloads. */
type _ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/**
 * Zod schema for settings page display name update.
 * Validates only the display name field.
 */
const _settingsDisplayNameSchema = z.object({
  displayName: displayNameSchema(),
});

/** Inferred type for settings display name update. */
type _SettingsDisplayNameInput = z.infer<typeof _settingsDisplayNameSchema>;
