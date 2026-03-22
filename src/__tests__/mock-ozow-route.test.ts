import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { GET } from "@/app/api/mock-ozow/route";

describe("GET /api/mock-ozow", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_MOCK_OZOW", "true");
  });

  it("rejects invalid payment ids before hitting the database", async () => {
    const res = await GET(new Request("http://localhost/api/mock-ozow?paymentId=not-a-uuid"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid mock payment query",
      details: { paymentId: "Enter a valid ID" },
    });
  });

  it("rejects unsafe return urls", async () => {
    const res = await GET(
      new Request("http://localhost/api/mock-ozow?returnUrl=https://evil.example/phish")
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid mock payment query",
      details: { returnUrl: "returnUrl is invalid" },
    });
  });
});
