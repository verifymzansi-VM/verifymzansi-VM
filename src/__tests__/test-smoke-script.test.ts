import { describe, it, expect } from "vitest";
import { runCheck, type SmokeCheck } from "../../scripts/test-smoke";

function makeJsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("test-smoke script", () => {
  const healthCheck: SmokeCheck = {
    name: "Health endpoint",
    path: "/api/health",
    expectStatuses: [200, 503],
    validateJsonStatusKey: true,
  };

  it("accepts healthy 200 responses", async () => {
    const fetchImpl: typeof fetch = async () => makeJsonResponse({ status: "ok" }, 200);

    await expect(
      runCheck(healthCheck, {
        baseUrl: "https://example.com",
        fetchImpl,
      })
    ).resolves.toBeUndefined();
  });

  it("accepts degraded 503 responses when status field exists", async () => {
    const fetchImpl: typeof fetch = async () => makeJsonResponse({ status: "degraded" }, 503);

    await expect(
      runCheck(healthCheck, {
        baseUrl: "https://example.com",
        fetchImpl,
      })
    ).resolves.toBeUndefined();
  });

  it("fails when expected status key is missing", async () => {
    const fetchImpl: typeof fetch = async () => makeJsonResponse({ ok: true }, 200);

    await expect(
      runCheck(healthCheck, {
        baseUrl: "https://example.com",
        fetchImpl,
      })
    ).rejects.toThrow("missing 'status' key");
  });
});
