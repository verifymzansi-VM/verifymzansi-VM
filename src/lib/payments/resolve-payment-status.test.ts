import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFoundationServerSession, readFoundationPayment } = vi.hoisted(() => ({
  readFoundationServerSession: vi.fn(),
  readFoundationPayment: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/server-session", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readFoundationServerSession,
}));
vi.mock("@/lib/foundation/billing-runtime", () => ({ readFoundationPayment }));

import { FoundationServerSessionError } from "@/lib/foundation/server-session";
import { resolveCurrentUserPaymentStatus } from "./resolve-payment-status";

const PAYMENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const api = { rpc: vi.fn() };

describe("resolveCurrentUserPaymentStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFoundationServerSession.mockResolvedValue({ api });
  });

  it("returns missing for an absent or malformed payment id without a read", async () => {
    await expect(resolveCurrentUserPaymentStatus(undefined)).resolves.toBe("missing");
    await expect(resolveCurrentUserPaymentStatus("not-a-payment")).resolves.toBe("missing");
    expect(readFoundationServerSession).not.toHaveBeenCalled();
  });

  it("reads the caller's own payment and keeps funds and access apart", async () => {
    readFoundationPayment.mockResolvedValue({
      status: "complete",
      fulfillment_status: "fulfilled",
    });
    await expect(resolveCurrentUserPaymentStatus(PAYMENT_ID)).resolves.toBe("complete");
    expect(readFoundationPayment).toHaveBeenCalledExactlyOnceWith(api, PAYMENT_ID);

    readFoundationPayment.mockResolvedValue({ status: "complete", fulfillment_status: "pending" });
    await expect(resolveCurrentUserPaymentStatus(PAYMENT_ID)).resolves.toBe("needs_reconciliation");

    readFoundationPayment.mockResolvedValue(null);
    await expect(resolveCurrentUserPaymentStatus(PAYMENT_ID)).resolves.toBe("missing");
  });

  it("returns missing when signed out and pending when the read fails", async () => {
    readFoundationServerSession.mockRejectedValueOnce(new FoundationServerSessionError(401));
    await expect(resolveCurrentUserPaymentStatus(PAYMENT_ID)).resolves.toBe("missing");

    readFoundationPayment.mockRejectedValueOnce(new Error("down"));
    await expect(resolveCurrentUserPaymentStatus(PAYMENT_ID)).resolves.toBe("pending");
  });
});
