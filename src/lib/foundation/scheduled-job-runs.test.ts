import { describe, expect, it, vi } from "vitest";
import type { FoundationServiceApi } from "./service-api";
import { recordScheduledJobRun } from "./scheduled-job-runs";

vi.mock("server-only", () => ({}));

const api = (rpc: (...args: unknown[]) => unknown) =>
  ({ rpc: vi.fn(rpc) }) as unknown as FoundationServiceApi & { rpc: ReturnType<typeof vi.fn> };

describe("recordScheduledJobRun", () => {
  it("calls the service command for the job", async () => {
    const service = api(async () => ({ data: true, error: null }));
    await expect(recordScheduledJobRun(service, "payment_checks")).resolves.toBe(true);
    expect(service.rpc).toHaveBeenCalledWith("record_scheduled_job_run", {
      p_job: "payment_checks",
    });
  });

  it("never throws: a refusal, a missing command or a failed request returns false", async () => {
    for (const service of [
      api(async () => ({ data: null, error: { code: "PGRST202" } })),
      api(async () => ({ data: null, error: { code: "22023" } })),
      api(async () => {
        throw new Error("network");
      }),
    ])
      await expect(recordScheduledJobRun(service, "refund_check")).resolves.toBe(false);
  });
});
