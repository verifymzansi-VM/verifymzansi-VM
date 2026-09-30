import { describe, expect, it, vi } from "vitest";
import {
  checkDeploymentHealth,
  readinessUrl,
  waitForDeploymentHealth,
} from "../../scripts/lib/deployment-health";

const HEALTH_URL = new URL("https://example.com/api/health?deep=1");
const noSleep = () => Promise.resolve();

describe("deployment readiness retries", () => {
  it("passes once a cold-start 503 is followed by a ready response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "degraded" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status: "ok", readiness: "ok" }));
    await expect(waitForDeploymentHealth(HEALTH_URL, { fetchImpl, sleep: noSleep })).resolves.toBe(
      2
    );
  });

  it("fails after the bounded number of attempts when readiness never recovers", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => Response.json({ status: "degraded" }, { status: 503 }));
    const sleep = vi.fn(noSleep);
    await expect(
      waitForDeploymentHealth(HEALTH_URL, { attempts: 3, fetchImpl, sleep })
    ).rejects.toThrow("Readiness returned HTTP 503");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe("deployment readiness gate", () => {
  it("checks deep readiness for default and override URLs", () => {
    expect(readinessUrl("https://example.com").href).toBe("https://example.com/api/health?deep=1");
    expect(
      readinessUrl(
        "https://example.com",
        "https://health.example.com/api/health?deep=0"
      ).searchParams.get("deep")
    ).toBe("1");
  });

  it("accepts the actual public readiness contract without privileged diagnostic fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ status: "ok", readiness: "ok" }));
    await expect(
      checkDeploymentHealth(new URL("https://example.com/api/health?deep=1"), fetchImpl)
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) })
    );
  });

  it.each([
    [403, "text/html", "Just a moment"],
    [200, "text/html", "Just a moment"],
    [503, "application/json", '{"status":"degraded"}'],
    [200, "application/json", '{"status":"degraded","readiness":"degraded"}'],
    [200, "application/json", '{"status":"ok"}'],
    [200, "application/json", "not JSON"],
  ])("rejects unverified response %s %s %s", async (status, type, body) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(body, { status, headers: { "content-type": type } }));
    await expect(
      checkDeploymentHealth(new URL("https://example.com/api/health?deep=1"), fetchImpl)
    ).rejects.toThrow();
  });
});
