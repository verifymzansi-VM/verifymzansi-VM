import { describe, it, expect, vi } from "vitest";
import { markPaymentFailed, type PaymentRow, type PaymentStoreClient } from "./store";

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

function createMockClient(updateResult: { error?: { message?: string } | null }) {
  const eqInner = vi.fn().mockResolvedValue(updateResult);
  const eqOuter = vi.fn().mockReturnValue({ eq: eqInner });
  const update = vi.fn().mockReturnValue({ eq: eqOuter });
  const from = vi.fn().mockReturnValue({ update });

  return { from, update, eqOuter, eqInner } as {
    from: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    eqOuter: ReturnType<typeof vi.fn>;
    eqInner: ReturnType<typeof vi.fn>;
  };
}

describe("markPaymentFailed", () => {
  it("returns true on successful update", async () => {
    const mock = createMockClient({ error: null });
    const result = await markPaymentFailed(
      { from: mock.from } as unknown as PaymentStoreClient,
      basePayment,
      { event: "failed" }
    );
    expect(result).toBe(true);
    expect(mock.from).toHaveBeenCalledWith("payments");
    expect(mock.eqOuter).toHaveBeenCalledWith("id", "pay-1");
    expect(mock.eqInner).toHaveBeenCalledWith("provider", "ozow");
  });

  it("returns false when the DB update errors", async () => {
    const mock = createMockClient({ error: { message: "connection refused" } });
    const result = await markPaymentFailed(
      { from: mock.from } as unknown as PaymentStoreClient,
      basePayment,
      { event: "failed" }
    );
    expect(result).toBe(false);
  });

  it("persists failure_reason, failure_message, and failed_at into provider_data", async () => {
    const mock = createMockClient({ error: null });
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
