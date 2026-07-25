import { describe, it, expect, vi } from "vitest";
import {
  claimPaymentProcessing,
  getPaymentById,
  getPaymentByProviderReference,
  markPaymentFailed,
  type PaymentRow,
  type PaymentStoreClient,
} from "./store";

const basePayment: PaymentRow = {
  id: "pay-1",
  area: "MZANSI_MARKET",
  status: "processing",
  provider: "ozow",
  provider_payment_id: "ozow-pid-1",
  provider_reference: "ozow-ref-1",
  provider_data: null,
  amount_cents: 5000,
  user_id: "user-1",
};

function createMockClient(updateResult: {
  data?: { id: string }[] | null;
  error?: { message?: string } | null;
}) {
  const selectMock = vi.fn().mockResolvedValue(updateResult);
  const inMock = vi.fn().mockReturnValue({ select: selectMock });
  const eqInner = vi.fn().mockReturnValue({ in: inMock });
  const eqOuter = vi.fn().mockReturnValue({ eq: eqInner });
  const update = vi.fn().mockReturnValue({ eq: eqOuter });
  const from = vi.fn().mockReturnValue({ update });

  return { from, update, eqOuter, eqInner, inMock, selectMock } as {
    from: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    eqOuter: ReturnType<typeof vi.fn>;
    eqInner: ReturnType<typeof vi.fn>;
    inMock: ReturnType<typeof vi.fn>;
    selectMock: ReturnType<typeof vi.fn>;
  };
}

describe("markPaymentFailed", () => {
  it("returns true on successful update", async () => {
    const mock = createMockClient({ data: [{ id: "pay-1" }], error: null });
    const result = await markPaymentFailed(
      { from: mock.from } as unknown as PaymentStoreClient,
      basePayment,
      { event: "failed" }
    );
    expect(result).toBe(true);
    expect(mock.from).toHaveBeenCalledWith("payments");
    expect(mock.eqOuter).toHaveBeenCalledWith("id", "pay-1");
    expect(mock.eqInner).toHaveBeenCalledWith("provider", "ozow");
    expect(mock.inMock).toHaveBeenCalledWith("status", ["pending", "processing"]);
    expect(mock.selectMock).toHaveBeenCalledWith("id");
  });

  it("returns false when the CAS guard blocks the transition (no rows updated)", async () => {
    // Simulates a payment that reached a terminal state (e.g. complete)
    // between the webhook's read and the update — zero rows match the
    // status IN ('pending','processing') filter.
    const mock = createMockClient({ data: [], error: null });
    const result = await markPaymentFailed(
      { from: mock.from } as unknown as PaymentStoreClient,
      { ...basePayment, status: "complete" },
      { event: "failed" }
    );
    expect(result).toBe(false);
    expect(mock.inMock).toHaveBeenCalledWith("status", ["pending", "processing"]);
  });

  it("returns false when the DB update errors", async () => {
    const mock = createMockClient({ data: null, error: { message: "connection refused" } });
    const result = await markPaymentFailed(
      { from: mock.from } as unknown as PaymentStoreClient,
      basePayment,
      { event: "failed" }
    );
    expect(result).toBe(false);
  });

  it("persists failure_reason, failure_message, and failed_at into provider_data", async () => {
    const mock = createMockClient({ data: [{ id: "pay-1" }], error: null });
    await markPaymentFailed({ from: mock.from } as unknown as PaymentStoreClient, basePayment, {
      status: "Error",
      statusMessage: "Card declined",
      event: "failed",
    });

    const updateArg = mock.update.mock.calls[0][0] as {
      status: string;
      provider_data: Record<string, unknown>;
    };

    expect(updateArg.status).toBe("failed");
    expect(updateArg.provider_data.failure_reason).toBe("error");
    expect(updateArg.provider_data.failure_message).toBe("Card declined");
    expect(updateArg.provider_data.failed_at).toBeDefined();
    // failed_at should be a valid ISO timestamp
    expect(new Date(updateArg.provider_data.failed_at as string).getTime()).not.toBeNaN();
  });

  it("omits failure_message when webhook has no statusMessage", async () => {
    const mock = createMockClient({ error: null });
    await markPaymentFailed({ from: mock.from } as unknown as PaymentStoreClient, basePayment, {
      status: "Cancelled",
    });

    const updateArg = mock.update.mock.calls[0][0] as {
      provider_data: Record<string, unknown>;
    };

    expect(updateArg.provider_data.failure_reason).toBe("cancelled");
    expect(updateArg.provider_data).not.toHaveProperty("failure_message");
  });
});

function createSelectMockClient(result: {
  data?: PaymentRow | null;
  error?: { message?: string } | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  return { from, select, eq, maybeSingle };
}

describe("getPaymentById", () => {
  it("returns the payment row when found", async () => {
    const mock = createSelectMockClient({ data: basePayment });
    const result = await getPaymentById(
      { from: mock.from } as unknown as PaymentStoreClient,
      "pay-1"
    );
    expect(result).toEqual(basePayment);
    expect(mock.eq).toHaveBeenCalledWith("id", "pay-1");
  });

  it("returns null when the payment does not exist", async () => {
    const mock = createSelectMockClient({ data: null, error: null });
    const result = await getPaymentById(
      { from: mock.from } as unknown as PaymentStoreClient,
      "pay-missing"
    );
    expect(result).toBeNull();
  });

  it("throws when the query fails so callers can distinguish errors from missing rows", async () => {
    const mock = createSelectMockClient({
      data: null,
      error: { message: "connection reset by peer" },
    });
    await expect(
      getPaymentById({ from: mock.from } as unknown as PaymentStoreClient, "pay-1")
    ).rejects.toThrow("connection reset by peer");
  });
});

describe("getPaymentByProviderReference", () => {
  it("returns null when no payment matches the reference", async () => {
    const mock = createSelectMockClient({ data: null, error: null });
    const result = await getPaymentByProviderReference(
      { from: mock.from } as unknown as PaymentStoreClient,
      "ref-1"
    );
    expect(result).toBeNull();
    expect(mock.eq).toHaveBeenCalledWith("provider_reference", "ref-1");
  });

  it("throws when the query fails so callers can distinguish errors from missing rows", async () => {
    const mock = createSelectMockClient({
      data: null,
      error: { message: "timeout exceeded" },
    });
    await expect(
      getPaymentByProviderReference({ from: mock.from } as unknown as PaymentStoreClient, "ref-1")
    ).rejects.toThrow("timeout exceeded");
  });
});

describe("claimPaymentProcessing", () => {
  it("claims only from re-usable source statuses so terminal payments cannot be resurrected", async () => {
    const mock = createMockClient({ data: [{ id: "pay-1" }], error: null });
    const result = await claimPaymentProcessing(
      { from: mock.from } as unknown as PaymentStoreClient,
      basePayment,
      { providerPaymentId: "ozow-pid-1", eventType: "transaction.complete" }
    );
    expect(result).toBe(true);
    expect(mock.eqOuter).toHaveBeenCalledWith("id", "pay-1");
    expect(mock.eqInner).toHaveBeenCalledWith("provider", "ozow");
    expect(mock.inMock).toHaveBeenCalledWith("status", ["pending", "failed", "expired"]);
  });

  it("returns false when the CAS guard matches no rows (e.g. complete, processing, refunded)", async () => {
    const mock = createMockClient({ data: [], error: null });
    const result = await claimPaymentProcessing(
      { from: mock.from } as unknown as PaymentStoreClient,
      { ...basePayment, status: "refunded" },
      { providerPaymentId: "ozow-pid-1", eventType: "transaction.complete" }
    );
    expect(result).toBe(false);
    expect(mock.inMock).toHaveBeenCalledWith("status", ["pending", "failed", "expired"]);
  });
});
