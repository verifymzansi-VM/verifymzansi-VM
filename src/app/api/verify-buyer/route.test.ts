import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const { mockFrom, mockCreateAdminClient } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockCreateAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

import { POST } from "./route";

function createMockRequest(body: Record<string, unknown>) {
  const headers = new Headers({
    origin: "http://localhost:3000",
    "sec-fetch-site": "same-origin",
  });

  return {
    method: "POST",
    json: async () => body,
    headers,
    url: "http://localhost:3000/api/verify-buyer",
    nextUrl: new URL("http://localhost:3000/api/verify-buyer"),
  } as unknown as NextRequest;
}

function createQueryResponse(
  payload: {
    first_name_initial: string | null;
    issued_at: string;
    expires_at: string;
    status: "valid" | "expired" | "revoked";
  } | null,
  error: { message: string } | null = null
) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: payload, error }),
  };
}

describe("POST /api/verify-buyer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ from: mockFrom });
  });

  it("returns 400 for malformed token payload", async () => {
    const response = await POST(createMockRequest({ token: "not-a-uuid" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBeDefined();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns not_found when token does not exist", async () => {
    mockFrom.mockReturnValue(createQueryResponse(null));

    const response = await POST(
      createMockRequest({ token: "550e8400-e29b-41d4-a716-446655440000" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result).toBe("not_found");
  });

  it("returns revoked when token status is revoked", async () => {
    mockFrom.mockReturnValue(
      createQueryResponse({
        first_name_initial: "T",
        issued_at: "2026-02-20T10:00:00.000Z",
        expires_at: "2026-03-20T10:00:00.000Z",
        status: "revoked",
      })
    );

    const response = await POST(
      createMockRequest({ token: "550e8400-e29b-41d4-a716-446655440000" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result).toBe("revoked");
  });

  it("returns expired when token is expired by date", async () => {
    mockFrom.mockReturnValue(
      createQueryResponse({
        first_name_initial: "M",
        issued_at: "2026-02-20T10:00:00.000Z",
        expires_at: "2020-01-01T00:00:00.000Z",
        status: "valid",
      })
    );

    const response = await POST(
      createMockRequest({ token: "550e8400-e29b-41d4-a716-446655440000" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result).toBe("expired");
  });

  it("returns valid with buyer info when token is active", async () => {
    mockFrom.mockReturnValue(
      createQueryResponse({
        first_name_initial: "S",
        issued_at: "2026-02-20T10:00:00.000Z",
        expires_at: "2026-04-20T10:00:00.000Z",
        status: "valid",
      })
    );

    const response = await POST(
      createMockRequest({ token: "550e8400-e29b-41d4-a716-446655440000" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result).toBe("valid");
    expect(data.buyerInfo).toEqual({
      displayName: "S",
      verifiedAt: "2026-02-20T10:00:00.000Z",
    });
  });
});
