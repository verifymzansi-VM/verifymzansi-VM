/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { openFoundationInvoiceCheckout } from "@/lib/foundation/billing-runtime";
import type * as BillingRuntime from "@/lib/foundation/billing-runtime";
import { FIXTURE_INVOICE } from "@/test/customer-invoice";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn(() => ({})) }));
vi.mock("@/lib/foundation/billing-runtime", async (original) => ({
  ...(await original<typeof BillingRuntime>()),
  openFoundationInvoiceCheckout: vi.fn(),
}));

const account = "22222222-2222-4222-8222-222222222222";
const payment = "33333333-3333-4333-8333-333333333333";
const csrf = "c".repeat(64);
const rpc = vi.fn();
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://verifymzansi.com/api/billing/invoices", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      "x-csrf-token": csrf,
      ...headers,
    },
  });
}
const pay = {
  action: "pay",
  invoiceNumber: "VM-2026-000001",
  expectedTotalCents: 62100,
  coolingOffConsent: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller: async () => ({ api: { rpc }, accountId: account, sessionId: account }),
    respond: (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});
afterEach(() => vi.unstubAllEnvs());

it("refuses a request from another site before any database call", async () => {
  const response = await POST(request(pay, { origin: "https://attacker.example" }));
  expect(response.status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

it("refuses Pay now without the cooling-off box, before any database call", async () => {
  const response = await POST(request({ ...pay, coolingOffConsent: false }));
  expect(response.status).toBe(422);
  expect(rpc).not.toHaveBeenCalled();
});

it("refuses an unknown action or a malformed number", async () => {
  expect((await POST(request({ ...pay, action: "void" }))).status).toBe(400);
  expect((await POST(request({ ...pay, invoiceNumber: "VM-1" }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it("starts the payment for the signed-in owner and answers Ozow's page", async () => {
  rpc.mockResolvedValue({
    data: {
      payment_id: payment,
      merchant_reference: "VM-2026-000001",
      amount_cents: "62100",
      currency: "ZAR",
      status: "pending",
      slots: 3,
      reused: false,
    },
    error: null,
  });
  vi.mocked(openFoundationInvoiceCheckout).mockResolvedValue({
    paymentId: payment,
    checkoutUrl: "https://pay.ozow.com/fixture",
  });
  const response = await POST(request(pay));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    success: true,
    paymentId: payment,
    checkoutUrl: "https://pay.ozow.com/fixture",
  });
  expect(openFoundationInvoiceCheckout).toHaveBeenCalledWith(
    expect.objectContaining({ payment_id: payment }),
    account,
    "https://verifymzansi.com",
    expect.anything()
  );
});

it("answers the database's refusal in plain words", async () => {
  rpc.mockResolvedValue({
    data: null,
    error: { code: "PT409", details: "invoice_billing_required", message: "add details" },
  });
  const response = await POST(request(pay));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: "Add your billing details before you pay.",
  });
  expect(openFoundationInvoiceCheckout).not.toHaveBeenCalled();
});

it("saves billing details", async () => {
  rpc.mockResolvedValue({
    data: {
      ...FIXTURE_INVOICE,
      revision: 2,
      buyer: { name: "Fixture Traders", address: "1 Example Road", registration_number: null },
      repeated: false,
    },
    error: null,
  });
  const response = await POST(
    request({
      action: "billing",
      invoiceNumber: "VM-2026-000001",
      revision: 1,
      buyerName: "Fixture Traders",
      buyerAddress: "1 Example Road",
    })
  );
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith(
    "save_my_invoice_billing",
    expect.objectContaining({ p_invoice_number: "VM-2026-000001", p_revision: 1 }),
    { get: false }
  );
});
