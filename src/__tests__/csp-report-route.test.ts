import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockWarn, mockCheckLocalRateLimit } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(() => ({ limited: false })),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

import { POST } from "@/app/api/csp-report/route";

describe("POST /api/csp-report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
  });

  it("rejects empty CSP payloads", async () => {
    const res = await POST(
      new Request("http://localhost/api/csp-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }) as never
    );

    expect(res.status).toBe(400);
  });

  it("logs only validated CSP fields", async () => {
    const res = await POST(
      new Request("http://localhost/api/csp-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          "csp-report": {
            "blocked-uri": " https://evil.example/script.js ",
            "violated-directive": "script-src",
            "line-number": 42,
            ignored: "value",
          },
        }),
      }) as never
    );

    expect(res.status).toBe(204);
    expect(mockWarn).toHaveBeenCalledWith(
      "CSP violation",
      expect.objectContaining({
        blockedUri: "https://evil.example/script.js",
        violatedDirective: "script-src",
        lineNumber: 42,
      })
    );
  });
});
