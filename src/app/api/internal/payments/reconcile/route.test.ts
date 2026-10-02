import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/payments/reconciliation", () => ({ reconcileOzowPayment: mocks.reconcile }));

describe("internal payment reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RATE_LIMITER_API_KEY", "worker-test-key");
  });
  afterEach(() => vi.unstubAllEnvs());
  function request(token = "worker-test-key") {
    return new Request("https://verifymzansi.com/api/internal/payments/reconcile", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  it.each(["", "wrong-key"])("rejects callers without the worker secret %s", async (token) => {
    expect((await POST(request(token))).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("fails closed if the worker secret is not configured", async () => {
    vi.stubEnv("RATE_LIMITER_API_KEY", "");
    expect((await POST(request())).status).toBe(401);
  });
  it("uses a bounded rotating batch and reports lookup failures without aborting other payments", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue({ data: [{ id: "payment-1" }, { id: "payment-2" }], error: null }),
    };
    const admin = { from: vi.fn(() => query) };
    mocks.admin.mockReturnValue(admin);
    mocks.reconcile
      .mockResolvedValueOnce({ checked: true })
      .mockRejectedValueOnce(new Error("provider outage"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ checked: 1, failures: 1 });
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(query.order).toHaveBeenCalledWith("provider_data->>reconciliation_checked_at", {
      ascending: true,
      nullsFirst: true,
    });
    expect(query.in).toHaveBeenCalledWith("status", ["pending", "failed", "expired"]);
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
  });
});
