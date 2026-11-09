/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  readFoundationBilling,
  reconcileFoundationPayment,
  runFoundationPaymentReconciliation,
  startFoundationCheckout,
} from "./billing-runtime";
vi.mock("server-only", () => ({}));
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
  NEXT_PUBLIC_DATA_BACKEND: "foundation",
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
    .mockResolvedValueOnce({ data: [mockCheckout()], error: null })
    .mockResolvedValueOnce({ data: mockCheckout(), error: null });
  vi.mocked(listOzowPaymentTransactions).mockResolvedValueOnce([standInTransaction()]);
  expect(await runFoundationPaymentReconciliation(service)).toEqual({ checked: 1, failures: 0 });
  expect(machine.mock.calls.map(([name]) => name)).toEqual([
    "list_reconcilable_payments",
    "claim_payment_reconciliation",
    "apply_provider_event",
  ]);
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
