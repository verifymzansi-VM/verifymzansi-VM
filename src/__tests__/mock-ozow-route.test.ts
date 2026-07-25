import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { GET } from "@/app/api/mock-ozow/route";
import { createAdminClient } from "@/lib/supabase/admin";

const MOCK_PAYMENT_ID = "550e8400-e29b-41d4-a716-446655440000";

function mockPaymentLookup(payment: Record<string, unknown> | null) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: payment, error: null }),
        }),
      }),
    }),
  } as never);
}

describe("GET /api/mock-ozow", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_MOCK_OZOW", "true");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects invalid payment ids before hitting the database", async () => {
    const res = await GET(new Request("http://localhost/api/mock-ozow?paymentId=not-a-uuid"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid mock payment query",
      details: { paymentId: "Enter a valid ID" },
    });
  });

  it("rejects unsafe return urls", async () => {
    const res = await GET(
      new Request("http://localhost/api/mock-ozow?returnUrl=https://evil.example/phish")
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid mock payment query",
      details: { returnUrl: "returnUrl is invalid" },
    });
  });

  it("accepts localhost and loopback return urls for e2e flows", async () => {
    const localhostRes = await GET(
      new Request("http://localhost/api/mock-ozow?returnUrl=http://localhost:3100/billing/success")
    );
    const loopbackRes = await GET(
      new Request("http://localhost/api/mock-ozow?returnUrl=http://127.0.0.1:3100/billing/success")
    );

    expect(localhostRes.status).toBe(307);
    expect(loopbackRes.status).toBe(307);
    expect(localhostRes.headers.get("location")).toBe("http://localhost:3100/billing/success");
    expect(loopbackRes.headers.get("location")).toBe("http://127.0.0.1:3100/billing/success");
  });

  it("accepts loopback return urls in e2e mode even when NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "e2e");
    vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE", "1");
    document.documentElement.dataset.playwright = "1";

    const res = await GET(
      new Request("http://localhost/api/mock-ozow?returnUrl=http://127.0.0.1:3100/billing/success")
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3100/billing/success");
    delete document.documentElement.dataset.playwright;
  });

  it("rejects payments that were not created through the mock flow", async () => {
    mockPaymentLookup({
      id: MOCK_PAYMENT_ID,
      provider: "ozow",
      provider_data: { type: "subscription" },
    });

    const res = await GET(
      new Request(`http://localhost/api/mock-ozow?paymentId=${MOCK_PAYMENT_ID}`)
    );

    expect(res.status).toBe(404);
  });

  it("detects mock payments via provider_data.checkout.mockFlow and redirects after a confirmed webhook", async () => {
    mockPaymentLookup({
      id: MOCK_PAYMENT_ID,
      provider: "ozow",
      provider_data: { checkout: { mockFlow: true } },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      new Request(
        `http://localhost/api/mock-ozow?paymentId=${MOCK_PAYMENT_ID}&returnUrl=/billing/success`
      )
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/billing/success");
  });

  it("surfaces a failure instead of redirecting when the webhook rejects the confirmation", async () => {
    mockPaymentLookup({
      id: MOCK_PAYMENT_ID,
      provider: "ozow",
      provider_data: { checkout: { mockFlow: true } },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      new Request(
        `http://localhost/api/mock-ozow?paymentId=${MOCK_PAYMENT_ID}&returnUrl=/billing/success`
      )
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(res.status).toBe(502);
    expect(res.headers.get("location")).toBeNull();
  });

  it("surfaces a failure instead of redirecting when the webhook call fails", async () => {
    mockPaymentLookup({
      id: MOCK_PAYMENT_ID,
      provider: "ozow",
      provider_data: { checkout: { mockFlow: true } },
    });
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      new Request(
        `http://localhost/api/mock-ozow?paymentId=${MOCK_PAYMENT_ID}&returnUrl=/billing/success`
      )
    );

    expect(res.status).toBe(502);
    expect(res.headers.get("location")).toBeNull();
  });
});
