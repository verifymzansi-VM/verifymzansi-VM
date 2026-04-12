import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCheckLocalRateLimit,
  mockCanFeatured,
  mockCanUrgent,
  mockCreateHostedCheckout,
  mockGetActivePlanTierForArea,
  mockGetOwnerColumn,
  mockApplyOwnerFilter,
  mockReadOwnerId,
  mockLogAuditEvent,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockCanFeatured: vi.fn(),
  mockCanUrgent: vi.fn(),
  mockCreateHostedCheckout: vi.fn(),
  mockGetActivePlanTierForArea: vi.fn(),
  mockGetOwnerColumn: vi.fn(),
  mockApplyOwnerFilter: vi.fn(),
  mockReadOwnerId: vi.fn(),
  mockLogAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/services/entitlements", () => ({
  canFeatured: (...args: unknown[]) => mockCanFeatured(...args),
  canUrgent: (...args: unknown[]) => mockCanUrgent(...args),
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
}));

vi.mock("@/lib/payments/checkout", () => ({
  createHostedCheckout: (...args: unknown[]) => mockCreateHostedCheckout(...args),
}));

vi.mock("@/lib/services/plan-tier", () => ({
  getActivePlanTierForArea: (...args: unknown[]) => mockGetActivePlanTierForArea(...args),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: (...args: unknown[]) => mockCheckLocalRateLimit(...args),
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: vi.fn(() => null),
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/config/env", () => ({
  env: vi.fn(() => "https://verifymzansi.com"),
}));

vi.mock("@/lib/account/compat", () => ({
  ACCOUNT_PROFILE_NOT_FOUND_ERROR: "Account profile not found",
  ACCOUNT_PROFILE_WRITE_TABLE: "account_profiles",
  applyOwnerFilter: (...args: unknown[]) => mockApplyOwnerFilter(...args),
  getOwnerColumn: (...args: unknown[]) => mockGetOwnerColumn(...args),
  readOwnerId: (...args: unknown[]) => mockReadOwnerId(...args),
  withOwnerColumn: (columns: string) => columns,
}));

import { POST as postBusinessFeatured } from "@/app/api/businesses/[id]/featured/route";
import { POST as postBusinessUrgent } from "@/app/api/businesses/[id]/urgent/route";

const BUSINESS_ID = "00000000-0000-0000-0000-000000000123";
const USER_ID = "user-1";

function makeRequest(pathname: string): NextRequest {
  return {
    method: "POST",
    url: `https://verifymzansi.com${pathname}`,
    headers: new Headers(),
  } as unknown as NextRequest;
}

function setBusinessRow(row: Record<string, unknown> | null) {
  mockApplyOwnerFilter.mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data: row }),
  });
}

describe("business addon routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateClient.mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({}),
        }),
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
    });

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

    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockGetOwnerColumn.mockResolvedValue("owner_id");
    mockReadOwnerId.mockImplementation((row: { owner_id?: string }) => row.owner_id ?? null);
    mockGetActivePlanTierForArea.mockResolvedValue("growth");
    mockCanFeatured.mockReturnValue({ allowed: true });
    mockCanUrgent.mockReturnValue({ allowed: true });
    mockCreateHostedCheckout.mockResolvedValue({
      paymentId: "pay-1",
      checkoutUrl: "https://checkout.example/session",
    });
    mockLogAuditEvent.mockResolvedValue(undefined);

    setBusinessRow({
      id: BUSINESS_ID,
      business_name: "Mzansi Test Biz",
      status: "live",
      area: "MZANSI_BUSINESS",
      owner_id: USER_ID,
      featured_until: null,
      urgent_until: null,
    });
  });

  it("creates featured checkout for an eligible live business", async () => {
    const response = await postBusinessFeatured(
      makeRequest(`/api/businesses/${BUSINESS_ID}/featured`),
      {
        params: Promise.resolve({ id: BUSINESS_ID }),
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      checkoutUrl: "https://checkout.example/session",
      paymentId: "pay-1",
    });
    expect(mockCreateHostedCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        providerData: expect.objectContaining({ type: "featured_business" }),
      })
    );
  });

  it("returns 400 when a business is already featured", async () => {
    setBusinessRow({
      id: BUSINESS_ID,
      business_name: "Mzansi Test Biz",
      status: "live",
      area: "MZANSI_BUSINESS",
      owner_id: USER_ID,
      featured_until: new Date(Date.now() + 60_000).toISOString(),
    });

    const response = await postBusinessFeatured(
      makeRequest(`/api/businesses/${BUSINESS_ID}/featured`),
      {
        params: Promise.resolve({ id: BUSINESS_ID }),
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "This business is already featured" });
  });

  it("returns 429 when featured route is rate limited", async () => {
    mockCheckLocalRateLimit.mockReturnValue({ limited: true, retryAfter: 42 });

    const response = await postBusinessFeatured(
      makeRequest(`/api/businesses/${BUSINESS_ID}/featured`),
      {
        params: Promise.resolve({ id: BUSINESS_ID }),
      }
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("creates urgent checkout for an eligible live business", async () => {
    const response = await postBusinessUrgent(
      makeRequest(`/api/businesses/${BUSINESS_ID}/urgent`),
      {
        params: Promise.resolve({ id: BUSINESS_ID }),
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      checkoutUrl: "https://checkout.example/session",
      paymentId: "pay-1",
    });
    expect(mockCreateHostedCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        providerData: expect.objectContaining({ type: "urgent_business" }),
      })
    );
  });

  it("returns 403 when urgent entitlement is denied", async () => {
    mockCanUrgent.mockReturnValue({ allowed: false, reason: "Upgrade required" });

    const response = await postBusinessUrgent(
      makeRequest(`/api/businesses/${BUSINESS_ID}/urgent`),
      {
        params: Promise.resolve({ id: BUSINESS_ID }),
      }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Upgrade required" });
  });

  it("returns 400 when a business is already marked urgent", async () => {
    setBusinessRow({
      id: BUSINESS_ID,
      business_name: "Mzansi Test Biz",
      status: "live",
      area: "MZANSI_BUSINESS",
      owner_id: USER_ID,
      urgent_until: new Date(Date.now() + 60_000).toISOString(),
    });

    const response = await postBusinessUrgent(
      makeRequest(`/api/businesses/${BUSINESS_ID}/urgent`),
      {
        params: Promise.resolve({ id: BUSINESS_ID }),
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "This business is already marked urgent",
    });
  });
});
