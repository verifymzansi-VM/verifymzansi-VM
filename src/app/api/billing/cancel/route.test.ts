import { describe, it, expect, vi, beforeEach } from "vitest";
import { type NextRequest } from "next/server";
import { POST as cancelRoute } from "./route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const CSRF_TOKEN = "a".repeat(64);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(true),
}));

function createMockRequest(body: Record<string, unknown>) {
  const url = "https://verifymzansi.com/api/billing/cancel";
  const request = new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "https://verifymzansi.com",
      "sec-fetch-site": "same-origin",
      cookie: `vm_csrf=${CSRF_TOKEN}`,
      "x-csrf-token": CSRF_TOKEN,
    },
  });

  return Object.assign(request, {
    nextUrl: new URL(url),
  }) as NextRequest;
}

describe("POST /api/billing/cancel", () => {
  const mockSupabase = {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  };

  const mockAdmin = {
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue(mockSupabase as never);
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never);
  });

  it("returns 401 when user is unauthenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    const res = await cancelRoute(
      createMockRequest({ entitlementId: "550e8400-e29b-41d4-a716-446655440000" })
    );

    expect(res.status).toBe(401);
  });

  it("returns 404 when entitlement is not found", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await cancelRoute(
      createMockRequest({ entitlementId: "550e8400-e29b-41d4-a716-446655440000" })
    );

    expect(res.status).toBe(404);
  });

  it("returns 409 when entitlement is not active", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "ent-1",
              user_id: "user-1",
              area: "MZANSI_MARKET",
              tier: "growth",
              status: "cancelled",
            },
            error: null,
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await cancelRoute(
      createMockRequest({ entitlementId: "550e8400-e29b-41d4-a716-446655440000" })
    );

    expect(res.status).toBe(409);
  });

  it("cancels an active entitlement", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const updateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: [{ id: "ent-1" }], error: null }),
          }),
        }),
      }),
    };

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "ent-1",
              user_id: "user-1",
              area: "MZANSI_MARKET",
              tier: "growth",
              status: "active",
              expires_at: "2026-04-25T00:00:00.000Z",
            },
            error: null,
          }),
          update: vi.fn().mockReturnValue(updateChain),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await cancelRoute(
      createMockRequest({ entitlementId: "550e8400-e29b-41d4-a716-446655440000" })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.entitlementId).toBe("ent-1");
  });

  it("returns 400 when entitlementId is not a valid UUID", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const res = await cancelRoute(createMockRequest({ entitlementId: "not-a-uuid" }));

    expect(res.status).toBe(400);
  });

  it("returns 500 when entitlement fetch fails with a DB error", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "connection timeout" },
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await cancelRoute(
      createMockRequest({ entitlementId: "550e8400-e29b-41d4-a716-446655440000" })
    );

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Failed to cancel subscription");
  });

  it("returns 500 when the update query fails", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const updateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: null, error: { message: "update failed" } }),
          }),
        }),
      }),
    };

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "ent-1",
              user_id: "user-1",
              area: "MZANSI_MARKET",
              tier: "growth",
              status: "active",
              expires_at: "2026-04-25T00:00:00.000Z",
            },
            error: null,
          }),
          update: vi.fn().mockReturnValue(updateChain),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await cancelRoute(
      createMockRequest({ entitlementId: "550e8400-e29b-41d4-a716-446655440000" })
    );

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Failed to cancel subscription");
  });

  it("returns 409 when cancellation update matches zero rows", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const updateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    };

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "ent-1",
              user_id: "user-1",
              area: "MZANSI_MARKET",
              tier: "growth",
              status: "active",
              expires_at: "2026-04-25T00:00:00.000Z",
            },
            error: null,
          }),
          update: vi.fn().mockReturnValue(updateChain),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await cancelRoute(
      createMockRequest({ entitlementId: "550e8400-e29b-41d4-a716-446655440000" })
    );

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("Subscription status changed");
  });
});
