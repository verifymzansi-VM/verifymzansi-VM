import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runOperationJobs, runFoundationOperationJobs, logError, Incomplete } = vi.hoisted(() => ({
  runOperationJobs: vi.fn(),
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
vi.mock("@/lib/services/operation-jobs", () => ({ runOperationJobs }));
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
    vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "source");
    runOperationJobs.mockResolvedValue({ claimed: 2, succeeded: 2, retrying: 0, dead: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("runs jobs for the worker holding the shared secret", async () => {
    const res = await POST(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ succeeded: 2 });
  });

  it.each([undefined, "Bearer wrong", `Basic ${SECRET}`])("refuses %s", async (auth) => {
    expect((await POST(request(auth))).status).toBe(401);
    expect(runOperationJobs).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is missing or too short", async () => {
    vi.stubEnv("OPS_JOBS_SECRET", "short");
    expect((await POST(request("Bearer short"))).status).toBe(401);
  });

  it("returns 500 without details when the run fails", async () => {
    runOperationJobs.mockRejectedValue(new Error("db exploded"));
    const res = await POST(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("exploded");
  });

  it("answers 500 and names the failed steps when a foundation run is incomplete", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
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

  it("returns the foundation run summary when every step succeeds", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
    runFoundationOperationJobs.mockResolvedValue({
      claimed: 25,
      succeeded: 25,
      retrying: 0,
      lost: 0,
      failed: [],
    });
    const res = await POST(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ claimed: 25, succeeded: 25, retrying: 0 });
    expect(runOperationJobs).not.toHaveBeenCalled();
  });
});
