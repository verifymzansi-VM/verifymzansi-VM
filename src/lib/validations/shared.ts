import { z } from "zod";
import { validateSaIdFull } from "@/lib/utils/sa-id-validation";
import { sanitizeSaPhoneInput } from "@/lib/utils/phone";
import { isTrustedPlatformMediaUrl } from "@/lib/utils/media-url";
import { isValidUserEnteredUrl, normalizeUserEnteredUrlInput } from "@/lib/utils/external-url";

function trimStringInput(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function trimToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ── Phone (SA) ──────────────────────────────────────────────

/** Zod schema for a South African mobile number (`+27` or `0` prefix, 10 digits). */
export const saPhoneSchema = z.preprocess(
  (value) => (typeof value === "string" ? sanitizeSaPhoneInput(value) : value),
  z
    .string()
    .min(10, "Phone number is required")
    .regex(/^(\+27|0)[6-8][0-9]{8}$/, "Enter a valid SA mobile number (e.g. 071 234 5678)")
);

// ── SA ID validation (full: Luhn + DOB + structure) ─────────

/**
 * Zod schema for a South African 13-digit ID number.
 * Validates length, digit-only content, Luhn checksum, and embedded DOB.
 */
export const saIdSchema = z
  .string()
  .length(13, "SA ID number must be 13 digits")
  .regex(/^\d{13}$/, "SA ID number must contain only digits")
  .superRefine((id, ctx) => {
    const result = validateSaIdFull(id);
    if (!result.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: result.errors[0] || "Invalid SA ID number",
      });
    }
  });

// ── Email ───────────────────────────────────────────────────

/** Zod schema for a valid email address (max 254 characters per RFC 5321). */
export const emailSchema = z
  .string()
  .email("Enter a valid email address")
  .max(254, "Email is too long");

// ── Password ────────────────────────────────────────────────

/**
 * Zod schema for a strong password.
 * Accepts 8–128 characters without composition rules; server routes check breached passwords.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long");

// ── OTP ─────────────────────────────────────────────────────

/** Zod schema for a 6-digit one-time password. */
export const otpSchema = z
  .string()
  .length(6, "OTP must be 6 digits")
  .regex(/^\d{6}$/, "OTP must be numeric");

// ── Price (ZAR) ─────────────────────────────────────────────

/** Zod schema for a ZAR price (0–99 999 999, max 2 decimal places). */
export const priceSchema = z
  .number()
  .min(0, "Price cannot be negative")
  .max(99_999_999, "Price exceeds maximum")
  .refine(
    (v) => Number.isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 0.001,
    "Price can have at most 2 decimal places"
  );

// ── Turnstile token ─────────────────────────────────────────

/** Zod schema for a non-empty Cloudflare Turnstile CAPTCHA token. */
export const turnstileTokenSchema = z.string().min(1, "Complete the CAPTCHA").max(4096);

/** Zod schema for a trimmed Cloudflare Turnstile token without the generic 500-char cap. */
export const trimmedTurnstileTokenSchema = z.preprocess(trimStringInput, turnstileTokenSchema);

// ── Shared ingress helpers ──────────────────────────────────

/** Zod schema for a UUID string used in route params and query params. */
export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Enter a valid ID");

/** Zod schema for a required trimmed string. */
export const trimmedStringSchema = z.preprocess(
  trimStringInput,
  z.string().min(1, "This field is required").max(500)
);

/** Zod schema for an optional trimmed string that treats blank input as absent. */
export const optionalTrimmedStringSchema = z.preprocess(
  trimToUndefined,
  z.string().min(1).max(500).optional()
);

/** Zod schema for an optional UUID string that treats blank input as absent. */
export const optionalUuidSchema = z.preprocess(trimToUndefined, uuidSchema.optional());

export function externalUrlOrEmptySchema(message = "Enter a valid URL", max = 2000) {
  return z.preprocess(
    normalizeUserEnteredUrlInput,
    z
      .string()
      .url(message)
      .max(max)
      .refine(isValidUserEnteredUrl, message)
      .optional()
      .or(z.literal(""))
  );
}

export function externalUrlSchema(message = "Enter a valid URL", max = 2000) {
  return z.preprocess(
    normalizeUserEnteredUrlInput,
    z.string().url(message).max(max).refine(isValidUserEnteredUrl, message)
  );
}

const provinceSchema = z.string().min(1, "Province is required").max(50);

const citySchema = z.string().min(1, "City is required").max(80);

export const platformMediaUrlSchema = (
  message = "Media must be hosted on the VerifyMzansi platform"
) => z.string().url().refine(isTrustedPlatformMediaUrl, { message });

export const platformMediaUrlArraySchema = (
  max: number,
  message = "Media must be hosted on the VerifyMzansi platform",
  maxMessage?: string
) => z.array(platformMediaUrlSchema(message)).max(max, maxMessage);

export const postLocationFields = {
  province: provinceSchema,
  city: citySchema,
  location_town: z.string().trim().min(1).max(120).optional(),
  location_address: z.string().trim().min(1).max(300).optional(),
};

export const postMediaMetadataFields = {
  media_width: z.number().int().positive().max(20_000).optional(),
  media_height: z.number().int().positive().max(20_000).optional(),
  focal_x: z.number().min(0).max(1).optional(),
  focal_y: z.number().min(0).max(1).optional(),
};

/**
 * Create a bounded integer schema for query params or form fields.
 * Missing values resolve to the supplied default.
 */
export function createBoundedIntegerSchema(options: {
  defaultValue: number;
  min: number;
  max: number;
  fieldName: string;
}) {
  const { defaultValue, min, max, fieldName } = options;

  return z.preprocess(
    (value) => {
      if (value === undefined || value === null) {
        return defaultValue;
      }

      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
          return defaultValue;
        }

        if (!/^-?\d+$/.test(trimmed)) {
          return Number.NaN;
        }

        return Number.parseInt(trimmed, 10);
      }

      return value;
    },
    z
      .number({ error: `${fieldName} must be a number` })
      .int(`${fieldName} must be a whole number`)
      .min(min, `${fieldName} must be at least ${min}`)
      .max(max, `${fieldName} must be at most ${max}`)
  );
}

/**
 * Create a non-negative number schema for query params or form fields.
 * Missing values resolve to undefined.
 */
export function createNonNegativeNumberSchema(fieldName: string) {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === null) {
        return undefined;
      }

      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
          return undefined;
        }

        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : Number.NaN;
      }

      return value;
    },
    z
      .number({ error: `${fieldName} must be a number` })
      .min(0, `${fieldName} cannot be negative`)
      .optional()
  );
}

/**
 * Create a boolean schema for query params or form fields.
 * Missing values resolve to the supplied default.
 */

export function createBooleanFlagSchema(defaultValue = false) {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === null) {
        return defaultValue;
      }

      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
          return defaultValue;
        }
        if (normalized === "true") {
          return true;
        }
        if (normalized === "false") {
          return false;
        }
        return value;
      }

      return value;
    },
    z.boolean({ error: "Expected true or false" })
  );
}

/**
 * Text-direction overrides/isolates and control characters (except newline,
 * carriage return and tab). They can make a title display a fake price or
 * number ("R1 000" shown for "R100 0"), so posts reject them.
 */
const SPOOFING_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x7f],
  [0x202a, 0x202e], // embeddings and overrides
  [0x2066, 0x2069], // isolates
  [0xfeff, 0xfeff], // zero-width no-break space
];

export function hasSpoofingChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (SPOOFING_RANGES.some(([from, to]) => code >= from && code <= to)) return true;
  }
  return false;
}

export const NO_HIDDEN_CHARS_MESSAGE = "Remove hidden formatting characters from this text";
