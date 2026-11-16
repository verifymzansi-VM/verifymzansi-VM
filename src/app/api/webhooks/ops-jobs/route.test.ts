import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runFoundationOperationJobs, logError, Incomplete } = vi.hoisted(() => ({
  runFoundationOperationJobs: vi.fn(),
  logError: vi.fn(),
  Incomplete: class extends Error {
    constructor(
      readonly failed: string[],
      readonly summary: { lost: number }
    ) {
      super("Some operation jobs failed");
    }
  },
}));
vi.mock("@/lib/foundation/operation-jobs", () => ({
  runFoundationOperationJobs,
  OperationJobsIncompleteError: Incomplete,
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import { POST } from "./route";

const SECRET = "s".repeat(40);
const request = (auth?: string) =>
  new Request("https://verifymzansi.com/api/webhooks/ops-jobs", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
  });

describe("POST /api/webhooks/ops-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPS_JOBS_SECRET", SECRET);
    runFoundationOperationJobs.mockResolvedValue({
      claimed: 25,
      succeeded: 25,
      retrying: 0,
      lost: 0,
      failed: [],
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "Bearer wrong", `Basic ${SECRET}`])("refuses %s", async (auth) => {
    expect((await POST(request(auth))).status).toBe(401);
    expect(runFoundationOperationJobs).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is missing or too short", async () => {
    vi.stubEnv("OPS_JOBS_SECRET", "short");
    expect((await POST(request("Bearer short"))).status).toBe(401);
    expect(runFoundationOperationJobs).not.toHaveBeenCalled();
  });

  it("returns 500 without details when the run fails", async () => {
    runFoundationOperationJobs.mockRejectedValue(new Error("db exploded"));
    const res = await POST(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("exploded");
  });

  it("answers 500 and names the failed steps when a run is incomplete", async () => {
    runFoundationOperationJobs.mockRejectedValue(
      new Incomplete(["sweep:sweep_sponsorships", "staff_alert"], { lost: 2 })
    );
    const res = await POST(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("sweep");
    expect(logError).toHaveBeenCalledWith("Operation job run failed", {
      error: "Some operation jobs failed",
      failed: ["sweep:sweep_sponsorships", "staff_alert"],
      lost: 2,
    });
  });

  it("returns the run summary for the worker holding the shared secret", async () => {
    const res = await POST(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ claimed: 25, succeeded: 25, retrying: 0 });
  });
});
