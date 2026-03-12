import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

import { DELETE, GET, PATCH } from "@/app/api/notifications/route";

function createRequest(
  method: string,
  url = "http://localhost:3000/api/notifications",
  body?: unknown
): NextRequest {
  return {
    method,
    url,
    json: async () => body,
  } as unknown as NextRequest;
}

describe("/api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid GET limits", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    const res = await GET(createRequest("GET", "http://localhost:3000/api/notifications?limit=0"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "limit must be a positive number" });
  });

  it("returns a safe error when marking all notifications read fails", async () => {
    const updateChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: "row level security failed" } }),
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
      createRequest("PATCH", "http://localhost:3000/api/notifications", { all: true })
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to update notifications" });
  });

  it("validates notification ids for PATCH", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    const res = await PATCH(
      createRequest("PATCH", "http://localhost:3000/api/notifications", { id: "not-a-uuid" })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Must provide 'id' or 'all: true'" });
  });

  it("deletes a single notification", async () => {
    const deleteChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue(deleteChain),
      }),
    });

    const res = await DELETE(
      createRequest("DELETE", "http://localhost:3000/api/notifications", {
        id: "00000000-0000-4000-8000-000000000001",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
  });
});
