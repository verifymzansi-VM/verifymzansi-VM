/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import {
  cancelOzowPaymentRequest,
  createOzowHostedPayment,
  getOzowPaymentRequestStatus,
  listOzowPaymentTransactions,
  type NormalizedOzowWebhook,
} from "../payments/ozow";
import {
  applyFoundationOzowNotification,
  cancelFoundationPendingPayment,
  readFoundationBilling,
  reconcileFoundationPayment,
  startFoundationCheckout,
} from "./billing-runtime";
vi.mock("server-only", () => ({}));
vi.mock("../config/env", () => ({ env: (name: string) => process.env[name] }));
vi.mock("../payments/ozow", () => ({
  cancelOzowPaymentRequest: vi.fn(),
  createOzowHostedPayment: vi.fn(),
  getOzowPaymentRequestStatus: vi.fn(),
  listOzowPaymentTransactions: vi.fn(),
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
});
afterEach(() => vi.unstubAllEnvs());
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
it("reuses an existing provider checkout without creating another", async () => {
  machine.mockResolvedValueOnce({
    data: { ...claimDto(), claim_token: null, checkout_url: checkoutUrl },
    error: null,
  });
  expect(
    await startFoundationCheckout(api, owner, product, null, "https://verifymzansi.com", service)
  ).toEqual({ paymentId: payment, checkoutUrl });
  expect(createOzowHostedPayment).not.toHaveBeenCalled();
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
it.each([
  { amount: "0.01" },
  { currencyCode: "USD" },
  { siteCode: "wrong-site" },
  { providerPaymentId: uuid(9) },
  { isTest: true },
])("does not settle inconsistent provider evidence", async (change) => {
  await expect(
    applyFoundationOzowNotification({ ...notification(), ...change }, "signed mismatch", service)
  ).rejects.toMatchObject({ status: 400 });
  expect(machine.mock.calls.some(([name]) => name === "apply_provider_event")).toBe(false);
});
it("ignores an unknown merchant reference without creating a payment", async () => {
  machine.mockResolvedValueOnce({ data: null, error: null });
  expect(await applyFoundationOzowNotification(notification(), "signed unknown", service)).toEqual({
    success: true,
    ignored: true,
  });
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
  });
  expect(machine).toHaveBeenLastCalledWith("finish_unpaid_checkout", {
    p_payment_id: payment,
    p_status: "expired",
  });
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
it("parses only the caller's bounded billing projection", async () => {
  expect(await readFoundationBilling(api)).toEqual({
    payments: [],
    invoices: [],
    entitlements: [],
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_billing", {});
});
