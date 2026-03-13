import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for PayFast webhook handling of promotion boost and featured payments.
 * Validates that the webhook correctly processes `boost_promotion` and
 * `featured_promotion` payment types.
 */

const { mockCreateAdminClient, mockLogAuditEvent } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/config/env", () => ({
  env: vi.fn(() => "test-passphrase"),
}));
vi.mock("@/lib/services/payfast", () => ({
  verifyPayFastSignature: vi.fn().mockReturnValue(true),
  isPayFastIp: vi.fn().mockReturnValue(true),
}));

import { POST } from "@/app/api/webhooks/payfast/route";
import type { NextRequest } from "next/server";

const PAYMENT_ID = "pay-0001";
const PROMOTION_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "user-0001";
const PF_PAYMENT_ID = "pf-12345";

function createWebhookRequest(overrides: Record<string, string> = {}): NextRequest {
  const params = new URLSearchParams({
    m_payment_id: PAYMENT_ID,
    pf_payment_id: PF_PAYMENT_ID,
    payment_status: "COMPLETE",
    amount_gross: "15.00",
    signature: "test_sig",
    ...overrides,
  });

  return {
    text: async () => params.toString(),
    headers: {
      get: vi.fn((header: string) => {
        if (header === "cf-connecting-ip") return "197.97.145.144";
        if (header === "x-forwarded-for") return "197.97.145.144";
        return null;
      }),
    },
  } as unknown as NextRequest;
}

/**
 * Build a mock admin client that tracks all from() calls.
 * The webhook handler calls from("payments") multiple times with different
 * operations, so we need call-count tracking.
 */
function setupWebhookMock(paymentData: Record<string, unknown>, amountCents = 1500) {
  const promotionUpdateSpy = vi.fn().mockResolvedValue({ error: null });
  let paymentsCallCount = 0;

  mockCreateAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "payments") {
        paymentsCallCount++;
        if (paymentsCallCount === 1) {
          // First call: lookup payment by m_payment_id
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: PAYMENT_ID,
                area: "PROMOTIONS_EVENTS",
                status: "pending",
                provider: "payfast",
                provider_payment_id: null,
                provider_reference: PAYMENT_ID,
                provider_data: null,
                payfast_payment_id: null,
                amount_cents: amountCents,
                user_id: USER_ID,
                payfast_data: paymentData,
              },
            }),
          };
        }
        if (paymentsCallCount === 2) {
          // Second call: CAS claim (update status to "processing")
          const claimResult = {
            select: vi.fn().mockResolvedValue({
              data: [{ id: PAYMENT_ID }],
            }),
          };
          const thirdNeq = {
            neq: vi.fn().mockReturnValue(claimResult),
          };
          const secondNeq = {
            neq: vi.fn().mockReturnValue(thirdNeq),
          };
          const firstNeq = {
            neq: vi.fn().mockReturnValue(secondNeq),
          };
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(firstNeq),
            }),
          };
        }
        // Third+ call: finalize payment status to "complete"
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "promotions") {
        // Promotion update (boost_until or featured_until)
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: promotionUpdateSpy,
            }),
          }),
        };
      }
      if (table === "plans") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }
      // Default fallback
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      };
    }),
  });

  return { promotionUpdateSpy };
}

describe("PayFast webhook — promotion boost", () => {
  beforeEach(() => vi.clearAllMocks());

  it("processes boost_promotion payment successfully", async () => {
    setupWebhookMock({
      type: "boost_promotion",
      promotion_id: PROMOTION_ID,
      boost_days: 7,
    });

    const req = createWebhookRequest();
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("calls promotions table update for boost", async () => {
    const { promotionUpdateSpy } = setupWebhookMock({
      type: "boost_promotion",
      promotion_id: PROMOTION_ID,
      boost_days: 7,
    });

    const req = createWebhookRequest();
    await POST(req);

    expect(promotionUpdateSpy).toHaveBeenCalled();
  });

  it("logs audit event for boost_promotion", async () => {
    setupWebhookMock({
      type: "boost_promotion",
      promotion_id: PROMOTION_ID,
      boost_days: 7,
    });

    const req = createWebhookRequest();
    await POST(req);

    const calls = mockLogAuditEvent.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const boostCall = calls.find(
      (c) => c.targetType === "promotion" && c.action === "listing_boosted"
    );
    expect(boostCall).toBeDefined();
    expect(boostCall!.targetId).toBe(PROMOTION_ID);
  });
});

describe("PayFast webhook — promotion featured", () => {
  beforeEach(() => vi.clearAllMocks());

  it("processes featured_promotion payment successfully", async () => {
    setupWebhookMock(
      {
        type: "featured_promotion",
        promotion_id: PROMOTION_ID,
        feature_days: 7,
      },
      2500
    );

    const req = createWebhookRequest({ amount_gross: "25.00" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("calls promotions table update for featured", async () => {
    const { promotionUpdateSpy } = setupWebhookMock(
      {
        type: "featured_promotion",
        promotion_id: PROMOTION_ID,
        feature_days: 7,
      },
      2500
    );

    const req = createWebhookRequest({ amount_gross: "25.00" });
    await POST(req);

    expect(promotionUpdateSpy).toHaveBeenCalled();
  });

  it("logs audit event for featured_promotion", async () => {
    setupWebhookMock(
      {
        type: "featured_promotion",
        promotion_id: PROMOTION_ID,
        feature_days: 7,
      },
      2500
    );

    const req = createWebhookRequest({ amount_gross: "25.00" });
    await POST(req);

    const calls = mockLogAuditEvent.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const featuredCall = calls.find(
      (c) => c.targetType === "promotion" && c.action === "listing_featured"
    );
    expect(featuredCall).toBeDefined();
    expect(featuredCall!.targetId).toBe(PROMOTION_ID);
  });
});
