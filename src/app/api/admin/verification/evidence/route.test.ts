import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockVerifyStaffActorRoleFromDb, mockCheckLocalRateLimit } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockVerifyStaffActorRoleFromDb: vi.fn(),
    mockCheckLocalRateLimit: vi.fn(),
  })
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyStaffActorRoleFromDb: (...args: unknown[]) => mockVerifyStaffActorRoleFromDb(...args),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: (...args: unknown[]) => mockCheckLocalRateLimit(...args),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET, POST } from "./route";

function createGetRequest(url: string): NextRequest {
  return {
    nextUrl: new URL(url),
    url,
    headers: {
      get: vi.fn().mockReturnValue(null),
    },
  } as unknown as NextRequest;
}

function createPostRequest(body: unknown): NextRequest {
  return {
    url: "http://localhost:3000/api/admin/verification/evidence",
    json: async () => body,
    headers: new Headers(),
  } as unknown as NextRequest;
}

describe("/api/admin/verification/evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "admin-1" } },
          error: null,
        }),
      },
    });
    mockVerifyStaffActorRoleFromDb.mockResolvedValue("admin");
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
  });

  it("returns 400 for an invalid artifactId query", async () => {
    const response = await GET(
      createGetRequest("http://localhost:3000/api/admin/verification/evidence?artifactId=bad-id")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "artifactId query parameter is required",
    });
  });

  it("returns 400 for an invalid artifactId in the POST body", async () => {
    const response = await POST(createPostRequest({ artifactId: "bad-id" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "artifactId is required in request body",
    });
  });
});
