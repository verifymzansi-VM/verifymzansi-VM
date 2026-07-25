import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCurrentUserPaymentStatus } from "./resolve-payment-status";
import { createClient } from "@/lib/supabase/server";
import type { PaymentStatusView } from "./status-view";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const PAYMENT_ID = "550e8400-e29b-41d4-a716-446655440000";

function mockAuthenticated(paymentResult: {
  data: { status: string } | null;
  error?: { message: string } | null;
}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue(paymentResult),
          }),
        }),
      }),
    }),
  } as never);
}

describe("resolveCurrentUserPaymentStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns missing when no payment id is provided", async () => {
    await expect(resolveCurrentUserPaymentStatus(undefined)).resolves.toBe("missing");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns missing when there is no authenticated user", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never);

    await expect(resolveCurrentUserPaymentStatus(PAYMENT_ID)).resolves.toBe("missing");
  });

  const statusCases: Array<{ dbStatus: string; expected: PaymentStatusView }> = [
    { dbStatus: "complete", expected: "complete" },
    { dbStatus: "pending", expected: "pending" },
    { dbStatus: "processing", expected: "pending" },
    { dbStatus: "failed", expected: "failed" },
    { dbStatus: "expired", expected: "expired" },
  ];

  it.each(statusCases)(
    "maps stored status $dbStatus to $expected",
    async ({ dbStatus, expected }) => {
      mockAuthenticated({ data: { status: dbStatus }, error: null });

      await expect(resolveCurrentUserPaymentStatus(PAYMENT_ID)).resolves.toBe(expected);
    }
  );

  it("returns missing when the payment row does not exist", async () => {
    mockAuthenticated({ data: null, error: null });

    await expect(resolveCurrentUserPaymentStatus(PAYMENT_ID)).resolves.toBe("missing");
  });

  it("returns pending instead of missing when the payment query hits a DB error", async () => {
    mockAuthenticated({ data: null, error: { message: "connection reset by peer" } });

    await expect(resolveCurrentUserPaymentStatus(PAYMENT_ID)).resolves.toBe("pending");
  });
});
