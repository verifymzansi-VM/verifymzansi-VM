import { describe, expect, it } from "vitest";
import { contactAccountHolderSchema, reportSchema } from "./contact";

// ── Contact Listing Owner Schema ────────────────────────────────────────────

describe("contactAccountHolderSchema", () => {
  const valid = {
    listingId: "550e8400-e29b-41d4-a716-446655440000",
    message: "Hello, is this still available?",
    contactMethod: "in_app" as const,
    turnstileToken: "tok",
  };

  it("accepts valid contact request", () => {
    expect(contactAccountHolderSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts whatsapp and call contact methods", () => {
    expect(
      contactAccountHolderSchema.safeParse({ ...valid, contactMethod: "whatsapp" }).success
    ).toBe(true);
    expect(contactAccountHolderSchema.safeParse({ ...valid, contactMethod: "call" }).success).toBe(
      true
    );
  });

  it('accepts canonical "form" contact method', () => {
    expect(contactAccountHolderSchema.safeParse({ ...valid, contactMethod: "form" }).success).toBe(
      true
    );
  });

  it("rejects message too short", () => {
    expect(contactAccountHolderSchema.safeParse({ ...valid, message: "Hi" }).success).toBe(false);
  });

  it("rejects message too long", () => {
    expect(
      contactAccountHolderSchema.safeParse({
        ...valid,
        message: "x".repeat(1001),
      }).success
    ).toBe(false);
  });

  it("rejects invalid UUID", () => {
    expect(
      contactAccountHolderSchema.safeParse({ ...valid, listingId: "not-a-uuid" }).success
    ).toBe(false);
  });

  it("rejects missing captcha token", () => {
    expect(contactAccountHolderSchema.safeParse({ ...valid, turnstileToken: "" }).success).toBe(
      false
    );
  });
});

// ── Report Schema ───────────────────────────────────────────────────────────

describe("reportSchema", () => {
  const valid = {
    targetType: "listing" as const,
    targetId: "550e8400-e29b-41d4-a716-446655440000",
    reason: "scam" as const,
    description: "This listing is a scam because reasons",
    turnstileToken: "tok",
  };

  it("accepts valid report", () => {
    expect(reportSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts the supported target types", () => {
    for (const t of ["listing", "storefront", "business", "account_profile"]) {
      expect(reportSchema.safeParse({ ...valid, targetType: t }).success).toBe(true);
    }
  });

  it("accepts canonical profile target types", () => {
    expect(reportSchema.safeParse({ ...valid, targetType: "account_profile" }).success).toBe(true);
    expect(reportSchema.safeParse({ ...valid, targetType: "business_profile" }).success).toBe(true);
  });

  it("accepts all reason codes", () => {
    for (const r of [
      "scam",
      "fake_listing",
      "prohibited_item",
      "harassment",
      "impersonation",
      "spam",
      "other",
    ]) {
      expect(reportSchema.safeParse({ ...valid, reason: r }).success).toBe(true);
    }
  });

  it("rejects description too short", () => {
    expect(reportSchema.safeParse({ ...valid, description: "short" }).success).toBe(false);
  });

  it("accepts optional evidence URLs", () => {
    const result = reportSchema.safeParse({
      ...valid,
      evidenceUrls: ["https://example.com/evidence1.png", "https://example.com/evidence2.png"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects too many evidence URLs", () => {
    const result = reportSchema.safeParse({
      ...valid,
      evidenceUrls: Array(6).fill("https://example.com/ev.png"),
    });
    expect(result.success).toBe(false);
  });
});
