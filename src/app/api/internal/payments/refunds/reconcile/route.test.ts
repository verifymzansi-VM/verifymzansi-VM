/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { runOzowRefundReconciliation } from "@/lib/foundation/ozow-refunds";

const service = vi.hoisted(() => ({ rpc: vi.fn() }));
const recordRun = vi.hoisted(() => vi.fn(async () => true));
const keySet = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/lib/foundation/ozow-refunds", () => ({ runOzowRefundReconciliation: vi.fn() }));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: () => service }));
vi.mock("@/lib/foundation/scheduled-job-runs", () => ({ recordScheduledJobRun: recordRun }));
vi.mock("@/lib/payments/ozow-refunds", () => ({
  createOzowRefundClient: vi.fn(() => ({})),
  ozowRefundKeyConfigured: keySet,
}));

const SECRET = "internal-jobs-test-secret";
function request(token = SECRET) {
  return new Request("https://verifymzansi.com/api/internal/payments/refunds/reconcile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
const result = (listed: boolean, unreadable = 0) =>
  ({ checked: 1, stuck: 0, unmatched: 0, mismatched: 0, listed, unreadable }) as never;

describe("daily refund check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keySet.mockReturnValue(true);
    vi.stubEnv("INTERNAL_JOBS_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects callers without the jobs secret", async () => {
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(runOzowRefundReconciliation).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("records the run for the staff operations page after Ozow's whole list was read", async () => {
    vi.mocked(runOzowRefundReconciliation).mockResolvedValueOnce(result(true));
    expect((await POST(request())).status).toBe(200);
    expect(recordRun).toHaveBeenCalledExactlyOnceWith(service, "refund_check");
  });

  it("records nothing when the list could not be read in full, so the check shows late", async () => {
    vi.mocked(runOzowRefundReconciliation)
      .mockResolvedValueOnce(result(false))
      .mockResolvedValueOnce(result(true, 2))
      .mockRejectedValueOnce(new Error("db down"));
    for (let i = 0; i < 3; i++) expect((await POST(request())).status).toBe(503);
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("does nothing without the refund key", async () => {
    keySet.mockReturnValue(false);
    expect((await POST(request())).status).toBe(200);
    expect(runOzowRefundReconciliation).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("keeps a successful answer when the run cannot be recorded", async () => {
    recordRun.mockResolvedValueOnce(false);
    vi.mocked(runOzowRefundReconciliation).mockResolvedValueOnce(result(true));
    expect((await POST(request())).status).toBe(200);
  });
});
