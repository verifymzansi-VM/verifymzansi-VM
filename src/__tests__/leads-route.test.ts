import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockEnforceCsrfToken, mockEnforceSameOriginMutation } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockEnforceCsrfToken: vi.fn(),
    mockEnforceSameOriginMutation: vi.fn(),
  })
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: mockEnforceCsrfToken,
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));

import { GET, PATCH } from "@/app/api/leads/route";

function createRequest(
  method: string,
  url = "http://localhost:3000/api/leads",
  body?: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return {
    method,
    url,
    json: async () => body,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  } as unknown as NextRequest;
}

describe("/api/leads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceCsrfToken.mockReturnValue(null);
    mockEnforceSameOriginMutation.mockReturnValue(null);
  });

  it("returns 401 for unauthenticated GET", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const res = await GET(createRequest("GET"));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("rejects invalid GET limits", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    const res = await GET(createRequest("GET", "http://localhost:3000/api/leads?limit=0"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid leads query",
      details: { limit: "limit must be at least 1" },
    });
  });

  it("returns unread count for countOnly query", async () => {
    const leadsSelectChain = {
      eq: vi.fn().mockResolvedValue({ count: 3 }),
    };

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(leadsSelectChain),
      }),
    });

    const res = await GET(
      createRequest("GET", "http://localhost:3000/api/leads?countOnly=true&unread=true")
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ unreadCount: 3, leads: [] });
  });

  it("updates lead status via PATCH", async () => {
    const updateChain = {
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "00000000-0000-4000-8000-000000000001", status: "read" },
            error: null,
          }),
        }),
      }),
    };

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue(updateChain),
      }),
    });

    const res = await PATCH(
      createRequest("PATCH", "http://localhost:3000/api/leads", {
        id: "00000000-0000-4000-8000-000000000001",
        status: "read",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      lead: { id: "00000000-0000-4000-8000-000000000001", status: "read" },
    });
  });

  it("returns 401 for unauthenticated PATCH", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const res = await PATCH(
      createRequest("PATCH", "http://localhost:3000/api/leads", {
        id: "00000000-0000-4000-8000-000000000001",
        status: "read",
      })
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when lead update matches no records", async () => {
    const updateChain = {
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    };

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue(updateChain),
      }),
    });

    const res = await PATCH(
      createRequest("PATCH", "http://localhost:3000/api/leads", {
        id: "00000000-0000-4000-8000-000000000001",
        status: "read",
      })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Lead not found" });
  });
});
