import { afterEach, describe, expect, it, vi } from "vitest";

const DIAGNOSTIC_TOKEN = "test-diagnostic-token-0123456789abcdef"; // secret-scan: allow deterministic fixture

describe("Health storage route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 when HEALTH_DIAGNOSTIC_TOKEN is not configured", async () => {
    vi.stubEnv("HEALTH_DIAGNOSTIC_TOKEN", "");
    const { GET } = await import("@/app/api/health/storage/route");

    const response = await GET(
      new Request("https://verifymzansi.com/api/health/storage", {
        headers: { authorization: `Bearer ${DIAGNOSTIC_TOKEN}` },
      })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });

  it("returns 401 when the bearer token is wrong", async () => {
    vi.stubEnv("HEALTH_DIAGNOSTIC_TOKEN", DIAGNOSTIC_TOKEN);
    const { GET } = await import("@/app/api/health/storage/route");

    const response = await GET(
      new Request("https://verifymzansi.com/api/health/storage", {
        headers: { authorization: "Bearer wrong-token" },
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when the authorization header is missing", async () => {
    vi.stubEnv("HEALTH_DIAGNOSTIC_TOKEN", DIAGNOSTIC_TOKEN);
    const { GET } = await import("@/app/api/health/storage/route");

    const response = await GET(new Request("https://verifymzansi.com/api/health/storage"));

    expect(response.status).toBe(401);
  });

  it("returns 401 for a token with a different length (timing-safe length guard)", async () => {
    vi.stubEnv("HEALTH_DIAGNOSTIC_TOKEN", DIAGNOSTIC_TOKEN);
    const { GET } = await import("@/app/api/health/storage/route");

    const response = await GET(
      new Request("https://verifymzansi.com/api/health/storage", {
        headers: { authorization: `Bearer ${DIAGNOSTIC_TOKEN}x` },
      })
    );

    expect(response.status).toBe(401);
  });

  it("returns diagnostics when the correct bearer token is presented", async () => {
    vi.stubEnv("HEALTH_DIAGNOSTIC_TOKEN", DIAGNOSTIC_TOKEN);
    const { GET } = await import("@/app/api/health/storage/route");

    const response = await GET(
      new Request("https://verifymzansi.com/api/health/storage", {
        headers: { authorization: `Bearer ${DIAGNOSTIC_TOKEN}` },
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(
      expect.objectContaining({
        timestamp: expect.any(String),
        processEnv: expect.objectContaining({
          hasAccountId: expect.any(Boolean),
          hasAccessKey: expect.any(Boolean),
          hasSecretKey: expect.any(Boolean),
        }),
      })
    );
  });
});
