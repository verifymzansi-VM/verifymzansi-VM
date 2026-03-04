import { z } from "zod";
import { validateSaIdFull } from "@/lib/utils/sa-id-validation";

// ── Phone (SA) ──────────────────────────────────────────────

/** Zod schema for a South African mobile number (`+27` or `0` prefix, 10 digits). */
export const saPhoneSchema = z
  .string()
  .min(10, "Phone number is required")
  .regex(/^(\+27|0)[6-8][0-9]{8}$/, "Enter a valid SA mobile number (e.g. 071 234 5678)");

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
 * Requires 8–128 chars with at least one lowercase, one uppercase, and one digit.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .regex(/[a-z]/, "Must contain a lowercase letter")
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/[0-9]/, "Must contain a number");

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
export const turnstileTokenSchema = z.string().min(1, "Complete the CAPTCHA");
