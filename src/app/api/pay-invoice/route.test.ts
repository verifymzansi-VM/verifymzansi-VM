/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { openFoundationInvoiceCheckout } from "@/lib/foundation/billing-runtime";
import type * as BillingRuntime from "@/lib/foundation/billing-runtime";
import { FIXTURE_INVOICE } from "@/test/customer-invoice";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("@/lib/foundation/billing-runtime", async (original) => ({
  ...(await original<typeof BillingRuntime>()),
  openFoundationInvoiceCheckout: vi.fn(),
}));

const account = "22222222-2222-4222-8222-222222222222";
const payment = "33333333-3333-4333-8333-333333333333";
const token = "fixture-payment-link-token".padEnd(43, "x");
const csrf = "c".repeat(64);
const rpc = vi.fn();
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://verifymzansi.com/api/pay-invoice", {
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
const pay = { action: "pay", token, expectedTotalCents: 62100, coolingOffConsent: true };
const billing = {
  action: "billing",
  token,
  revision: 1,
  buyerName: "Thando Trading",
  buyerAddress: "1 Main Road, Durban",
  buyerRegistrationNumber: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationServiceApi).mockReturnValue({ rpc } as never);
});
afterEach(() => vi.unstubAllEnvs());

it("refuses a request from another site or without the CSRF token before any database call", async () => {
  expect((await POST(request(pay, { origin: "https://attacker.example" }))).status).toBe(403);
  expect((await POST(request(pay, { "x-csrf-token": "d".repeat(64) }))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

it("refuses over the rate limit before any database call", async () => {
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, retryAfter: 30 });
  const response = await POST(request(pay));
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("30");
  expect(checkRateLimit).toHaveBeenCalledWith(
    expect.objectContaining({ key: "fixture", action: "billing:checkout" })
  );
  expect(rpc).not.toHaveBeenCalled();
});

it("refuses a malformed token, an invoice number, an unknown action or a large body", async () => {
  for (const body of [
    { ...pay, token: "short" },
    { ...pay, invoiceNumber: "VM-2026-000001" },
    { ...pay, action: "void" },
    { ...billing, buyerName: "x".repeat(5000) },
  ])
    expect((await POST(request(body))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it("refuses Pay now without the cooling-off box, before any database call", async () => {
  expect((await POST(request({ ...pay, coolingOffConsent: false }))).status).toBe(422);
  expect(rpc).not.toHaveBeenCalled();
});

it("saves billing details through the link and answers nothing about the invoice", async () => {
  rpc.mockResolvedValue({ data: { ...FIXTURE_INVOICE, repeated: false }, error: null });
  const response = await POST(request(billing));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(rpc).toHaveBeenCalledWith(
    "save_invoice_billing_by_link",
    expect.objectContaining({ p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/) })
  );
});

it("pays through the link: Ozow's page only, never the account or the payment", async () => {
  rpc.mockResolvedValue({
    data: {
      payment_id: payment,
      merchant_reference: "VM-2026-000001",
      amount_cents: "62100",
      currency: "ZAR",
      status: "pending",
      slots: 3,
      reused: false,
      owner_id: account,
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
    checkoutUrl: "https://pay.ozow.com/fixture",
  });
  expect(openFoundationInvoiceCheckout).toHaveBeenCalledWith(
    expect.objectContaining({ payment_id: payment }),
    account,
    "https://verifymzansi.com",
    expect.anything(),
    "/pay-invoice"
  );
});

it("answers an unknown or replaced link as not found, and an outage as unavailable", async () => {
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "PT404", details: "invoice_unavailable", message: "invoice not found" },
  });
  const missing = await POST(request(pay));
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: "We could not find that invoice." });
  rpc.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "timeout" } });
  const outage = await POST(request(billing));
  expect(outage.status).toBe(503);
  expect(await outage.json()).toMatchObject({ reference: expect.any(String) });
});
