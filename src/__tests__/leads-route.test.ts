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

  it("returns the caller's own unread count for countOnly query", async () => {
    const statusEq = vi.fn().mockResolvedValue({ count: 3 });
    const ownerEq = vi.fn().mockReturnValue({ eq: statusEq });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: ownerEq }),
      }),
    });

    const res = await GET(
      createRequest("GET", "http://localhost:3000/api/leads?countOnly=true&unread=true")
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ unreadCount: 3, leads: [] });
    // RLS lets admins read every lead, so the inbox is explicitly owner-scoped.
    expect(ownerEq).toHaveBeenCalledWith("owner_id", "user-1");
    expect(statusEq).toHaveBeenCalledWith("status", "new");
  });

  it("scopes the lead list query to the caller's own leads", async () => {
    const countChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ count: 1, error: null }),
      }),
    };
    const lead = { id: "00000000-0000-4000-8000-000000000001", status: "new" };
    const listChain = {
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [lead], error: null }),
    };
    listChain.eq.mockReturnValue(listChain);
    listChain.order.mockReturnValue(listChain);
    listChain.limit.mockReturnValue(listChain);
    const select = vi.fn((columns: string) => (columns === "id" ? countChain : listChain));

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({ select }),
    });

    const res = await GET(createRequest("GET", "http://localhost:3000/api/leads"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ leads: [lead], unreadCount: 1 });
    expect(countChain.eq).toHaveBeenCalledWith("owner_id", "user-1");
    expect(listChain.eq).toHaveBeenCalledWith("owner_id", "user-1");
  });

  it("updates lead status via PATCH", async () => {
    const ownerEq = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: "00000000-0000-4000-8000-000000000001", status: "read" },
          error: null,
        }),
      }),
    });
    const updateChain = {
      eq: vi.fn().mockReturnValue({ eq: ownerEq }),
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
    expect(updateChain.eq).toHaveBeenCalledWith("id", "00000000-0000-4000-8000-000000000001");
    expect(ownerEq).toHaveBeenCalledWith("owner_id", "user-1");
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
    const ownerEq = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    });
    const updateChain = {
      eq: vi.fn().mockReturnValue({ eq: ownerEq }),
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
    expect(ownerEq).toHaveBeenCalledWith("owner_id", "user-1");
  });
});
