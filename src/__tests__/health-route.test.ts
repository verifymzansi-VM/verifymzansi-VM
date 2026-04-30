import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLaunchHealthSnapshot } from "@/lib/health/launch-health";

const { mockError } = vi.hoisted(() => ({
  mockError: vi.fn(),
}));

vi.mock("@/lib/health/launch-health", () => ({
  getLaunchHealthSnapshot: vi.fn(),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    error: mockError,
  }),
}));

describe("Health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns HTTP 200 when the launch snapshot is healthy", async () => {
    vi.mocked(getLaunchHealthSnapshot).mockResolvedValue({
      status: "ok",
      mode: "production",
      timestamp: "2026-03-06T00:00:00.000Z",
      checks: {
        config: { status: "ok", errorCount: 0, warningCount: 0 },
        supabase: { status: "ok", detail: "Supabase query probe succeeded" },
        schema: { status: "ok", detail: "Schema verification passed" },
        audit: { status: "ok", failureCount: 0 },
      },
    });

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-store, no-cache, must-revalidate"
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      readiness: "ok",
      timestamp: expect.any(String),
    });
  });

  it("returns HTTP 200 with degraded readiness when the launch snapshot is degraded", async () => {
    vi.mocked(getLaunchHealthSnapshot).mockResolvedValue({
      status: "degraded",
      mode: "production",
      timestamp: "2026-03-06T00:00:00.000Z",
      checks: {
        config: { status: "degraded", errorCount: 1, warningCount: 0, failedChecks: ["App URL"] },
        supabase: { status: "degraded", detail: "Supabase launch probe failed" },
        schema: { status: "ok", detail: "Schema verification passed" },
        audit: { status: "ok", failureCount: 0 },
      },
    });

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      readiness: "degraded",
      timestamp: expect.any(String),
    });
  });

  it("returns a controlled degraded payload when health snapshot generation throws", async () => {
    vi.mocked(getLaunchHealthSnapshot).mockRejectedValue(new Error("schema probe timed out"));

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      status: "degraded",
      readiness: "degraded",
      timestamp: expect.any(String),
    });
    expect(mockError).toHaveBeenCalledWith("Health snapshot generation failed", {
      error: "schema probe timed out",
    });
  });

  it("returns a controlled degraded payload when health snapshot generation times out", async () => {
    vi.useFakeTimers();
    vi.mocked(getLaunchHealthSnapshot).mockReturnValue(new Promise(() => undefined));

    const { GET } = await import("@/app/api/health/route");
    const responsePromise = GET();

    await vi.advanceTimersByTimeAsync(1200);
    const response = await responsePromise;

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      readiness: "degraded",
      timestamp: expect.any(String),
    });
    expect(mockError).toHaveBeenCalledWith("Health snapshot generation failed", {
      error: "Health snapshot timed out",
    });
  });
});
