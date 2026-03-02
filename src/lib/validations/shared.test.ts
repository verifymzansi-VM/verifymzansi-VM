import { describe, expect, it } from "vitest";
import {
  saPhoneSchema,
  saIdSchema,
  emailSchema,
  passwordSchema,
  otpSchema,
  priceSchema,
  turnstileTokenSchema,
} from "./shared";

// ── SA Phone Schema ─────────────────────────────────────────────────────────

describe("saPhoneSchema", () => {
  it("accepts valid +27 numbers", () => {
    expect(saPhoneSchema.safeParse("+27812345678").success).toBe(true);
    expect(saPhoneSchema.safeParse("+27612345678").success).toBe(true);
    expect(saPhoneSchema.safeParse("+27712345678").success).toBe(true);
  });

  it("accepts valid 0-prefix numbers", () => {
    expect(saPhoneSchema.safeParse("0812345678").success).toBe(true);
    expect(saPhoneSchema.safeParse("0612345678").success).toBe(true);
  });

  it("rejects invalid numbers", () => {
    expect(saPhoneSchema.safeParse("12345").success).toBe(false);
    expect(saPhoneSchema.safeParse("+1234567890").success).toBe(false);
    expect(saPhoneSchema.safeParse("+27512345678").success).toBe(false); // 5 isn't valid prefix
    expect(saPhoneSchema.safeParse("").success).toBe(false);
  });
});

// ── SA ID Schema ────────────────────────────────────────────────────────────

describe("saIdSchema", () => {
  it("accepts a valid 13-digit SA ID (Luhn check)", () => {
    // A known valid SA ID format that passes Luhn
    const result = saIdSchema.safeParse("8001015009087");
    expect(result.success).toBe(true);
  });

  it("rejects invalid length", () => {
    expect(saIdSchema.safeParse("12345").success).toBe(false);
    expect(saIdSchema.safeParse("12345678901234").success).toBe(false);
  });

  it("rejects non-numeric", () => {
    expect(saIdSchema.safeParse("800101500908A").success).toBe(false);
  });

  it("rejects ID failing Luhn check", () => {
    // 1234567890123 is 13 digits but fails Luhn validation
    expect(saIdSchema.safeParse("1234567890123").success).toBe(false);
  });
});

// ── Email Schema ────────────────────────────────────────────────────────────

describe("emailSchema", () => {
  it("accepts valid emails", () => {
    expect(emailSchema.safeParse("user@example.com").success).toBe(true);
    expect(emailSchema.safeParse("a@b.co.za").success).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(emailSchema.safeParse("").success).toBe(false);
  });

  it("rejects emails that are too long", () => {
    const longEmail = "a".repeat(250) + "@x.co";
    expect(emailSchema.safeParse(longEmail).success).toBe(false);
  });
});

// ── Password Schema ─────────────────────────────────────────────────────────

describe("passwordSchema", () => {
  it("accepts a strong password", () => {
    expect(passwordSchema.safeParse("Str0ngPass").success).toBe(true);
  });

  it("rejects short passwords", () => {
    expect(passwordSchema.safeParse("Ab1").success).toBe(false);
  });

  it("rejects passwords missing uppercase", () => {
    expect(passwordSchema.safeParse("alllower1").success).toBe(false);
  });

  it("rejects passwords missing lowercase", () => {
    expect(passwordSchema.safeParse("ALLUPPER1").success).toBe(false);
  });

  it("rejects passwords missing a digit", () => {
    expect(passwordSchema.safeParse("NoDigitsHere").success).toBe(false);
  });

  it("rejects passwords exceeding max length", () => {
    const longPw = "Aa1" + "x".repeat(126);
    expect(passwordSchema.safeParse(longPw).success).toBe(false);
  });
});

// ── OTP Schema ──────────────────────────────────────────────────────────────

describe("otpSchema", () => {
  it("accepts 6-digit OTP", () => {
    expect(otpSchema.safeParse("123456").success).toBe(true);
    expect(otpSchema.safeParse("000000").success).toBe(true);
  });

  it("rejects non-6-digit or non-numeric", () => {
    expect(otpSchema.safeParse("12345").success).toBe(false);
    expect(otpSchema.safeParse("1234567").success).toBe(false);
    expect(otpSchema.safeParse("abcdef").success).toBe(false);
    expect(otpSchema.safeParse("12345a").success).toBe(false);
  });
});

// ── Price Schema ────────────────────────────────────────────────────────────

describe("priceSchema", () => {
  it("accepts valid prices", () => {
    expect(priceSchema.safeParse(0).success).toBe(true);
    expect(priceSchema.safeParse(100.5).success).toBe(true);
    expect(priceSchema.safeParse(99999999).success).toBe(true);
  });

  it("rejects negative prices", () => {
    expect(priceSchema.safeParse(-1).success).toBe(false);
  });

  it("rejects prices exceeding maximum", () => {
    expect(priceSchema.safeParse(100000000).success).toBe(false);
  });

  it("rejects prices with more than 2 decimal places", () => {
    expect(priceSchema.safeParse(10.999).success).toBe(false);
  });
});

// ── Turnstile Token Schema ──────────────────────────────────────────────────

describe("turnstileTokenSchema", () => {
  it("accepts a non-empty string", () => {
    expect(turnstileTokenSchema.safeParse("some-token").success).toBe(true);
  });

  it("rejects empty string", () => {
    expect(turnstileTokenSchema.safeParse("").success).toBe(false);
  });
});
