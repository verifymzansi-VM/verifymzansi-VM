import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const CSRF_TOKEN = "a".repeat(64);

const { mockCreateClient, mockCheckRateLimit, mockGetClientIp } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

vi.mock("@/lib/services/feature-flags", () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { POST } from "./route";

function createRequest(origin?: string) {
  const headerMap = new Map<string, string>([
    ["cookie", `vm_csrf=${CSRF_TOKEN}`],
    ["x-csrf-token", CSRF_TOKEN],
  ]);
  if (origin) {
    headerMap.set("origin", origin);
  }

  return {
    url: "http://localhost/api/verification/location/gps",
    nextUrl: new URL("http://localhost/api/verification/location/gps"),
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    },
  } as unknown as NextRequest;
}

function createMissingCsrfRequest(origin = "http://localhost") {
  return {
    url: "http://localhost/api/verification/location/gps",
    nextUrl: new URL("http://localhost/api/verification/location/gps"),
    headers: new Headers({ origin }),
  } as unknown as NextRequest;
}

describe("POST /api/verification/location/gps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email_confirmed_at: new Date().toISOString() } },
          error: null,
        }),
      },
    });
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockGetClientIp.mockReturnValue("127.0.0.1");
  });

  it("rejects cross-site GPS verification requests", async () => {
    const response = await POST(createRequest("https://evil.example"));
    expect(response.status).toBe(403);
  });

  it("rejects GPS verification requests without a CSRF token", async () => {
    const response = await POST(createMissingCsrfRequest());
    expect(response.status).toBe(403);
  });

  it("returns 503 when shared GPS verification protection is unavailable", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, degraded: true, retryAfter: 25 });

    const response = await POST(createRequest("http://localhost"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("25");
  });
});
