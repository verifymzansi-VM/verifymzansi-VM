import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Health route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return 200 with correct shape", async () => {
    // Health check routes should return { status: "ok" }
    const { GET } = await import("@/app/api/health/route");

    if (GET) {
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("status");
      expect(body.status).toBe("ok");
    }
  });
});
