import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockGetUser } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
}));

const { mockGetConsents, mockUpdateConsent } = vi.hoisted(() => ({
  mockGetConsents: vi.fn(),
  mockUpdateConsent: vi.fn(),
}));

const { mockCheckLocalRateLimit } = vi.hoisted(() => ({
  mockCheckLocalRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("@/lib/services/consent", () => ({
  getConsents: mockGetConsents,
  updateConsent: mockUpdateConsent,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: vi.fn(() => null),
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));

import { GET, PATCH } from "@/app/api/communications/preferences/route";

const USER = { id: "user-1", email: "test@test.com" };

const FULL_CONSENTS = {
  marketing_email: true,
  marketing_sms: false,
  analytics: true,
  third_party_sharing: false,
  data_processing: true,
};

function makeGET(params?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/communications/preferences");
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return {
    method: "GET",
    url: url.toString(),
    headers: new Headers(),
    nextUrl: url,
  } as unknown as NextRequest;
}

function makePATCH(body: unknown): NextRequest {
  return {
    method: "PATCH",
    url: "http://localhost:3000/api/communications/preferences",
    headers: new Headers({
      origin: "http://localhost:3000",
      "content-type": "application/json",
    }),
    nextUrl: new URL("http://localhost:3000/api/communications/preferences"),
    json: async () => body,
  } as unknown as NextRequest;
}

describe("GET /api/communications/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: USER } });
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockGetConsents.mockResolvedValue(FULL_CONSENTS);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(makeGET());
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    mockCheckLocalRateLimit.mockReturnValue({ limited: true, retryAfter: 30 });
    const res = await GET(makeGET());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("returns optional preferences only by default", async () => {
    const res = await GET(makeGET());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferences).toEqual({
      marketing_email: true,
      marketing_sms: false,
      analytics: true,
      third_party_sharing: false,
    });
    expect(body.required).toBeUndefined();
  });

  it("includes required preferences when includeRequired=true", async () => {
    const res = await GET(makeGET({ includeRequired: "true" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.required).toEqual({
      transactional_email: true,
      data_processing: true,
    });
  });
});

describe("PATCH /api/communications/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: USER } });
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockUpdateConsent.mockResolvedValue({ success: true });
    mockGetConsents.mockResolvedValue(FULL_CONSENTS);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await PATCH(makePATCH({ marketing_email: true }));
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    mockCheckLocalRateLimit.mockReturnValue({ limited: true, retryAfter: 10 });
    const res = await PATCH(makePATCH({ analytics: false }));
    expect(res.status).toBe(429);
  });

  it("updates preferences successfully", async () => {
    const res = await PATCH(makePATCH({ marketing_email: false, analytics: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.preferences).toBeDefined();
    expect(mockUpdateConsent).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when update fails", async () => {
    mockUpdateConsent.mockResolvedValue({ success: false, error: "DB error" });
    const res = await PATCH(makePATCH({ marketing_sms: true }));
    expect(res.status).toBe(500);
  });
});
