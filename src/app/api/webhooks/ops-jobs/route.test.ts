import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runOperationJobs } = vi.hoisted(() => ({ runOperationJobs: vi.fn() }));
vi.mock("@/lib/services/operation-jobs", () => ({ runOperationJobs }));

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
});
