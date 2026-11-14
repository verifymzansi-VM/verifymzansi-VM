/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import {
  cancelOzowPaymentRequest,
  createOzowHostedPayment,
  getOzowPaymentRequestStatus,
  isMockOzowEnabled,
  listOzowPaymentTransactions,
  type NormalizedOzowWebhook,
} from "../payments/ozow";
import {
  applyFoundationOzowNotification,
  cancelFoundationPendingPayment,
  openFoundationInvoiceCheckout,
  paymentCheckFailureReason,
  readFoundationBilling,
  readFoundationMySlots,
  reconcileFoundationPayment,
  runFoundationPaymentReconciliation,
  startFoundationCheckout,
  startFoundationSlotCheckout,
  startFoundationSlotRenewalCheckout,
} from "./billing-runtime";
const logged = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../utils/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), ...logged }),
}));
vi.mock("../config/env", () => ({ env: (name: string) => process.env[name] }));
vi.mock("../payments/ozow", () => ({
  cancelOzowPaymentRequest: vi.fn(),
  createOzowHostedPayment: vi.fn(),
  getOzowPaymentRequestStatus: vi.fn(),
  isMockOzowEnabled: vi.fn(),
  listOzowPaymentTransactions: vi.fn(),
  MOCK_OZOW_REQUEST_PREFIX: "mock-",
  toOzowMerchantReference: (id: string) => id.replaceAll("-", ""),
}));
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const owner = uuid(1),
  product = uuid(2),
  payment = uuid(3),
  requestId = uuid(4),
  transactionId = uuid(5);
const claim = uuid(6),
  idempotency = uuid(7),
  correlation = uuid(8);
const checkoutUrl = "https://one.ozow.com/checkout/synthetic";
const quote = {
  payment_id: payment,
  merchant_reference: "a".repeat(32),
  amount_cents: "5000",
  currency: "ZAR",
  status: "pending",
};
const paymentDto = () => ({
  id: payment,
  owner_id: owner,
  product_kind: "plan",
  product_id: product,
  target_post_id: null,
  amount_cents: "5000",
  currency: "ZAR",
  status: "pending",
  fulfillment_status: "unfulfilled",
  merchant_reference: quote.merchant_reference,
  provider_request_id: requestId,
  provider_transaction_id: null,
  checkout_url: null,
  checkout_expires_at: "2030-01-01T00:00:00Z",
  created_at: "2026-10-25T00:00:00Z",
  label: "Synthetic prepaid plan",
});
const claimDto = () => ({
  ...paymentDto(),
  provider_request_id: null,
  claim_token: claim,
  idempotency_key: idempotency,
  correlation_id: correlation,
});
const notification = (): NormalizedOzowWebhook => ({
  eventType: "transaction.complete",
  merchantReference: quote.merchant_reference,
  providerPaymentId: requestId,
  transactionId,
  siteCode: "synthetic-site",
  isTest: false,
  format: "full",
  status: "Successful",
  amount: "50.00",
  currencyCode: "ZAR",
  rawPayload: {},
});
const rpc = vi.fn(),
  machine = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const service = { rpc: machine } as unknown as FoundationServiceApi;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OZOW_SITE_CODE", "synthetic-site");
  vi.stubEnv("OZOW_ENV", "production");
  rpc.mockImplementation(async (name) => ({
    data:
      name === "start_checkout"
        ? quote
        : name === "get_my_billing"
          ? { payments: [], invoices: [], entitlements: [] }
          : paymentDto(),
    error: null,
  }));
  machine.mockImplementation(async (name) => ({
    data:
      name === "claim_checkout_request"
        ? claimDto()
        : ["get_checkout_payment", "claim_payment_reconciliation"].includes(name)
          ? paymentDto()
          : name === "apply_provider_event"
            ? { outcome: "fulfilled" }
            : true,
    error: null,
  }));
  vi.mocked(createOzowHostedPayment).mockResolvedValue({
    providerPaymentId: requestId,
    providerReference: quote.merchant_reference,
    redirectUrl: checkoutUrl,
    expireAt: "2030-01-01T00:00:00Z",
    correlationId: correlation,
    idempotencyKey: idempotency,
    rawResponse: {},
  });
  vi.mocked(listOzowPaymentTransactions).mockResolvedValue([]);
  vi.mocked(getOzowPaymentRequestStatus).mockResolvedValue("Expired");
  // Production: mock Ozow is never enabled.
  vi.mocked(isMockOzowEnabled).mockReturnValue(false);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("uses the server quote and durable provider keys, then attaches only with its claim", async () => {
  expect(
    await startFoundationCheckout(api, owner, product, null, "https://verifymzansi.com", service)
  ).toEqual({ paymentId: payment, checkoutUrl });
  expect(createOzowHostedPayment).toHaveBeenCalledExactlyOnceWith({
    paymentId: payment,
    merchantReference: quote.merchant_reference,
    amountCents: 5000,
    returnUrl: `https://verifymzansi.com/billing/success?payment=${payment}`,
    cancelUrl: `https://verifymzansi.com/billing/cancel?payment=${payment}`,
    idempotencyKey: idempotency,
    correlationId: correlation,
    expireAt: "2030-01-01T00:00:00Z",
  });
  expect(machine).toHaveBeenLastCalledWith("complete_checkout_request", {
    p_payment_id: payment,
    p_owner_id: owner,
    p_claim_token: claim,
    p_request_id: requestId,
    p_checkout_url: checkoutUrl,
  });
});
// The restored checkout page's reply for an open request (PAY-12, M3.1).
const openRequest = (change: Record<string, unknown> = {}) => ({
  ...claimDto(),
  claim_token: null,
  provider_request_id: requestId,
  checkout_url: checkoutUrl,
  ...change,
});
it("answers a plan's open request with continue, status and cancel, creating nothing", async () => {
  machine.mockResolvedValueOnce({ data: openRequest(), error: null });
  await expect(
    startFoundationCheckout(api, owner, product, null, "https://verifymzansi.com", service)
  ).rejects.toMatchObject({
    status: 409,
    code: "PENDING_PAYMENT_EXISTS",
    message:
      "You already have a pending payment for this area. Continue the payment or cancel it before choosing another plan.",
    pendingPayment: {
      id: payment,
      checkoutUrl,
      statusUrl: `https://verifymzansi.com/billing/success?payment=${payment}`,
      canCancel: true,
    },
  });
  expect(createOzowHostedPayment).not.toHaveBeenCalled();
  expect(machine.mock.calls.map(([name]) => name)).toEqual(["claim_checkout_request"]);
});
it("offers no continue link once the open request's window has passed", async () => {
  machine.mockResolvedValueOnce({
    data: openRequest({ checkout_expires_at: "2020-01-01T00:00:00Z" }),
    error: null,
  });
  await expect(
    startFoundationCheckout(api, owner, product, null, "https://verifymzansi.com", service)
  ).rejects.toMatchObject({
    status: 409,
    pendingPayment: { id: payment, checkoutUrl: null, canCancel: true },
  });
});
// A customer invoice's "Pay now" (P2b): the same request path as a checkout.
const invoiceQuote = { ...quote, merchant_reference: "VM-2026-000001", slots: 1, reused: false };
it("opens an invoice payment's Ozow request exactly as a checkout's", async () => {
  machine.mockResolvedValueOnce({
    data: { ...claimDto(), merchant_reference: "VM-2026-000001" },
    error: null,
  });
  await expect(
    openFoundationInvoiceCheckout(invoiceQuote, owner, "https://verifymzansi.com", service)
  ).resolves.toEqual({ paymentId: payment, checkoutUrl });
  expect(createOzowHostedPayment).toHaveBeenCalledWith(
    expect.objectContaining({ merchantReference: "VM-2026-000001", amountCents: 5000 })
  );
});
it("continues an invoice payment whose Ozow page is open, and waits once it has passed", async () => {
  machine.mockResolvedValueOnce({ data: openRequest(), error: null });
  await expect(
    openFoundationInvoiceCheckout(invoiceQuote, owner, "https://verifymzansi.com", service)
  ).resolves.toEqual({ paymentId: payment, checkoutUrl });
  machine.mockResolvedValueOnce({
    data: openRequest({ checkout_expires_at: "2020-01-01T00:00:00Z" }),
    error: null,
  });
  await expect(
    openFoundationInvoiceCheckout(invoiceQuote, owner, "https://verifymzansi.com", service)
  ).rejects.toMatchObject({ status: 409, code: "PAYMENT_BEING_CHECKED" });
  expect(createOzowHostedPayment).not.toHaveBeenCalled();
});
it("never opens an invoice payment of another owner or amount", async () => {
  machine.mockResolvedValueOnce({ data: { ...claimDto(), amount_cents: "4999" }, error: null });
  await expect(
    openFoundationInvoiceCheckout(invoiceQuote, owner, "https://verifymzansi.com", service)
  ).rejects.toMatchObject({ status: 503 });
  await expect(
    openFoundationInvoiceCheckout(invoiceQuote, owner, "https://attacker.example", service)
  ).rejects.toMatchObject({ status: 503 });
  expect(createOzowHostedPayment).not.toHaveBeenCalled();
});
it("never offers a provider address it would not redirect to", async () => {
  machine.mockResolvedValueOnce({
    data: openRequest({ checkout_url: "https://one.ozow.com.untrusted.invalid/" }),
    error: null,
  });
  await expect(
    startFoundationCheckout(api, owner, product, null, "https://verifymzansi.com", service)
  ).rejects.toMatchObject({ status: 503 });
});
it("offers no cancel for a mock checkout outside the test copy", async () => {
  vi.mocked(isMockOzowEnabled).mockReturnValue(true);
  machine.mockResolvedValueOnce({
    data: openRequest({ provider_request_id: `mock-${payment}` }),
    error: null,
  });
  await expect(
    startFoundationCheckout(api, owner, product, null, "https://verifymzansi.com", service)
  ).rejects.toMatchObject({ status: 409, pendingPayment: { canCancel: false } });
});
// PAY-03 (M3.1): after a failed first call, the database gives the next lease a
// fresh window and key; the website sends exactly what the lease returned.
it("sends a retried lease's own window and key to the provider", async () => {
  const retried = {
    ...claimDto(),
    checkout_expires_at: "2031-02-03T04:05:06Z",
    idempotency_key: uuid(11),
  };
  machine.mockResolvedValueOnce({ data: retried, error: null });
  await startFoundationCheckout(api, owner, product, null, "https://verifymzansi.com", service);
  expect(createOzowHostedPayment).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: uuid(11), expireAt: "2031-02-03T04:05:06Z" })
  );
});
it.each([{ owner_id: uuid(9) }, { amount_cents: "1" }])(
  "refuses an owner/quote mismatch before contacting the provider",
  async (change) => {
    machine.mockResolvedValueOnce({ data: { ...claimDto(), ...change }, error: null });
    await expect(
      startFoundationCheckout(api, owner, product, null, "https://verifymzansi.com", service)
    ).rejects.toMatchObject({ status: 503 });
    expect(createOzowHostedPayment).not.toHaveBeenCalled();
  }
);
it("rejects an unapproved provider URL without attaching it", async () => {
  vi.mocked(createOzowHostedPayment).mockResolvedValueOnce({
    providerPaymentId: requestId,
    providerReference: quote.merchant_reference,
    redirectUrl: "https://one.ozow.com.untrusted.invalid/",
    expireAt: "2030-01-01T00:00:00Z",
    correlationId: correlation,
    idempotencyKey: idempotency,
    rawResponse: {},
  });
  await expect(
    startFoundationCheckout(api, owner, product, null, "https://verifymzansi.com", service)
  ).rejects.toMatchObject({ status: 503 });
  expect(machine.mock.calls.some(([name]) => name === "complete_checkout_request")).toBe(false);
});
it("passes validated confirmation facts to the atomic native settlement command", async () => {
  await applyFoundationOzowNotification(
    notification(),
    "synthetic signed notification bytes",
    service
  );
  expect(machine).toHaveBeenLastCalledWith("apply_provider_event", {
    p_event: {
      payload_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      merchant_reference: quote.merchant_reference,
      provider_request_id: requestId,
      provider_transaction_id: transactionId,
      status: "complete",
      amount_cents: 5000,
      currency: "ZAR",
    },
  });
});
// A correctly signed notice that can never apply is refused with its reason
// and acknowledged, not retried (PAY-08).
it.each([
  [{ amount: "0.01" }, "amount_mismatch"],
  [{ currencyCode: "USD" }, "currency_mismatch"],
  [{ siteCode: "wrong-site" }, "site_code_mismatch"],
  [{ providerPaymentId: uuid(9) }, "payment_id_mismatch"],
  [{ isTest: true }, "test_mode_mismatch"],
  [{ isTest: true, format: "api" as const }, "test_mode_mismatch"],
  [{ isTest: null }, "test_mode_mismatch"],
])("does not settle inconsistent provider evidence %j", async (change, rejected) => {
  expect(
    await applyFoundationOzowNotification(
      { ...notification(), ...change },
      "signed mismatch",
      service
    )
  ).toEqual({ success: true, rejected });
  expect(machine.mock.calls.some(([name]) => name === "apply_provider_event")).toBe(false);
});
it("refuses an unknown merchant reference without creating a payment", async () => {
  machine.mockResolvedValueOnce({ data: null, error: null });
  expect(await applyFoundationOzowNotification(notification(), "signed unknown", service)).toEqual({
    success: true,
    rejected: "unknown_payment",
  });
  // Only kept as a problem with no payment, for the daily summary.
  expect(machine.mock.calls).toEqual([
    [
      "get_checkout_payment",
      { p_payment_id: null, p_merchant_reference: quote.merchant_reference },
    ],
    [
      "record_payment_problem",
      {
        p_payment_id: null,
        p_reason: "unknown_payment",
        p_source: "notice",
        p_alert: false,
        p_transaction: transactionId,
      },
    ],
  ]);
});
it("asks for the notice again while its payment has no stored request", async () => {
  machine.mockResolvedValueOnce({
    data: { ...paymentDto(), provider_request_id: null },
    error: null,
  });
  await expect(
    applyFoundationOzowNotification(notification(), "signed early", service)
  ).rejects.toMatchObject({ status: 503 });
  expect(machine).toHaveBeenCalledTimes(1);
});
it("does not reconcile a payment whose persisted claim was not obtained", async () => {
  machine.mockResolvedValueOnce({ data: null, error: null });
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: false,
    pendingTransaction: false,
  });
  expect(listOzowPaymentTransactions).not.toHaveBeenCalled();
});
it("expires a stored checkout only after an authoritative expired request with no bank attempt", async () => {
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: true,
    pendingTransaction: false,
    closed: true,
  });
  expect(machine).toHaveBeenLastCalledWith("finish_unpaid_checkout", {
    p_payment_id: payment,
    p_status: "expired",
  });
});
it("records a declined or cancelled bank attempt as not paid once its request is closed", async () => {
  vi.mocked(listOzowPaymentTransactions).mockResolvedValue([
    { ...notification(), status: "Error" },
  ]);
  machine.mockImplementation(async (name) => ({
    data:
      name === "claim_payment_reconciliation"
        ? paymentDto()
        : { outcome: "not_paid", payment_id: payment },
    error: null,
  }));
  for (const request of ["Expired", "Cancelled"]) {
    machine.mockClear();
    vi.mocked(getOzowPaymentRequestStatus).mockResolvedValueOnce(request);
    expect(await reconcileFoundationPayment(payment, service)).toEqual({
      checked: true,
      pendingTransaction: false,
      closed: true,
    });
    expect(machine).toHaveBeenLastCalledWith("apply_provider_event", {
      p_event: expect.objectContaining({ status: "error", provider_transaction_id: transactionId }),
    });
    expect(machine.mock.calls.some(([name]) => name === "finish_unpaid_checkout")).toBe(false);
  }
});
it("leaves a declined attempt pending while its request can still be paid", async () => {
  vi.mocked(listOzowPaymentTransactions).mockResolvedValue([
    { ...notification(), status: "Error" },
  ]);
  vi.mocked(getOzowPaymentRequestStatus).mockResolvedValueOnce("Created");
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: true,
    pendingTransaction: false,
  });
  expect(machine.mock.calls.map(([name]) => name)).toEqual(["claim_payment_reconciliation"]);
});
it("reports not closed when the attempt was not recorded as not paid", async () => {
  vi.mocked(listOzowPaymentTransactions).mockResolvedValue([
    { ...notification(), status: "Error" },
  ]);
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: true,
    pendingTransaction: false,
    closed: false,
  });
});
it.each(["Pending", "Incomplete", "Refunded"])(
  "treats a transaction status of %j next to a declined one as not final",
  async (status) => {
    vi.mocked(listOzowPaymentTransactions).mockResolvedValue([
      { ...notification(), status: "Error" },
      { ...notification(), format: "api", isTest: null, transactionId: uuid(13), status },
    ]);
    expect(await reconcileFoundationPayment(payment, service)).toEqual({
      checked: true,
      pendingTransaction: true,
    });
    expect(getOzowPaymentRequestStatus).not.toHaveBeenCalled();
    expect(machine.mock.calls.map(([name]) => name)).toEqual(["claim_payment_reconciliation"]);
  }
);
it("leaves a payment pending while any attempt is still pending", async () => {
  vi.mocked(listOzowPaymentTransactions).mockResolvedValue([
    { ...notification(), status: "Error" },
    { ...notification(), transactionId: uuid(12), status: "Pending" },
  ]);
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: true,
    pendingTransaction: true,
  });
  expect(machine.mock.calls.map(([name]) => name)).toEqual(["claim_payment_reconciliation"]);
});
it("does not record an attempt again once the payment is no longer pending", async () => {
  machine.mockResolvedValueOnce({ data: { ...paymentDto(), status: "failed" }, error: null });
  vi.mocked(listOzowPaymentTransactions).mockResolvedValue([
    { ...notification(), status: "Error" },
  ]);
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: true,
    pendingTransaction: false,
  });
  expect(machine.mock.calls.map(([name]) => name)).toEqual(["claim_payment_reconciliation"]);
});
it.each(["PendingInvestigation", "Abandoned", ""])(
  "refuses an unknown transaction status %j and closes nothing",
  async (status) => {
    vi.mocked(listOzowPaymentTransactions).mockResolvedValue([
      { ...notification(), status: "Error" },
      { ...notification(), transactionId: uuid(13), status },
    ]);
    await expect(reconcileFoundationPayment(payment, service)).rejects.toMatchObject({
      status: 503,
      reason: "unsupported_transaction_status",
    });
    expect(machine.mock.calls.map(([name]) => name)).toEqual([
      "claim_payment_reconciliation",
      "record_payment_problem",
    ]);
  }
);
it("closes a pending payment whose request was cancelled elsewhere as expired", async () => {
  vi.mocked(getOzowPaymentRequestStatus).mockResolvedValueOnce("Cancelled");
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: true,
    pendingTransaction: false,
    closed: true,
  });
  // Expired, not cancelled: a verified late success still delivers the plan.
  expect(machine).toHaveBeenLastCalledWith("finish_unpaid_checkout", {
    p_payment_id: payment,
    p_status: "expired",
  });
});
it("leaves an open request with no attempt pending", async () => {
  vi.mocked(getOzowPaymentRequestStatus).mockResolvedValueOnce("Created");
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: true,
    pendingTransaction: false,
  });
  expect(machine.mock.calls.map(([name]) => name)).toEqual(["claim_payment_reconciliation"]);
});
it("a member's cancel succeeds when the status check already closed the payment", async () => {
  vi.mocked(getOzowPaymentRequestStatus).mockResolvedValueOnce("Cancelled");
  expect(await cancelFoundationPendingPayment(api, payment, service)).toEqual({ success: true });
  expect(cancelOzowPaymentRequest).toHaveBeenCalledExactlyOnceWith(requestId);
  expect(machine.mock.calls.filter(([name]) => name === "finish_unpaid_checkout")).toEqual([
    ["finish_unpaid_checkout", { p_payment_id: payment, p_status: "cancelled" }],
  ]);
});
it("preserves a concurrent bank settlement when cancellation races it", async () => {
  vi.mocked(listOzowPaymentTransactions).mockResolvedValue([notification()]);
  await expect(cancelFoundationPendingPayment(api, payment, service)).rejects.toMatchObject({
    status: 409,
  });
  expect(cancelOzowPaymentRequest).toHaveBeenCalledWith(requestId);
  expect(machine.mock.calls.some(([name]) => name === "apply_provider_event")).toBe(true);
  expect(machine.mock.calls.some(([name]) => name === "finish_unpaid_checkout")).toBe(false);
});
// Mock checkouts (test copies only) never reach the provider (M0.8).
it("does not claim or ask the provider while mock Ozow is enabled", async () => {
  vi.mocked(isMockOzowEnabled).mockReturnValue(true);
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: false,
    pendingTransaction: false,
  });
  expect(machine).not.toHaveBeenCalled();
  expect(listOzowPaymentTransactions).not.toHaveBeenCalled();
  expect(getOzowPaymentRequestStatus).not.toHaveBeenCalled();
});
it("never sends a mock checkout's request id to the provider", async () => {
  machine.mockResolvedValueOnce({
    data: { ...paymentDto(), provider_request_id: `mock-${payment}` },
    error: null,
  });
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: false,
    pendingTransaction: false,
  });
  expect(listOzowPaymentTransactions).not.toHaveBeenCalled();
  expect(getOzowPaymentRequestStatus).not.toHaveBeenCalled();
  expect(machine.mock.calls.some(([name]) => name === "finish_unpaid_checkout")).toBe(false);
});
it("refuses to cancel while mock Ozow is enabled, without a provider call", async () => {
  vi.mocked(isMockOzowEnabled).mockReturnValue(true);
  await expect(cancelFoundationPendingPayment(api, payment, service)).rejects.toMatchObject({
    status: 409,
  });
  expect(cancelOzowPaymentRequest).not.toHaveBeenCalled();
  expect(machine).not.toHaveBeenCalled();
});
it("refuses to cancel a mock checkout, without a provider call", async () => {
  rpc.mockResolvedValueOnce({
    data: { ...paymentDto(), provider_request_id: `mock-${payment}` },
    error: null,
  });
  await expect(cancelFoundationPendingPayment(api, payment, service)).rejects.toMatchObject({
    status: 409,
  });
  expect(cancelOzowPaymentRequest).not.toHaveBeenCalled();
  expect(machine).not.toHaveBeenCalled();
});
it("with mock Ozow off, cancels a real checkout through the provider as before", async () => {
  vi.mocked(getOzowPaymentRequestStatus).mockResolvedValueOnce("Created");
  expect(await cancelFoundationPendingPayment(api, payment, service)).toEqual({ success: true });
  expect(cancelOzowPaymentRequest).toHaveBeenCalledExactlyOnceWith(requestId);
  expect(listOzowPaymentTransactions).toHaveBeenCalledOnce();
  expect(machine).toHaveBeenLastCalledWith("finish_unpaid_checkout", {
    p_payment_id: payment,
    p_status: "cancelled",
  });
});
// In the private test copy only, mock checkouts are asked about at the copy's
// loopback stand-in (src/lib/payments/ozow.ts), so its status check can settle
// them (M0.9c). Production settings keep the rules above.
const COPY_ENV: Record<string, string> = {
  NODE_ENV: "production",
  ENVIRONMENT: "test",
  VERIFYMZANSI_RUNTIME_MODE: "e2e",
  PLAYWRIGHT_TEST_MODE: "1",
  ENABLE_MOCK_OZOW: "true",
  OZOW_ENV: "staging",
  FOUNDATION_PROJECT_REF: "local-foundation",
  FOUNDATION_SUPABASE_URL: "http://127.0.0.1:55443",
};
function stubSettings(values: Record<string, string | undefined>) {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("document", undefined);
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}
const mockRequest = `mock-${payment}`;
const mockCheckout = () => ({ ...paymentDto(), provider_request_id: mockRequest });
const standInTransaction = (): NormalizedOzowWebhook => ({
  eventType: "transaction.complete",
  merchantReference: quote.merchant_reference,
  providerPaymentId: mockRequest,
  transactionId,
  siteCode: "synthetic-site",
  isTest: null,
  format: "api",
  status: "Successful",
  amount: "50",
  currencyCode: "ZAR",
  rawPayload: {},
});
it("in the test copy, settles a mock checkout from the stand-in's transaction", async () => {
  stubSettings(COPY_ENV);
  vi.mocked(isMockOzowEnabled).mockReturnValue(true);
  machine.mockResolvedValueOnce({ data: mockCheckout(), error: null });
  vi.mocked(listOzowPaymentTransactions).mockResolvedValueOnce([standInTransaction()]);
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: true,
    pendingTransaction: false,
    settled: true,
  });
  expect(listOzowPaymentTransactions).toHaveBeenCalledExactlyOnceWith(
    mockRequest,
    paymentDto().created_at
  );
  expect(machine).toHaveBeenLastCalledWith("apply_provider_event", {
    p_event: expect.objectContaining({
      merchant_reference: quote.merchant_reference,
      provider_request_id: mockRequest,
      provider_transaction_id: transactionId,
      status: "complete",
      amount_cents: 5000,
    }),
  });
});
it("in the test copy, leaves an open mock checkout with no transaction pending", async () => {
  stubSettings(COPY_ENV);
  vi.mocked(isMockOzowEnabled).mockReturnValue(true);
  machine.mockResolvedValueOnce({ data: mockCheckout(), error: null });
  vi.mocked(getOzowPaymentRequestStatus).mockResolvedValueOnce("Created");
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: true,
    pendingTransaction: false,
  });
  expect(getOzowPaymentRequestStatus).toHaveBeenCalledExactlyOnceWith(mockRequest);
  expect(machine.mock.calls.map(([name]) => name)).toEqual(["claim_payment_reconciliation"]);
});
it("in the test copy, never asks about a real request id", async () => {
  stubSettings(COPY_ENV);
  vi.mocked(isMockOzowEnabled).mockReturnValue(true);
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: false,
    pendingTransaction: false,
  });
  expect(listOzowPaymentTransactions).not.toHaveBeenCalled();
  expect(getOzowPaymentRequestStatus).not.toHaveBeenCalled();
  expect(machine.mock.calls.map(([name]) => name)).toEqual(["claim_payment_reconciliation"]);
});
it("in the test copy, the status-check job settles a mock checkout", async () => {
  stubSettings(COPY_ENV);
  vi.mocked(isMockOzowEnabled).mockReturnValue(true);
  machine
    .mockResolvedValueOnce({ data: 0, error: null })
    .mockResolvedValueOnce({ data: [mockCheckout()], error: null })
    .mockResolvedValueOnce({ data: mockCheckout(), error: null });
  vi.mocked(listOzowPaymentTransactions).mockResolvedValueOnce([standInTransaction()]);
  expect(await runFoundationPaymentReconciliation(service)).toEqual({
    checked: 1,
    failures: 0,
    expired: 0,
    errors: [],
  });
  expect(machine.mock.calls.map(([name]) => name)).toEqual([
    "expire_stale_checkouts",
    "list_reconcilable_payments",
    "claim_payment_reconciliation",
    "apply_provider_event",
  ]);
});
it("in the test copy, cancels a mock checkout at the stand-in", async () => {
  stubSettings(COPY_ENV);
  vi.mocked(isMockOzowEnabled).mockReturnValue(true);
  rpc.mockResolvedValueOnce({ data: mockCheckout(), error: null });
  machine.mockResolvedValueOnce({ data: mockCheckout(), error: null });
  vi.mocked(getOzowPaymentRequestStatus).mockResolvedValueOnce("Cancelled");
  expect(await cancelFoundationPendingPayment(api, payment, service)).toEqual({ success: true });
  expect(cancelOzowPaymentRequest).toHaveBeenCalledExactlyOnceWith(mockRequest);
  expect(machine).toHaveBeenLastCalledWith("finish_unpaid_checkout", {
    p_payment_id: payment,
    p_status: "cancelled",
  });
});
it("the status-check job first closes payments that never got a request", async () => {
  machine
    .mockResolvedValueOnce({ data: 3, error: null })
    .mockResolvedValueOnce({ data: [], error: null });
  expect(await runFoundationPaymentReconciliation(service)).toEqual({
    checked: 0,
    failures: 0,
    expired: 3,
    errors: [],
  });
  expect(machine.mock.calls).toEqual([
    ["expire_stale_checkouts", { p_limit: 100 }],
    ["list_reconcilable_payments", { p_limit: 20 }],
  ]);
});
it("a failed sweep is reported and the status checks still run", async () => {
  machine
    .mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } })
    .mockResolvedValueOnce({ data: [paymentDto()], error: null });
  vi.mocked(getOzowPaymentRequestStatus).mockResolvedValueOnce("Created");
  expect(await runFoundationPaymentReconciliation(service)).toEqual({
    checked: 1,
    failures: 1,
    expired: 0,
    errors: [{ paymentId: null, reason: "database_unavailable" }],
  });
  expect(logged.error).toHaveBeenCalledWith("Payment status check failed", {
    paymentId: null,
    reason: "database_unavailable",
  });
});
it("with the copy's settings but mock Ozow off, reconciles exactly as production", async () => {
  stubSettings(COPY_ENV);
  machine.mockResolvedValueOnce({ data: mockCheckout(), error: null });
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: false,
    pendingTransaction: false,
  });
  expect(listOzowPaymentTransactions).not.toHaveBeenCalled();
  // A real request is asked about at the provider, as before.
  expect(await reconcileFoundationPayment(payment, service)).toMatchObject({ checked: true });
  expect(listOzowPaymentTransactions).toHaveBeenCalledExactlyOnceWith(
    requestId,
    paymentDto().created_at
  );
});
it("with production settings and every test switch leaked in, mock mode still asks nothing", async () => {
  const toml = parse(readFileSync("wrangler.toml", "utf8")) as {
    env: { production: { vars: Record<string, string> } };
  };
  stubSettings({
    ...toml.env.production.vars,
    OZOW_ENV: "production",
    VERIFYMZANSI_RUNTIME_MODE: "e2e",
    PLAYWRIGHT_TEST_MODE: "1",
    ENABLE_MOCK_OZOW: "true",
  });
  vi.mocked(isMockOzowEnabled).mockReturnValue(true);
  machine.mockResolvedValue({ data: mockCheckout(), error: null });
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: false,
    pendingTransaction: false,
  });
  expect(machine).not.toHaveBeenCalled();
  expect(listOzowPaymentTransactions).not.toHaveBeenCalled();
});
it("parses only the caller's bounded billing projection", async () => {
  expect(await readFoundationBilling(api)).toEqual({
    payments: [],
    invoices: [],
    entitlements: [],
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_billing", {});
});

// Paid add-on sales are paused unless switched on (../billing/addon-sales.ts).
const post = uuid(10);
const addonPaused = {
  status: 403,
  message: "Add-ons open soon. You have not been charged.",
  code: "addon_sales_paused",
};
const addonClaim = () => ({ ...claimDto(), product_kind: "addon", target_post_id: post });
const addonCheckout = (target: string | null = post) =>
  startFoundationCheckout(api, owner, product, target, "https://verifymzansi.com", service);
it("refuses an add-on before its quote while add-on sales are paused", async () => {
  await expect(addonCheckout()).rejects.toMatchObject(addonPaused);
  expect(rpc).not.toHaveBeenCalled();
  expect(machine).not.toHaveBeenCalled();
  expect(createOzowHostedPayment).not.toHaveBeenCalled();
});
it.each(["", "false", "TRUE", "1", "yes", " true"])(
  "keeps add-ons paused when the switch is %j",
  async (value) => {
    vi.stubEnv("ADDON_SALES_ENABLED", value);
    await expect(addonCheckout()).rejects.toMatchObject(addonPaused);
    expect(rpc).not.toHaveBeenCalled();
    expect(createOzowHostedPayment).not.toHaveBeenCalled();
  }
);
it("never sends an add-on payment to the provider while paused, whatever the quote was for", async () => {
  machine.mockResolvedValueOnce({ data: addonClaim(), error: null });
  await expect(addonCheckout(null)).rejects.toMatchObject(addonPaused);
  expect(createOzowHostedPayment).not.toHaveBeenCalled();
  expect(machine.mock.calls.map(([name]) => name)).toEqual(["claim_checkout_request"]);
});
it("never hands back a stored add-on checkout address while paused", async () => {
  machine.mockResolvedValueOnce({
    data: { ...addonClaim(), claim_token: null, checkout_url: checkoutUrl },
    error: null,
  });
  await expect(addonCheckout(null)).rejects.toMatchObject(addonPaused);
  expect(createOzowHostedPayment).not.toHaveBeenCalled();
});
it("starts an add-on checkout once add-on sales are switched on", async () => {
  vi.stubEnv("ADDON_SALES_ENABLED", "true");
  machine.mockImplementationOnce(async () => ({ data: addonClaim(), error: null }));
  expect(await addonCheckout()).toEqual({ paymentId: payment, checkoutUrl });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("start_checkout", {
    p_product_id: product,
    p_target_post: post,
  });
  expect(createOzowHostedPayment).toHaveBeenCalledTimes(1);
});
it("still settles an add-on payment that already exists while sales are paused", async () => {
  machine.mockImplementation(async (name) => ({
    data:
      name === "get_checkout_payment"
        ? { ...paymentDto(), product_kind: "addon", target_post_id: post }
        : { outcome: "completed" },
    error: null,
  }));
  expect(await applyFoundationOzowNotification(notification(), "signed add-on", service)).toEqual({
    success: true,
    result: { outcome: "completed" },
  });
  expect(machine).toHaveBeenLastCalledWith(
    "apply_provider_event",
    expect.objectContaining({ p_event: expect.objectContaining({ status: "complete" }) })
  );
});
it("still reconciles an add-on payment that already exists while sales are paused", async () => {
  machine.mockImplementation(async (name) => ({
    data:
      name === "claim_payment_reconciliation"
        ? { ...paymentDto(), product_kind: "addon", target_post_id: post }
        : true,
    error: null,
  }));
  vi.mocked(listOzowPaymentTransactions).mockResolvedValue([notification()]);
  expect(await reconcileFoundationPayment(payment, service)).toEqual({
    checked: true,
    pendingTransaction: false,
    settled: true,
  });
});
it("keeps add-on sales paused with the default and production settings", () => {
  const toml = parse(readFileSync("wrangler.toml", "utf8")) as {
    vars: Record<string, string>;
    env: Record<string, { vars: Record<string, string> }>;
  };
  for (const vars of [toml.vars, toml.env.production.vars])
    expect(vars.ADDON_SALES_ENABLED).toBe("false");
});

// Payment problems: logged with the payment number and reason, kept for the
// staff alerts and the daily summary (M3.3). Recording never changes what
// happens to the payment.
describe("payment problems", () => {
  const recorded = () =>
    machine.mock.calls.filter(([name]) => name === "record_payment_problem").map(([, a]) => a);
  const problem = (
    reason: string,
    source: string,
    alert: boolean,
    transaction: string | null = transactionId
  ) => ({
    p_payment_id: payment,
    p_reason: reason,
    p_source: source,
    p_alert: alert,
    p_transaction: transaction,
  });

  it.each([
    [{ amount: "0.01" }, "amount_mismatch", true],
    [{ currencyCode: "USD" }, "currency_mismatch", true],
    [{ siteCode: "wrong-site" }, "site_code_mismatch", false],
    [{ isTest: true }, "test_mode_mismatch", false],
  ])("a refused notice %j is kept as %s (alert: %s)", async (change, reason, alert) => {
    await applyFoundationOzowNotification({ ...notification(), ...change }, "signed", service);
    expect(recorded()).toEqual([problem(reason, "notice", alert)]);
    expect(alert ? logged.error : logged.warn).toHaveBeenCalledWith("Payment problem", {
      paymentId: payment,
      reason,
      source: "notice",
      ...(alert ? { anomaly: "wrong_amount" } : {}),
    });
  });

  it.each([
    [{ amount: "0.01", status: "Error" }, "amount_mismatch"],
    [{ currencyCode: "USD", status: "Pending" }, "currency_mismatch"],
  ])(
    "a refused notice %j that moved no money is kept for the summary only",
    async (change, reason) => {
      await applyFoundationOzowNotification({ ...notification(), ...change }, "signed", service);
      expect(recorded()).toEqual([problem(reason, "notice", false)]);
    }
  );

  it.each([
    ["Successful", true],
    ["Error", false],
  ])(
    "a second transaction (%s) on a completed payment is a second payment only when successful",
    async (status, alert) => {
      machine.mockResolvedValueOnce({
        data: { ...paymentDto(), status: "complete", provider_transaction_id: uuid(8) },
        error: null,
      });
      expect(
        await applyFoundationOzowNotification({ ...notification(), status }, "signed", service)
      ).toEqual({ success: true, rejected: "transaction_id_mismatch" });
      expect(recorded()).toEqual([problem("transaction_id_mismatch", "notice", alert)]);
    }
  );

  it.each([
    ["conflicting_transaction", "Successful", "conflicting_transaction"],
    ["transaction_reused", "Successful", "transaction_reused"],
    ["complete_unfulfillable_target", "Successful", "complete_unfulfillable_target"],
  ])("a settlement outcome %s is kept for staff at once", async (outcome, status, reason) => {
    machine.mockImplementation(async (name) => ({
      data:
        name === "get_checkout_payment"
          ? paymentDto()
          : name === "apply_provider_event"
            ? { outcome, payment_id: payment }
            : { new: true, alert: true },
      error: null,
    }));
    const result = await applyFoundationOzowNotification(
      { ...notification(), status, format: "full" },
      "signed",
      service
    );
    expect(result).toEqual({ success: true, result: { outcome, payment_id: payment } });
    expect(recorded()).toEqual([problem(reason, "notice", true)]);
    expect(logged.error).not.toHaveBeenCalledWith(
      "Payment problem could not be recorded",
      expect.anything()
    );
  });

  it.each(["completed", "already_complete", "duplicate_event", "late_status_ignored"])(
    "a routine outcome %s is not a problem",
    async (outcome) => {
      machine.mockImplementation(async (name) => ({
        data: name === "get_checkout_payment" ? paymentDto() : { outcome },
        error: null,
      }));
      await applyFoundationOzowNotification(notification(), "signed", service);
      expect(recorded()).toEqual([]);
    }
  );

  it("a problem that cannot be stored is logged and changes nothing", async () => {
    machine.mockImplementation(async (name) =>
      name === "record_payment_problem"
        ? { data: null, error: { code: "PGRST202" } }
        : { data: paymentDto(), error: null }
    );
    expect(
      await applyFoundationOzowNotification({ ...notification(), amount: "0.01" }, "s", service)
    ).toEqual({ success: true, rejected: "amount_mismatch" });
    expect(logged.error).toHaveBeenCalledWith("Payment problem could not be recorded", {
      paymentId: payment,
      reason: "amount_mismatch",
      source: "notice",
      anomaly: "wrong_amount",
    });
  });

  it("a recording call that throws changes nothing either", async () => {
    machine.mockImplementation(async (name) => {
      if (name === "record_payment_problem") throw new Error("PRIVATE_NETWORK_DETAIL");
      return { data: paymentDto(), error: null };
    });
    expect(
      await applyFoundationOzowNotification({ ...notification(), siteCode: "x" }, "s", service)
    ).toEqual({ success: true, rejected: "site_code_mismatch" });
    expect(JSON.stringify(logged.error.mock.calls)).not.toContain("PRIVATE");
  });

  it("the status check keeps a wrong amount and reports its reason", async () => {
    vi.mocked(listOzowPaymentTransactions).mockResolvedValue([
      { ...notification(), format: "api", isTest: null, amount: "49.99" },
    ]);
    const failure = await reconcileFoundationPayment(payment, service).catch((e) => e);
    expect(failure).toMatchObject({ status: 503, reason: "amount_mismatch" });
    expect(failure.message).toBe("Payment reconciliation did not match its stored quote");
    expect(paymentCheckFailureReason(failure)).toBe("amount_mismatch");
    expect(recorded()).toEqual([problem("amount_mismatch", "status_check", true)]);
    expect(machine.mock.calls.some(([name]) => name === "apply_provider_event")).toBe(false);
  });

  it("the status check keeps two successful transactions as paid twice and settles neither", async () => {
    vi.mocked(listOzowPaymentTransactions).mockResolvedValue([
      { ...notification(), format: "api", isTest: null },
      { ...notification(), format: "api", isTest: null, transactionId: uuid(14) },
    ]);
    await expect(reconcileFoundationPayment(payment, service)).rejects.toMatchObject({
      status: 503,
      reason: "multiple_settlements",
      message: "Multiple payment settlements require reconciliation",
    });
    // The key is the set of successful transactions, so a third one alerts again.
    expect(recorded()).toEqual([
      problem(
        "multiple_settlements",
        "status_check",
        true,
        [transactionId, uuid(14)].sort().join(",")
      ),
    ]);
    expect(machine.mock.calls.some(([name]) => name === "apply_provider_event")).toBe(false);
  });

  it("the status check keeps a payment received for something it could not activate", async () => {
    vi.mocked(listOzowPaymentTransactions).mockResolvedValue([
      { ...notification(), format: "api", isTest: null },
    ]);
    machine.mockImplementation(async (name) => ({
      data:
        name === "claim_payment_reconciliation"
          ? paymentDto()
          : name === "apply_provider_event"
            ? { outcome: "complete_unfulfillable_target", payment_id: payment }
            : { new: true, alert: true },
      error: null,
    }));
    expect(await reconcileFoundationPayment(payment, service)).toEqual({
      checked: true,
      pendingTransaction: false,
      settled: true,
    });
    expect(recorded()).toEqual([problem("complete_unfulfillable_target", "status_check", true)]);
  });

  it("the status-check job lists every failed payment with its reason and checks the rest", async () => {
    const [a, b, c, d] = [uuid(21), uuid(22), uuid(23), uuid(24)];
    const listed = [a, b, c, d].map((id) => ({ ...paymentDto(), id }));
    machine.mockImplementation(async (name, args) => {
      if (name === "expire_stale_checkouts") return { data: 0, error: null };
      if (name === "list_reconcilable_payments") return { data: listed, error: null };
      if (name === "claim_payment_reconciliation")
        return args.p_payment_id === c
          ? { data: null, error: { code: "57P01" } }
          : { data: { ...paymentDto(), id: args.p_payment_id }, error: null };
      return { data: { new: true, alert: true }, error: null };
    });
    vi.mocked(listOzowPaymentTransactions).mockImplementation(async () => {
      const call = vi.mocked(listOzowPaymentTransactions).mock.calls.length;
      if (call === 1) return [{ ...notification(), format: "api", isTest: null, amount: "1.00" }];
      if (call === 2)
        return [
          { ...notification(), format: "api", isTest: null },
          { ...notification(), format: "api", isTest: null, transactionId: uuid(15) },
        ];
      const error = new Error("Ozow payment lookup or cancellation failed");
      error.name = "OzowProviderError";
      throw error;
    });
    expect(await runFoundationPaymentReconciliation(service)).toEqual({
      checked: 0,
      failures: 4,
      expired: 0,
      errors: [
        { paymentId: a, reason: "amount_mismatch" },
        { paymentId: b, reason: "multiple_settlements" },
        { paymentId: c, reason: "database_unavailable" },
        { paymentId: d, reason: "provider_unavailable" },
      ],
    });
    for (const [paymentId, reason] of [
      [a, "amount_mismatch"],
      [d, "provider_unavailable"],
    ])
      expect(logged.error).toHaveBeenCalledWith("Payment status check failed", {
        paymentId,
        reason,
      });
    // The error text never reaches the job's report or the log.
    expect(JSON.stringify(logged.error.mock.calls)).not.toContain("lookup or cancellation");
  });

  it.each([
    [new TypeError("fetch failed"), "network_error"],
    [Object.assign(new Error("x"), { name: "OzowAuthenticationError" }), "provider_sign_in_failed"],
    [Object.assign(new Error("x"), { name: "OzowConfigurationError" }), "provider_settings"],
    [new Error("anything"), "unexpected_error"],
    ["not an error", "unexpected_error"],
  ])("names a status-check failure by its kind only: %s", (error, reason) => {
    expect(paymentCheckFailureReason(error)).toBe(reason);
  });
});

describe("the Individual slot checkout", () => {
  const order = { planId: product, slots: 3, expectedTotalCents: 20700, coolingOffConsent: true };
  const slotCheckout = (value: Record<string, unknown> = order) =>
    startFoundationSlotCheckout(
      api,
      owner,
      value as typeof order,
      "https://verifymzansi.com",
      service
    );
  it("quotes the slots with the total shown and the consent, then opens Ozow for that total", async () => {
    rpc.mockResolvedValueOnce({ data: { ...quote, amount_cents: "20700" }, error: null });
    machine.mockImplementationOnce(async () => ({
      data: { ...claimDto(), amount_cents: "20700" },
      error: null,
    }));
    expect(await slotCheckout()).toEqual({ paymentId: payment, checkoutUrl });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("start_slot_checkout", {
      p_plan_id: product,
      p_slots: 3,
      p_expected_total_cents: 20700,
      p_cooling_off_consent: true,
    });
    expect(createOzowHostedPayment).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ paymentId: payment, amountCents: 20700 })
    );
  });
  it.each([
    ["without the consent", { ...order, coolingOffConsent: false }],
    ["with no slots", { ...order, slots: 0 }],
    ["with more slots than one order holds", { ...order, slots: 26 }],
    ["with a total that is not whole cents", { ...order, expectedTotalCents: 207.5 }],
  ])("refuses an order %s before any command", async (_label, value) => {
    await expect(slotCheckout(value)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    expect(createOzowHostedPayment).not.toHaveBeenCalled();
  });
  it.each([
    ["PT412", 403, "ID_REVIEW_REQUIRED", /ID review must be accepted/],
    ["PT413", 400, "INVOICE_REQUIRED", /above R10,000 are paid by invoice/],
    ["PT428", 409, "PRICE_CHANGED", /price changed/],
    ["PT429", 409, "SLOT_LIMIT_REACHED", /most Individual slots you can hold at once/],
  ])("tells the member why the database refused (%s)", async (sqlstate, status, code, message) => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: sqlstate } });
    const refused = slotCheckout();
    await expect(refused).rejects.toMatchObject({ status, code });
    await expect(refused).rejects.toThrow(message);
    expect(machine).not.toHaveBeenCalled();
  });
  it("names the unpaid order when a slot payment is already open at Ozow", async () => {
    rpc.mockResolvedValueOnce({
      data: { ...quote, amount_cents: "20700", slots: 3 },
      error: null,
    });
    machine.mockResolvedValueOnce({
      data: { ...openRequest(), amount_cents: "20700" },
      error: null,
    });
    await expect(
      slotCheckout({ ...order, slots: 2, expectedTotalCents: 13800 })
    ).rejects.toMatchObject({
      status: 409,
      code: "PENDING_PAYMENT_EXISTS",
      pendingPayment: { id: payment, slots: 3, amountCents: 20700 },
    });
    expect(createOzowHostedPayment).not.toHaveBeenCalled();
  });
  it("keeps any other refusal generic", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    await expect(slotCheckout()).rejects.toMatchObject({ status: 400, code: undefined });
  });
});

describe("renewing slots early (P3)", () => {
  const order = {
    planId: product,
    entitlementIds: [uuid(30), uuid(31)],
    expectedTotalCents: 13800,
    coolingOffConsent: true,
  };
  const renewal = (value: Record<string, unknown> = order) =>
    startFoundationSlotRenewalCheckout(
      api,
      owner,
      value as typeof order,
      "https://verifymzansi.com",
      service
    );
  it("quotes the renewal of the chosen slots with the total shown, then opens Ozow", async () => {
    rpc.mockResolvedValueOnce({
      data: { ...quote, amount_cents: "13800", slots: 2, renewal: true },
      error: null,
    });
    machine.mockImplementationOnce(async () => ({
      data: { ...claimDto(), amount_cents: "13800" },
      error: null,
    }));
    expect(await renewal()).toEqual({ paymentId: payment, checkoutUrl });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("start_slot_renewal_checkout", {
      p_entitlement_ids: [uuid(30), uuid(31)],
      p_plan_id: product,
      p_expected_total_cents: 13800,
      p_cooling_off_consent: true,
    });
  });
  it.each([
    ["without the consent", { ...order, coolingOffConsent: false }],
    ["with no slot", { ...order, entitlementIds: [] }],
    ["with the same slot twice", { ...order, entitlementIds: [uuid(30), uuid(30)] }],
    ["with a slot that is not an id", { ...order, entitlementIds: ["slot-1"] }],
  ])("refuses a renewal %s before any command", async (_label, value) => {
    await expect(renewal(value)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    [
      { code: "PT409", details: "renewal_not_open" },
      409,
      "RENEWAL_NOT_OPEN",
      /from 14 days before it ends/,
    ],
    [
      { code: "PT404", details: "slot_unavailable" },
      404,
      "SLOT_UNAVAILABLE",
      /has ended or is not yours/,
    ],
    [{ code: "PT412" }, 403, "ID_REVIEW_REQUIRED", /before you renew a slot/],
    [{ code: "PT413" }, 400, "INVOICE_REQUIRED", /paid by invoice/],
    [{ code: "PT428" }, 409, "PRICE_CHANGED", /price changed/],
    [{ code: "PT429" }, 409, "RENEWAL_LIMIT_REACHED", /as many slots ahead/],
  ])("tells the member why the database refused (%o)", async (error, status, code, message) => {
    rpc.mockResolvedValueOnce({ data: null, error });
    const refused = renewal();
    await expect(refused).rejects.toMatchObject({ status, code });
    await expect(refused).rejects.toThrow(message);
    expect(machine).not.toHaveBeenCalled();
  });
  it("names an unpaid renewal open at Ozow for the same term", async () => {
    rpc.mockResolvedValueOnce({
      data: { ...quote, amount_cents: "6900", slots: 1, renewal: true, reused: true },
      error: null,
    });
    machine.mockResolvedValueOnce({
      data: { ...openRequest(), amount_cents: "6900" },
      error: null,
    });
    await expect(renewal()).rejects.toMatchObject({
      status: 409,
      code: "PENDING_PAYMENT_EXISTS",
      pendingPayment: { id: payment, slots: 1, amountCents: 6900, renewal: true },
    });
  });
});

describe("My slots", () => {
  const slot = {
    id: uuid(20),
    source: "retail_paid",
    individual: true,
    label: "Individual slot — 30 days",
    area: null,
    starts_at: "2026-11-12T10:00:00Z",
    ends_at: "2026-12-12T10:00:00Z",
    state: "active",
    places: 1,
    sponsor: null,
    renewable: true,
    renew_opens_at: "2026-11-28T10:00:00Z",
    renewed_until: "2027-01-11T10:00:00Z",
    renewals: [
      { id: uuid(22), starts_at: "2026-12-12T10:00:00Z", ends_at: "2027-01-11T10:00:00Z" },
    ],
    posts: [
      {
        id: uuid(21),
        kind: "listing",
        area: "market",
        title: "Bicycle",
        status: "live",
        deletes_at: null,
      },
    ],
  };
  const individual = {
    verified: true,
    held: 1,
    pending: 0,
    renewed_ahead: 1,
    limit: 4,
    limit_ends_at: null,
  };
  it("reads the member's slots, their renewals and counts (v2)", async () => {
    rpc.mockResolvedValueOnce({ data: { slots: [slot], individual }, error: null });
    expect(await readFoundationMySlots(api)).toEqual({ slots: [slot], individual });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_slots_v2", {});
  });
  it("reads a renewal waiting to start", async () => {
    const upcoming = {
      ...slot,
      state: "upcoming",
      renewable: false,
      renewed_until: null,
      renewals: [],
    };
    rpc.mockResolvedValueOnce({ data: { slots: [upcoming], individual }, error: null });
    expect((await readFoundationMySlots(api)).slots[0].state).toBe("upcoming");
  });
  it("refuses an unexpected shape", async () => {
    rpc.mockResolvedValueOnce({
      data: { slots: [{ ...slot, owner_id: owner }], individual },
      error: null,
    });
    await expect(readFoundationMySlots(api)).rejects.toThrow();
  });
});
