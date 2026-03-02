import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import { type NextRequest } from "next/server";

const { mockFrom, mockLogAuditEvent } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("@/lib/config/env", () => ({
  env: (key: string) => {
    const vals: Record<string, string> = {
      NODE_ENV: "test",
      PAYFAST_SANDBOX: "true",
      PAYFAST_PASSPHRASE: "testpass", // secret-scan: allow
    };
    return vals[key] || "";
  },
}));

import { POST } from "./route";

function buildSignedPayload(data: Record<string, string>, passphrase?: string): string {
  // Match PF_ITN_ORDER used by verifyPayFastSignature
  const PF_ITN_ORDER = [
    "m_payment_id",
    "pf_payment_id",
    "payment_status",
    "item_name",
    "item_description",
    "amount_gross",
    "amount_fee",
    "amount_net",
    "custom_str1",
    "custom_str2",
    "custom_str3",
    "custom_str4",
    "custom_str5",
    "custom_int1",
    "custom_int2",
    "custom_int3",
    "custom_int4",
    "custom_int5",
    "name_first",
    "name_last",
    "email_address",
    "merchant_id",
  ];
  const knownKeys = PF_ITN_ORDER.filter((key) => key in data);
  const extraKeys = Object.keys(data).filter((key) => !PF_ITN_ORDER.includes(key));
  const orderedKeys = [...knownKeys, ...extraKeys];

  const signStr = orderedKeys.map((k) => `${k}=${encodeURIComponent(data[k].trim())}`).join("&");

  const withPass = passphrase ? `${signStr}&passphrase=${encodeURIComponent(passphrase)}` : signStr;

  const sig = createHash("md5").update(withPass).digest("hex");

  return new URLSearchParams({ ...data, signature: sig }).toString();
}

function createWebhookRequest(body: string, ip = "197.97.145.144"): NextRequest {
  return {
    text: async () => body,
    headers: new Headers({
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": ip,
    }),
  } as unknown as NextRequest;
}

describe("PayFast Webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests with invalid signature", async () => {
    const body = new URLSearchParams({
      m_payment_id: "pay-1",
      payment_status: "COMPLETE",
      amount_gross: "100.00",
      signature: "invalid_signature",
    }).toString();

    const req = createWebhookRequest(body);
    const res = await POST(req);

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Invalid signature");
  });

  it("returns 400 when payment ID is missing", async () => {
    const payload = buildSignedPayload(
      { payment_status: "COMPLETE", amount_gross: "100.00" },
      "testpass"
    );

    const req = createWebhookRequest(payload);
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 404 when payment record not found", async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    }));

    const payload = buildSignedPayload(
      {
        m_payment_id: "pay-123",
        pf_payment_id: "pf-456",
        payment_status: "COMPLETE",
        amount_gross: "100.00",
      },
      "testpass"
    );

    const req = createWebhookRequest(payload);
    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  it("handles duplicate webhook delivery (idempotency)", async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "pay-123",
          status: "complete",
          payfast_payment_id: "pf-456",
          amount_cents: 10000,
          user_id: "user-1",
        },
      }),
    }));

    const payload = buildSignedPayload(
      {
        m_payment_id: "pay-123",
        pf_payment_id: "pf-456",
        payment_status: "COMPLETE",
        amount_gross: "100.00",
      },
      "testpass"
    );

    const req = createWebhookRequest(payload);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.duplicate).toBe(true);
  });

  it("rejects amount mismatch", async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "pay-123",
          status: "pending",
          payfast_payment_id: null,
          amount_cents: 20000,
          user_id: "user-1",
        },
      }),
    }));

    const payload = buildSignedPayload(
      {
        m_payment_id: "pay-123",
        pf_payment_id: "pf-789",
        payment_status: "COMPLETE",
        amount_gross: "100.00",
      },
      "testpass"
    );

    const req = createWebhookRequest(payload);
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Amount mismatch");
  });
});
