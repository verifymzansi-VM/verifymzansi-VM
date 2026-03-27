import { z } from "zod";
import { emailSchema, passwordSchema, saPhoneSchema, turnstileTokenSchema } from "./shared";

/** Zod schema for the login form (email + password + Turnstile token). */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
  turnstileToken: turnstileTokenSchema,
});

/**
 * Zod schema for the registration form.
 * Validates display name, email, SA phone, strong password with confirmation,
 * Turnstile token, and terms acceptance.
 */
export const registerSchema = z
  .object({
    firstName: z
      .string()
      .min(2, "Name must be at least 2 characters")
      .max(50, "Name is too long")
      .regex(/^[\p{L}\s'-]+$/u, "Name contains invalid characters"),
    lastName: z
      .string()
      .min(2, "Surname must be at least 2 characters")
      .max(50, "Surname is too long")
      .regex(/^[\p{L}\s'-]+$/u, "Surname contains invalid characters"),
    email: emailSchema,
    phone: saPhoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      message: "You must accept the terms of service",
    }),
    turnstileToken: turnstileTokenSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/** Zod schema for the forgot-password form (email + Turnstile token). */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
  turnstileToken: turnstileTokenSchema,
});

/** Zod schema for resetting a password (new password + confirmation). */
export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/** Zod schema for OTP verification (SA phone + 6-digit code). */
export const otpVerifySchema = z.object({
  phone: saPhoneSchema,
  otp: z
    .string()
    .length(6, "OTP must be 6 digits")
    .regex(/^\d{6}$/, "OTP must be numeric"),
});

/** Zod schema for changing password (current + new + confirmation). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
  });

/** Zod schema for initiating Google OAuth via the backend route. */
export const googleOAuthInitSchema = z.object({
  returnUrl: z.string().max(2048, "Return URL is too long").nullable().optional(),
});

/** Inferred input type for {@link loginSchema}. */
export type LoginInput = z.infer<typeof loginSchema>;
/** Inferred input type for {@link registerSchema}. */
export type RegisterInput = z.infer<typeof registerSchema>;
/** Inferred input type for {@link forgotPasswordSchema}. */
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
/** Inferred input type for {@link resetPasswordSchema}. */
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
/** Inferred input type for {@link otpVerifySchema}. */
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
/** Inferred input type for {@link changePasswordSchema}. */
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
/** Inferred input type for {@link googleOAuthInitSchema}. */
export type GoogleOAuthInitInput = z.infer<typeof googleOAuthInitSchema>;
