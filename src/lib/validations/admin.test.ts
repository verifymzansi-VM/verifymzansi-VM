import { describe, it, expect } from "vitest";
import {
  adminContentDecideSchema,
  adminVerificationDecideSchema,
  adminFlaggingActionSchema,
  adminDsarDecideSchema,
} from "./admin";

describe("adminContentDecideSchema", () => {
  it("accepts valid approve", () => {
    const result = adminContentDecideSchema.safeParse({
      itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      area: "MZANSI_MARKET",
      decision: "approve",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid reject with reason", () => {
    const result = adminContentDecideSchema.safeParse({
      itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      area: "MALL_SHOPS",
      decision: "reject",
      reason: "Inappropriate content",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid area", () => {
    const result = adminContentDecideSchema.safeParse({
      itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      area: "INVALID",
      decision: "approve",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID itemId", () => {
    const result = adminContentDecideSchema.safeParse({
      itemId: "not-a-uuid",
      area: "MZANSI_MARKET",
      decision: "approve",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid decision", () => {
    const result = adminContentDecideSchema.safeParse({
      itemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      area: "MZANSI_MARKET",
      decision: "maybe",
    });
    expect(result.success).toBe(false);
  });
});

describe("adminVerificationDecideSchema", () => {
  it("accepts approved without reason", () => {
    const result = adminVerificationDecideSchema.safeParse({
      stepId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      decision: "approved",
    });
    expect(result.success).toBe(true);
  });

  it("accepts rejected with reason", () => {
    const result = adminVerificationDecideSchema.safeParse({
      stepId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      decision: "rejected",
      reasonCode: "blurry_image",
      reasonNote: "Photo too blurry to read",
    });
    expect(result.success).toBe(true);
  });

  it("rejects rejected without reasonCode", () => {
    const result = adminVerificationDecideSchema.safeParse({
      stepId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      decision: "rejected",
    });
    expect(result.success).toBe(false);
  });

  it("rejects needs_resubmission without reasonCode", () => {
    const result = adminVerificationDecideSchema.safeParse({
      stepId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      decision: "needs_resubmission",
    });
    expect(result.success).toBe(false);
  });

  it("accepts legacy 'resubmit' and normalizes to 'needs_resubmission'", () => {
    const result = adminVerificationDecideSchema.safeParse({
      stepId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      decision: "resubmit",
      reasonCode: "blurry_image",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decision).toBe("needs_resubmission");
    }
  });

  it("rejects legacy 'resubmit' without reasonCode", () => {
    const result = adminVerificationDecideSchema.safeParse({
      stepId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      decision: "resubmit",
    });
    expect(result.success).toBe(false);
  });
});

describe("adminFlaggingActionSchema", () => {
  it("accepts warn action", () => {
    const result = adminFlaggingActionSchema.safeParse({
      reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      action: "warn",
    });
    expect(result.success).toBe(true);
  });

  it("accepts suspend with duration", () => {
    const result = adminFlaggingActionSchema.safeParse({
      reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      action: "suspend",
      durationDays: 7,
    });
    expect(result.success).toBe(true);
  });

  it("rejects dismiss without reason", () => {
    const result = adminFlaggingActionSchema.safeParse({
      reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      action: "dismiss",
    });
    expect(result.success).toBe(false);
  });

  it("accepts dismiss with reason", () => {
    const result = adminFlaggingActionSchema.safeParse({
      reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      action: "dismiss",
      reason: "Duplicate report",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid action", () => {
    const result = adminFlaggingActionSchema.safeParse({
      reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      action: "nuke",
    });
    expect(result.success).toBe(false);
  });

  it("rejects durationDays > 365", () => {
    const result = adminFlaggingActionSchema.safeParse({
      reportId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      action: "suspend",
      durationDays: 500,
    });
    expect(result.success).toBe(false);
  });
});

describe("adminDsarDecideSchema", () => {
  it("accepts valid approve", () => {
    const result = adminDsarDecideSchema.safeParse({
      requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      decision: "approve",
    });
    expect(result.success).toBe(true);
  });

  it("accepts reject with notes", () => {
    const result = adminDsarDecideSchema.safeParse({
      requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      decision: "reject",
      notes: "Request not from data subject",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing requestId", () => {
    const result = adminDsarDecideSchema.safeParse({
      decision: "approve",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid decision", () => {
    const result = adminDsarDecideSchema.safeParse({
      requestId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      decision: "ignore",
    });
    expect(result.success).toBe(false);
  });
});
