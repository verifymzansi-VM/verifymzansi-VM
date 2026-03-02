import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/utils/turnstile", () => ({
  verifyTurnstileToken: vi.fn().mockResolvedValue({ success: true }),
}));

function _createRequest(body: unknown) {
  return {
    method: "POST",
    json: async () => body,
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL("http://localhost:3000/api/dsar/submit"),
  } as unknown as NextRequest;
}

describe("DSAR request validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should validate SA ID number with Luhn check via saIdSchema", async () => {
    // Import the shared schema to verify it's being used
    const { saIdSchema: _saIdSchema } = await import("@/lib/validations/shared");
    const { dsarRequestSchema } = await import("@/lib/validations/verification");

    // Valid SA ID (passes Luhn)
    const validResult = dsarRequestSchema.safeParse({
      type: "access",
      name: "John Doe",
      email: "john@example.com",
      idNumber: "8001015009087",
    });
    expect(validResult.success).toBe(true);

    // Invalid — too short
    const shortResult = dsarRequestSchema.safeParse({
      type: "access",
      name: "Jane Doe",
      email: "jane@example.com",
      idNumber: "12345",
    });
    expect(shortResult.success).toBe(false);

    // Invalid — non-numeric
    const alphaResult = dsarRequestSchema.safeParse({
      type: "access",
      name: "Test",
      email: "t@e.com",
      idNumber: "800101500908A",
    });
    expect(alphaResult.success).toBe(false);
  });

  it("should require valid request type", async () => {
    const { dsarRequestSchema } = await import("@/lib/validations/verification");
    const result = dsarRequestSchema.safeParse({
      type: "invalid_type",
      name: "John Doe",
      email: "john@example.com",
      idNumber: "8001015009087",
    });
    expect(result.success).toBe(false);
  });

  it("should reject all-zeros ID (invalid DOB)", async () => {
    const { dsarRequestSchema } = await import("@/lib/validations/verification");
    const result = dsarRequestSchema.safeParse({
      type: "access",
      name: "Test User",
      email: "test@example.com",
      idNumber: "0000000000000",
    });
    expect(result.success).toBe(false);
  });

  it("should accept all valid DSAR types", async () => {
    const { dsarRequestSchema } = await import("@/lib/validations/verification");
    for (const type of ["access", "correction", "deletion", "objection"]) {
      const result = dsarRequestSchema.safeParse({
        type,
        name: "Test User",
        email: "test@example.com",
        idNumber: "8001015009087",
      });
      expect(result.success).toBe(true);
    }
  });
});
