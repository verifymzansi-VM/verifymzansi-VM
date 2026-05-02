import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/utils/csrf";

const { mockCreateClient, mockCreateAdminClient, mockCheckRateLimit, mockGetClientIp } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockGetClientIp: vi.fn(),
  })
);

const {
  mockCanBoost,
  mockGetActivePlanTierForArea,
  mockCreateHostedCheckout,
  mockGetOwnerColumn,
  mockApplyOwnerFilter,
  mockLogAuditEvent,
} = vi.hoisted(() => ({
  mockCanBoost: vi.fn(),
  mockGetActivePlanTierForArea: vi.fn(),
  mockCreateHostedCheckout: vi.fn(),
  mockGetOwnerColumn: vi.fn(),
  mockApplyOwnerFilter: vi.fn(),
  mockLogAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/services/entitlements", () => ({
  canBoost: (...args: unknown[]) => mockCanBoost(...args),
}));

vi.mock("@/lib/services/plan-tier", () => ({
  getActivePlanTierForArea: (...args: unknown[]) => mockGetActivePlanTierForArea(...args),
}));

vi.mock("@/lib/payments/checkout", () => ({
  createHostedCheckout: (...args: unknown[]) => mockCreateHostedCheckout(...args),
}));

vi.mock("@/lib/account/compat", () => ({
  ACCOUNT_PROFILE_NOT_FOUND_ERROR: "Account profile not found",
  applyOwnerFilter: (...args: unknown[]) => mockApplyOwnerFilter(...args),
  getOwnerColumn: (...args: unknown[]) => mockGetOwnerColumn(...args),
  withOwnerColumn: (columns: string) => columns,
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
}));

vi.mock("@/lib/config/env", () => ({
  env: vi.fn(() => "https://verifymzansi.com"),
}));

import { POST } from "./route";

const VALID_CSRF_TOKEN = "a".repeat(64);

function createRequest(origin?: string, includeCsrf = false) {
  const headers = new Headers(origin ? { origin } : {});
  if (includeCsrf) {
    headers.set(CSRF_HEADER_NAME, VALID_CSRF_TOKEN);
    headers.set("cookie", `${CSRF_COOKIE_NAME}=${VALID_CSRF_TOKEN}`);
  }

  return {
    url: "https://verifymzansi.com/api/promotions/00000000-0000-0000-0000-000000000001/boost",
    headers,
  } as unknown as NextRequest;
}

describe("POST /api/promotions/[id]/boost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const accountProfileMaybeSingle = vi.fn().mockResolvedValue({ data: { id: "profile-1" } });
    const pendingPaymentMaybeSingle = vi.fn().mockResolvedValue({ data: null });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: accountProfileMaybeSingle,
              }),
            }),
          };
        }

        if (table === "payments") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  contains: vi.fn().mockReturnValue({
                    maybeSingle: pendingPaymentMaybeSingle,
                  }),
                }),
              }),
            }),
          };
        }

        return { select: vi.fn() };
      }),
    });
    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({}),
        }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockGetOwnerColumn.mockResolvedValue("owner_id");
    mockApplyOwnerFilter.mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "00000000-0000-0000-0000-000000000001",
          title: "Local Tour",
          status: "live",
          boost_until: null,
          owner_id: "user-1",
        },
      }),
    });
    mockGetActivePlanTierForArea.mockResolvedValue("growth");
    mockCanBoost.mockReturnValue({ allowed: true });
    mockCreateHostedCheckout.mockResolvedValue({
      paymentId: "pay-boost-1",
      checkoutUrl: "https://checkout.example/boost",
    });
    mockLogAuditEvent.mockResolvedValue(undefined);
  });

  it("rejects cross-site boost checkout requests", async () => {
    const response = await POST(createRequest("https://evil.example"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });

    expect(response.status).toBe(403);
  });

  it("returns 400 for a malformed promotion ID", async () => {
    const response = await POST(createRequest("https://verifymzansi.com", true), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid Tourism & Events post ID",
    });
  });

  it("returns 503 when shared checkout protection is degraded", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, degraded: true, retryAfter: 90 });

    const response = await POST(createRequest("https://verifymzansi.com", true), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("90");
  });

  it("rejects boost checkout requests without CSRF token", async () => {
    const response = await POST(createRequest("https://verifymzansi.com"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Invalid CSRF token" });
  });

  it("returns 403 when the user is not entitled to boost promotions", async () => {
    mockCanBoost.mockReturnValue({ allowed: false, reason: "Upgrade to Growth or Pro to boost." });

    const response = await POST(createRequest("https://verifymzansi.com", true), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Upgrade to Growth or Pro to boost.",
    });
    expect(mockCreateHostedCheckout).not.toHaveBeenCalled();
  });

  it("creates checkout for entitled users", async () => {
    const response = await POST(createRequest("https://verifymzansi.com", true), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      checkoutUrl: "https://checkout.example/boost",
      paymentId: "pay-boost-1",
    });
    expect(mockGetActivePlanTierForArea).toHaveBeenCalledWith("user-1", "PROMOTIONS_EVENTS");
    expect(mockCanBoost).toHaveBeenCalled();
    expect(mockCreateHostedCheckout).toHaveBeenCalledTimes(1);
  });
});
