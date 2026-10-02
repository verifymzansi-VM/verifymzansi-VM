import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { reconcileOzowPayment } from "./reconciliation";
import type { PaymentRecordShape } from "./types";
import * as OzowModule from "./ozow";

const mocks = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn(), fulfill: vi.fn() }));
vi.mock("./ozow", async (importOriginal) => ({
  ...(await importOriginal<typeof OzowModule>()),
  listOzowPaymentTransactions: mocks.list,
  getOzowPaymentRequestStatus: mocks.status,
}));
vi.mock("./fulfillment", () => ({ fulfillPayment: mocks.fulfill }));
vi.mock("./notifications", () => ({
  auditPaymentCompleted: vi.fn().mockResolvedValue(undefined),
  sendPaymentStatusEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/config/env", () => ({
  env: (key: string) => ({ OZOW_ENV: "production", OZOW_SITE_CODE: "site-code" })[key] || "",
}));

const payment: PaymentRecordShape = {
  id: "payment-1",
  provider: "ozow",
  provider_payment_id: "request-1",
  provider_reference: "merchant-1",
  user_id: "user-1",
  area: "MZANSI_MARKET",
  amount_cents: 5000,
  status: "pending",
  created_at: "2026-10-02T09:00:00Z",
};
const transaction = () => ({
  ...OzowModule.normalizeOzowWebhook({
    type: "transaction.complete",
    data: {
      id: "transaction-1",
      siteCode: "site-code",
      merchantReference: "merchant-1",
      amount: { value: 50, currency: "ZAR" },
      status: "Successful",
    },
  })!,
  providerPaymentId: "request-1",
});
function client() {
  const eq = vi.fn().mockReturnThis();
  const update = vi.fn(() => ({ eq }));
  const admin = {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    from: vi.fn(() => ({ update })),
  };
  return { admin, update, eq };
}
describe("Ozow reconciliation", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockReset().mockResolvedValue([]);
    mocks.status.mockReset().mockResolvedValue("Created");
    mocks.fulfill.mockReset().mockResolvedValue({ outcome: "completed" });
  });
  it("keeps explicitly simulated checkouts isolated from the provider API and database claims", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ENABLE_MOCK_OZOW", "true");
    const { admin } = client();
    expect(await reconcileOzowPayment(payment, admin as never)).toEqual({ checked: true });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it.each(["pending", "failed", "expired"] as const)(
    "recovers a missed success for a %s payment through atomic confirmation",
    async (status) => {
      const { admin, update } = client();
      mocks.list.mockResolvedValue([transaction()]);
      await expect(
        reconcileOzowPayment({ ...payment, status }, admin as never)
      ).resolves.toMatchObject({ checked: true, outcome: "completed" });
      expect(mocks.fulfill).toHaveBeenCalledWith(
        admin,
        { ...payment, status },
        expect.objectContaining({ reconciliation: true }),
        { id: "transaction-1", merchantReference: "merchant-1" }
      );
      expect(update).not.toHaveBeenCalled();
    }
  );
  it("does not look up a payment already claimed by another poll or worker", async () => {
    const { admin } = client();
    admin.rpc.mockResolvedValue({ data: false, error: null });
    expect(await reconcileOzowPayment(payment, admin as never)).toEqual({ checked: false });
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("expires a pending row only after checking transactions and provider request expiry", async () => {
    const { admin, update, eq } = client();
    mocks.status.mockResolvedValue("Expired");
    await reconcileOzowPayment(payment, admin as never);
    expect(update).toHaveBeenCalledWith({ status: "expired" });
    expect(eq).toHaveBeenCalledWith("status", "pending");
    expect(mocks.fulfill).not.toHaveBeenCalled();
  });
  it("preserves a pending bank transaction even when the checkout link may have expired", async () => {
    const { admin, update } = client();
    mocks.list.mockResolvedValue([{ ...transaction(), status: "Pending" }]);
    expect(await reconcileOzowPayment(payment, admin as never)).toMatchObject({
      pendingTransaction: true,
    });
    expect(update).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("preserves the payment on provider outages or incomplete transaction pagination", async () => {
    const { admin, update } = client();
    mocks.list.mockRejectedValue(new Error("lookup unavailable"));
    await expect(reconcileOzowPayment(payment, admin as never)).rejects.toThrow(
      "lookup unavailable"
    );
    expect(update).not.toHaveBeenCalled();
  });
  it.each([
    { siteCode: "other" },
    { amount: "49.99" },
    { merchantReference: "other" },
    { currencyCode: "USD" },
    { providerPaymentId: "other-request" },
    { status: "Unknown" },
  ])("rejects a paid transaction that does not match our purchase %j", async (override) => {
    const { admin, update } = client();
    mocks.list.mockResolvedValue([{ ...transaction(), ...override }]);
    await expect(reconcileOzowPayment(payment, admin as never)).rejects.toThrow(
      "Ozow reconciliation rejected"
    );
    expect(mocks.fulfill).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
