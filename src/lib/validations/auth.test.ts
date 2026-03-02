import { describe, expect, it } from "vitest";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  otpVerifySchema,
} from "./auth";

// ── Login Schema ────────────────────────────────────────────────────────────

describe("loginSchema", () => {
  const valid = {
    email: "user@example.com",
    password: "password123",
    turnstileToken: "token",
  };

  it("accepts valid input", () => {
    expect(loginSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing email", () => {
    expect(loginSchema.safeParse({ ...valid, email: "" }).success).toBe(false);
  });

  it("rejects missing password", () => {
    expect(loginSchema.safeParse({ ...valid, password: "" }).success).toBe(false);
  });

  it("rejects missing turnstile token", () => {
    expect(loginSchema.safeParse({ ...valid, turnstileToken: "" }).success).toBe(false);
  });
});

// ── Register Schema ─────────────────────────────────────────────────────────

describe("registerSchema", () => {
  const valid = {
    displayName: "Jane Doe",
    email: "jane@example.com",
    phone: "+27812345678",
    password: "Str0ngPass",
    confirmPassword: "Str0ngPass",
    acceptTerms: true as const,
    turnstileToken: "tok",
  };

  it("accepts valid registration", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects password mismatch", () => {
    const result = registerSchema.safeParse({
      ...valid,
      confirmPassword: "Different1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short display name", () => {
    expect(registerSchema.safeParse({ ...valid, displayName: "J" }).success).toBe(false);
  });

  it("rejects display name with numbers", () => {
    expect(registerSchema.safeParse({ ...valid, displayName: "Jane123" }).success).toBe(false);
  });

  it("rejects invalid phone", () => {
    expect(registerSchema.safeParse({ ...valid, phone: "12345" }).success).toBe(false);
  });

  it("rejects without accepting terms", () => {
    const result = registerSchema.safeParse({ ...valid, acceptTerms: false });
    expect(result.success).toBe(false);
  });
});

// ── Forgot Password Schema ─────────────────────────────────────────────────

describe("forgotPasswordSchema", () => {
  it("accepts valid input", () => {
    expect(
      forgotPasswordSchema.safeParse({
        email: "user@test.com",
        turnstileToken: "tok",
      }).success
    ).toBe(true);
  });

  it("rejects invalid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "bad", turnstileToken: "tok" }).success).toBe(
      false
    );
  });
});

// ── Reset Password Schema ───────────────────────────────────────────────────

describe("resetPasswordSchema", () => {
  it("accepts valid matching passwords", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: "NewPass1x",
        confirmPassword: "NewPass1x",
      }).success
    ).toBe(true);
  });

  it("rejects mismatch", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: "NewPass1x",
        confirmPassword: "Other1xxx",
      }).success
    ).toBe(false);
  });
});

// ── OTP Verify Schema ──────────────────────────────────────────────────────

describe("otpVerifySchema", () => {
  it("accepts valid phone + OTP", () => {
    expect(otpVerifySchema.safeParse({ phone: "+27812345678", otp: "123456" }).success).toBe(true);
  });

  it("rejects invalid OTP", () => {
    expect(otpVerifySchema.safeParse({ phone: "+27812345678", otp: "12345" }).success).toBe(false);
  });

  it("rejects invalid phone", () => {
    expect(otpVerifySchema.safeParse({ phone: "wrong", otp: "123456" }).success).toBe(false);
  });
});
