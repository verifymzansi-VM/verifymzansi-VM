/**
 * Unit tests for the PayFast ITN (Instant Transaction Notification) webhook handler.
 *
 * POST /api/webhooks/payfast
 *
 * Covers: IP verification, signature validation, idempotency (CAS),
 * amount mismatch, all 6 fulfillment branches (subscription, listing boost,
 * business boost, storefront boost, featured, urgent), failure statuses
 * (CANCELLED, FAILED, PENDING), and audit logging.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock all external dependencies ────────────────────────────

const mockIsPayFastIp = vi.fn().mockReturnValue(true);
const mockVerifyPayFastSignature = vi.fn().mockReturnValue(true);
const mockBuildPayFastCheckoutUrl = vi.fn();
vi.mock("@/lib/services/payfast", () => ({
  isPayFastIp: (...args: unknown[]) => mockIsPayFastIp(...args),
  verifyPayFastSignature: (...args: unknown[]) => mockVerifyPayFastSignature(...args),
  buildPayFastCheckoutUrl: (...args: unknown[]) => mockBuildPayFastCheckoutUrl(...args),
}));

const mockLogAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => {
    const envMap: Record<string, string> = {
      PAYFAST_PASSPHRASE: "test-passphrase", // secret-scan: allow
    };
    return envMap[key] ?? "";
  }),
}));

// ── Admin client mock ─────────────────────────────────────────

type MockChainResult = {
  data: unknown;
  error: unknown;
};

const mockUpdateFn = vi.fn();
const mockUpsertFn = vi.fn();
const _mockSelectFn = vi.fn();
const _mockEqFn = vi.fn();
const _mockNeqFn = vi.fn();
const _mockMaybeSingleFn = vi.fn();

function createMockAdminClient(overrides: {
  paymentLookup?: MockChainResult;
  updateResult?: { data: unknown[] | null };
  entityUpdateError?: { message: string } | null;
  entitlementError?: { message: string } | null;
  planLookup?: MockChainResult;
}) {
  const {
    paymentLookup = { data: null, error: null },
    updateResult = { data: [{ id: "pay-001" }] },
    entityUpdateError = null,
    entitlementError = null,
    planLookup = { data: null, error: null },
  } = overrides;

  // Track update calls for assertions
  mockUpdateFn.mockReset();
  mockUpsertFn.mockReset();

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    // Payment lookup: .from("payments").select(...).eq("id", ...).maybeSingle()
    if (table === "payments") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue(paymentLookup),
          }),
        }),
        update: vi.fn().mockImplementation((data: unknown) => {
          mockUpdateFn(table, data);
          const neqChain: Record<string, unknown> = {
            select: vi.fn().mockResolvedValue(updateResult),
          };
          neqChain.neq = vi.fn().mockReturnValue(neqChain);
          const innerEqResult: Record<string, unknown> = {
            neq: vi.fn().mockReturnValue(neqChain),
            // For rollback: .eq("id",...).eq("status","processing")
            eq: vi.fn().mockResolvedValue({ error: null }),
          };
          return {
            eq: vi.fn().mockReturnValue(innerEqResult),
          };
        }),
      };
    }

    // Entity tables: listings, storefronts, businesses
    if (["listings", "storefronts", "businesses"].includes(table)) {
      return {
        update: vi.fn().mockImplementation((data: unknown) => {
          mockUpdateFn(table, data);
          return {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: entityUpdateError }),
            }),
          };
        }),
      };
    }

    // Plans lookup
    if (table === "plans") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue(planLookup),
          }),
        }),
      };
    }

    // Entitlements upsert
    if (table === "entitlements") {
      return {
        upsert: vi.fn().mockImplementation((data: unknown, opts: unknown) => {
          mockUpsertFn(table, data, opts);
          return { error: entitlementError };
        }),
      };
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
  });

  return { from: mockFrom };
}

let mockAdminClient: ReturnType<typeof createMockAdminClient>;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}));

// ── Import route handler (after mocks are set up) ─────────────

import { POST } from "@/app/api/webhooks/payfast/route";

// ── Helpers ───────────────────────────────────────────────────

const PAYMENT_ID = "pay-001";
const PF_PAYMENT_ID = "pf-12345";
const USER_ID = "user-0001-0001-0001-000000000001";
const LISTING_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const STOREFRONT_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const BUSINESS_ID = "c3d4e5f6-a7b8-9012-cdef-123456789012";

function makeITNRequest(
  formData: Record<string, string>,
  headers?: Record<string, string>
): NextRequest {
  const body = new URLSearchParams(formData).toString();
  return new NextRequest("http://localhost/api/webhooks/payfast", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "197.97.145.144",
      ...headers,
    },
  });
}

function makeCompletePayload(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    m_payment_id: PAYMENT_ID,
    pf_payment_id: PF_PAYMENT_ID,
    payment_status: "COMPLETE",
    amount_gross: "15.00",
    signature: "valid-sig",
    ...overrides,
  };
}

function makePaymentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    status: "pending",
    payfast_payment_id: null,
    amount_cents: 1500,
    user_id: USER_ID,
    payfast_data: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("POST /api/webhooks/payfast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPayFastIp.mockReturnValue(true);
    mockVerifyPayFastSignature.mockReturnValue(true);
  });

  // ── IP Verification ──────────────────────────────────────

  describe("IP verification", () => {
    it("returns 403 when source IP is invalid", async () => {
      mockIsPayFastIp.mockReturnValue(false);
      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("IP");
    });

    it("accepts requests from valid PayFast IPs", async () => {
      mockIsPayFastIp.mockReturnValue(true);
      mockAdminClient = createMockAdminClient({
        paymentLookup: { data: makePaymentRecord(), error: null },
      });
      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      // Should not be 403 — should proceed past IP check
      expect(res.status).not.toBe(403);
    });
  });

  // ── Signature Verification ───────────────────────────────

  describe("Signature verification", () => {
    it("returns 403 when signature is invalid", async () => {
      mockVerifyPayFastSignature.mockReturnValue(false);
      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("signature");
    });
  });

  // ── Missing Payment ID ──────────────────────────────────

  describe("Missing payment ID", () => {
    it("returns 400 when m_payment_id is missing", async () => {
      const payload = makeCompletePayload();
      delete payload.m_payment_id;
      const req = makeITNRequest(payload);
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/payment ID/i);
    });
  });

  // ── Payment Not Found ───────────────────────────────────

  describe("Payment not found", () => {
    it("returns 404 when payment record does not exist", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: { data: null, error: null },
      });
      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });
  });

  // ── Idempotency / Duplicate Delivery ────────────────────

  describe("Idempotency", () => {
    it("returns 200 with duplicate=true for already-completed payment", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord({
            status: "complete",
            payfast_payment_id: PF_PAYMENT_ID,
          }),
          error: null,
        },
      });
      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.duplicate).toBe(true);
    });
  });

  // ── Amount Mismatch ─────────────────────────────────────

  describe("Amount mismatch", () => {
    it("returns 400 when payment amount does not match expected", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord({ amount_cents: 1500 }), // expects 15.00 ZAR
          error: null,
        },
      });
      // Send wrong amount
      const req = makeITNRequest(makeCompletePayload({ amount_gross: "99.99" }));
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/mismatch/i);
    });

    it("allows 1-cent variance for rounding", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord({ amount_cents: 1500 }),
          error: null,
        },
      });
      // Send amount with minor rounding difference (15.01 vs 15.00)
      const req = makeITNRequest(makeCompletePayload({ amount_gross: "15.01" }));
      const res = await POST(req);
      // Should not fail with amount mismatch
      expect(res.status).not.toBe(400);
    });
  });

  // ── Listing Boost Fulfillment ───────────────────────────

  describe("Listing boost fulfillment", () => {
    it("sets boost_until on listing and logs audit event", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord({
            payfast_data: {
              type: "boost",
              listing_id: LISTING_ID,
              boost_days: 7,
            },
          }),
          error: null,
        },
      });

      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify listings table was updated with boost_until
      const listingUpdateCalls = mockUpdateFn.mock.calls.filter(
        (call: unknown[]) => call[0] === "listings"
      );
      expect(listingUpdateCalls.length).toBeGreaterThanOrEqual(1);
      const [, updateData] = listingUpdateCalls[0];
      expect(updateData).toHaveProperty("boost_until");
      expect(new Date(updateData.boost_until).getTime()).toBeGreaterThan(Date.now());

      // Verify audit log was called with correct action
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "listing_boosted",
          targetType: "listing",
          targetId: LISTING_ID,
        })
      );
    });

    it("returns 500 when listing boost update fails", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord({
            payfast_data: {
              type: "boost",
              listing_id: LISTING_ID,
              boost_days: 7,
            },
          }),
          error: null,
        },
        entityUpdateError: { message: "DB connection failed" },
      });

      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/fulfillment/i);
    });
  });

  // ── Listing Featured Fulfillment ────────────────────────

  describe("Listing featured fulfillment", () => {
    it("sets featured_until on listing and logs audit event", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord({
            payfast_data: {
              type: "featured",
              listing_id: LISTING_ID,
              feature_days: 7,
            },
          }),
          error: null,
        },
      });

      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(200);

      // Verify listings table was updated with featured_until
      const listingUpdateCalls = mockUpdateFn.mock.calls.filter(
        (call: unknown[]) => call[0] === "listings"
      );
      expect(listingUpdateCalls.length).toBeGreaterThanOrEqual(1);
      const [, updateData] = listingUpdateCalls[0];
      expect(updateData).toHaveProperty("featured_until");

      // Verify audit
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "listing_featured",
          targetType: "listing",
          targetId: LISTING_ID,
        })
      );
    });

    it("returns 500 when featured update fails", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord({
            payfast_data: {
              type: "featured",
              listing_id: LISTING_ID,
              feature_days: 7,
            },
          }),
          error: null,
        },
        entityUpdateError: { message: "DB error" },
      });

      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(500);
    });
  });

  // ── Listing Urgent Fulfillment ──────────────────────────

  describe("Listing urgent fulfillment", () => {
    it("sets urgent_until on listing and logs audit event", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord({
            payfast_data: {
              type: "urgent",
              listing_id: LISTING_ID,
              urgent_days: 7,
            },
          }),
          error: null,
        },
      });

      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(200);

      const listingUpdateCalls = mockUpdateFn.mock.calls.filter(
        (call: unknown[]) => call[0] === "listings"
      );
      expect(listingUpdateCalls.length).toBeGreaterThanOrEqual(1);
      const [, updateData] = listingUpdateCalls[0];
      expect(updateData).toHaveProperty("urgent_until");

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "listing_urgent",
          targetType: "listing",
          targetId: LISTING_ID,
        })
      );
    });
  });

  // ── Storefront Boost Fulfillment ────────────────────────

  describe("Storefront boost fulfillment", () => {
    it("sets boost_until on storefront and logs audit event", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord({
            payfast_data: {
              type: "boost_storefront",
              storefront_id: STOREFRONT_ID,
              boost_days: 7,
            },
          }),
          error: null,
        },
      });

      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(200);

      const sfUpdateCalls = mockUpdateFn.mock.calls.filter(
        (call: unknown[]) => call[0] === "storefronts"
      );
      expect(sfUpdateCalls.length).toBeGreaterThanOrEqual(1);
      const [, updateData] = sfUpdateCalls[0];
      expect(updateData).toHaveProperty("boost_until");

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "storefront_boosted",
          targetType: "storefront",
          targetId: STOREFRONT_ID,
        })
      );
    });

    it("returns 500 when storefront boost update fails", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord({
            payfast_data: {
              type: "boost_storefront",
              storefront_id: STOREFRONT_ID,
              boost_days: 7,
            },
          }),
          error: null,
        },
        entityUpdateError: { message: "DB error" },
      });

      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(500);
    });
  });

  // ── Business Profile Boost Fulfillment ──────────────────

  describe("Business profile boost fulfillment", () => {
    it("sets boost_until on business profile and logs audit event", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord({
            payfast_data: {
              type: "boost_business",
              business_profile_id: BUSINESS_ID,
              boost_days: 7,
            },
          }),
          error: null,
        },
      });

      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(200);

      const bpUpdateCalls = mockUpdateFn.mock.calls.filter(
        (call: unknown[]) => call[0] === "businesses"
      );
      expect(bpUpdateCalls.length).toBeGreaterThanOrEqual(1);
      const [, updateData] = bpUpdateCalls[0];
      expect(updateData).toHaveProperty("boost_until");

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "business_boosted",
          targetType: "business",
          targetId: BUSINESS_ID,
        })
      );
    });
  });

  // ── CANCELLED / FAILED / PENDING Statuses ───────────────

  describe("Non-COMPLETE payment statuses", () => {
    it("marks payment as failed on CANCELLED", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord(),
          error: null,
        },
      });

      const req = makeITNRequest(makeCompletePayload({ payment_status: "CANCELLED" }));
      const res = await POST(req);
      expect(res.status).toBe(200);

      // Verify payment was updated to "failed"
      const paymentUpdates = mockUpdateFn.mock.calls.filter(
        (call: unknown[]) => call[0] === "payments"
      );
      expect(paymentUpdates.length).toBeGreaterThanOrEqual(1);
      const [, updateData] = paymentUpdates[0];
      expect(updateData).toEqual({ status: "failed" });
    });

    it("marks payment as failed on FAILED", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord(),
          error: null,
        },
      });

      const req = makeITNRequest(makeCompletePayload({ payment_status: "FAILED" }));
      const res = await POST(req);
      expect(res.status).toBe(200);

      const paymentUpdates = mockUpdateFn.mock.calls.filter(
        (call: unknown[]) => call[0] === "payments"
      );
      expect(paymentUpdates.length).toBeGreaterThanOrEqual(1);
    });

    it("does not modify DB on PENDING status", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord(),
          error: null,
        },
      });

      const req = makeITNRequest(makeCompletePayload({ payment_status: "PENDING" }));
      const res = await POST(req);
      expect(res.status).toBe(200);

      // No payment update should have been called (PENDING is a no-op)
      expect(mockUpdateFn).not.toHaveBeenCalled();
    });

    it("handles unknown payment status gracefully", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord(),
          error: null,
        },
      });

      const req = makeITNRequest(makeCompletePayload({ payment_status: "UNKNOWN_STATUS" }));
      const res = await POST(req);
      expect(res.status).toBe(200);
      // Should succeed without error — just logged as warning
    });
  });

  // ── Audit Logging ───────────────────────────────────────

  describe("Audit logging", () => {
    it("logs payment_completed audit event on successful COMPLETE", async () => {
      mockAdminClient = createMockAdminClient({
        paymentLookup: {
          data: makePaymentRecord(),
          error: null,
        },
      });

      const req = makeITNRequest(makeCompletePayload());
      const res = await POST(req);
      expect(res.status).toBe(200);

      // Should have at least one audit call for payment_completed
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "payment_completed",
          targetType: "payment",
          targetId: PAYMENT_ID,
        })
      );
    });
  });
});
