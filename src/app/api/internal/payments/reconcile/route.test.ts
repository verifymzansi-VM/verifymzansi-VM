/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { runFoundationPaymentReconciliation } from "@/lib/foundation/billing-runtime";

vi.mock("@/lib/foundation/billing-runtime", () => ({
  runFoundationPaymentReconciliation: vi.fn(),
}));

const SECRET = "internal-jobs-test-secret";
function request(token = SECRET) {
  return new Request("https://verifymzansi.com/api/internal/payments/reconcile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("internal payment reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INTERNAL_JOBS_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["", "wrong-key"])("rejects callers without the jobs secret %s", async (token) => {
    expect((await POST(request(token))).status).toBe(401);
    expect(runFoundationPaymentReconciliation).not.toHaveBeenCalled();
  });

  it("fails closed if the jobs secret is not configured", async () => {
    vi.stubEnv("INTERNAL_JOBS_SECRET", "");
    expect((await POST(request(""))).status).toBe(401);
    expect(runFoundationPaymentReconciliation).not.toHaveBeenCalled();
  });

  it("returns the run summary and answers 503 when any payment failed", async () => {
    vi.mocked(runFoundationPaymentReconciliation)
      .mockResolvedValueOnce({ checked: 2, failures: 0 } as never)
      .mockResolvedValueOnce({ checked: 1, failures: 1 } as never);
    const ok = await POST(request());
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(await ok.json()).toEqual({ checked: 2, failures: 0 });
    const partial = await POST(request());
    expect(partial.status).toBe(503);
    expect(await partial.json()).toEqual({ checked: 1, failures: 1 });
  });

  it("answers 503 without details when the run throws", async () => {
    vi.mocked(runFoundationPaymentReconciliation).mockRejectedValueOnce(new Error("db down"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Payment reconciliation unavailable" });
  });
});
