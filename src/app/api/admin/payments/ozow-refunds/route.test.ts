/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import type * as OzowRefundsModule from "@/lib/payments/ozow-refunds";

// Synthetic staff session and a fake Ozow client: nothing here reaches Ozow.
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
const ozow = vi.hoisted(() => ({ get: vi.fn(), sendOzowRefund: vi.fn() }));
vi.mock("@/lib/payments/ozow-refunds", async (actual) => ({
  ...(await actual<typeof OzowRefundsModule>()),
  createOzowRefundClient: () => ({ get: ozow.get }),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: () => ({}) }));

const { POST } = await import("./route");
const { OzowRefundNotFoundError, OzowRefundUnavailableError } =
  await import("@/lib/payments/ozow-refunds");

const payment = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const TX = "497f6eca-6276-4993-bfeb-53cbbbba6f08";
const REFUND = "b1fa5055-19c5-41ab-86dd-15272d103455";
const csrf = "c".repeat(64);
const rpc = vi.fn();
const calls = (name: string) => rpc.mock.calls.filter(([called]) => called === name);

function request(body: unknown) {
  return new NextRequest("https://verifymzansi.com/api/admin/payments/ozow-refunds", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      "x-csrf-token": csrf,
    },
  });
}
const answer = (answers: Record<string, { data?: unknown; error?: unknown }>) =>
  rpc.mockImplementation(async (name: string) => ({
    data: answers[name]?.data ?? null,
    error: answers[name]?.error ?? null,
  }));
const fact = (overrides: Record<string, unknown> = {}) => ({
  refundId: REFUND,
  transactionId: TX,
  amountCents: 6900,
  status: "Complete",
  requestedAt: "2026-11-13T09:30:00.000Z",
  completedAt: "2026-11-13T10:30:00.000Z",
  ...overrides,
});
const dashboard = {
  action: "refund.dashboard",
  paymentId: payment,
  reasonCode: "billing_error",
  reason: "Charged twice by mistake",
  ozowRefundId: REFUND,
};
const recorded = {
  request_id: requestId,
  status: "applied",
  channel: "dashboard",
  kind: "refunded",
  line_id: null,
  amount_cents: 6900,
  needs_approval: false,
  released_activations: 1,
  payment_status: "refunded",
  repeated: false,
};
const refundKey = {
  OZOW_REFUND_CLIENT_ID: "synthetic-refund-client",
  OZOW_REFUND_CLIENT_SECRET: "synthetic-refund-secret",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.stubEnv("ENABLE_MOCK_OZOW", "false");
  vi.stubEnv("OZOW_API_REFUNDS_ENABLED", "false");
  for (const [key, value] of Object.entries(refundKey)) vi.stubEnv(key, value);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});
afterEach(() => vi.unstubAllEnvs());

describe("a refund made in the Ozow dashboard", () => {
  it("checks the refund right before asking Ozow anything", async () => {
    answer({
      get_staff_refund_context: {
        error: { code: "42501", message: "staff payments:refund required" },
      },
    });
    const response = await POST(request(dashboard));
    expect(response.status).toBe(403);
    expect(ozow.get).not.toHaveBeenCalled();
    expect(calls("record_staff_dashboard_refund")).toHaveLength(0);
  });

  it("records the refund as Ozow gives it, for this payment's transaction and amount", async () => {
    answer({
      get_staff_refund_context: { data: { ozow_transaction_id: TX, amount_cents: 6900 } },
      record_staff_dashboard_refund: { data: recorded },
    });
    ozow.get.mockResolvedValue(fact());
    const response = await POST(request(dashboard));
    expect(response.status).toBe(200);
    expect(calls("record_staff_dashboard_refund")[0][1]).toMatchObject({
      p_ozow_refund_id: REFUND,
      p_ozow_fact: {
        refund_id: REFUND,
        transaction_id: TX,
        amount_cents: 6900,
        status: "Complete",
      },
    });
  });

  it.each([
    ["another transaction", fact({ transactionId: "c2fa5055-19c5-41ab-86dd-15272d103455" }), 409],
    ["another amount", fact({ amountCents: 6800 }), 409],
    ["a failed refund", fact({ status: "Failed" }), 409],
    ["an id Ozow does not have", new OzowRefundNotFoundError(), 422],
    ["an Ozow that cannot be asked", new OzowRefundUnavailableError("down"), 503],
  ])("records nothing for %s", async (_, outcome, status) => {
    answer({
      get_staff_refund_context: { data: { ozow_transaction_id: TX, amount_cents: 6900 } },
      record_staff_dashboard_refund: { data: recorded },
    });
    if (outcome instanceof Error) ozow.get.mockRejectedValue(outcome);
    else ozow.get.mockResolvedValue(outcome);
    const response = await POST(request(dashboard));
    expect(response.status).toBe(status);
    expect(calls("record_staff_dashboard_refund")).toHaveLength(0);
  });

  it("records without a read only when the refund key is not set", async () => {
    vi.stubEnv("OZOW_REFUND_CLIENT_SECRET", "");
    answer({
      get_staff_refund_context: { data: { ozow_transaction_id: TX, amount_cents: 6900 } },
      record_staff_dashboard_refund: { data: recorded },
    });
    expect((await POST(request(dashboard))).status).toBe(200);
    expect(ozow.get).not.toHaveBeenCalled();
    expect(calls("record_staff_dashboard_refund")[0][1]).toMatchObject({ p_ozow_fact: null });
  });
});

describe("while refunds through Ozow are switched off", () => {
  it("still closes a refund that never reached Ozow", async () => {
    answer({
      close_staff_ozow_refund: {
        data: { request_id: requestId, status: "failed", repeated: false },
      },
    });
    const response = await POST(
      request({ action: "refund.close", requestId, reason: "Never reached Ozow" })
    );
    expect(response.status).toBe(200);
    expect(calls("close_staff_ozow_refund")).toHaveLength(1);
  });

  it("neither asks for nor approves a refund through Ozow", async () => {
    answer({
      get_staff_refund_context: {
        data: {
          channel: "api",
          status: "awaiting_approval",
          ozow_checked: false,
          ozow_missing: false,
        },
      },
    });
    const asked = await POST(
      request({ ...dashboard, action: "refund.request", ozowRefundId: undefined })
    );
    expect(asked.status).toBe(404);
    const approved = await POST(request({ action: "refund.approve", requestId }));
    expect(approved.status).toBe(409);
    expect(calls("request_staff_ozow_refund")).toHaveLength(0);
    expect(calls("approve_staff_payment_refund")).toHaveLength(0);
  });

  it("approves a dashboard refund only once Ozow's status was read", async () => {
    answer({
      get_staff_refund_context: {
        data: {
          channel: "dashboard",
          status: "awaiting_approval",
          ozow_checked: false,
          ozow_missing: false,
        },
      },
    });
    expect((await POST(request({ action: "refund.approve", requestId }))).status).toBe(409);
    expect(calls("approve_staff_payment_refund")).toHaveLength(0);
  });
});
