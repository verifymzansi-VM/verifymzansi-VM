import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET, POST } from "@/app/api/storefronts/[id]/posts/route";

function createGetRequest(url: string) {
  return {
    method: "GET",
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL(url, "http://localhost:3000"),
  } as unknown as NextRequest;
}

function createPostRequest(url: string, body: unknown) {
  return {
    method: "POST",
    json: async () => body,
    headers: { get: vi.fn().mockReturnValue(null) },
    nextUrl: new URL(url, "http://localhost:3000"),
  } as unknown as NextRequest;
}

function mockAuth(user: { id: string } | null) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: "Not authenticated" },
      }),
    },
  });
}

const UUID = "00000000-0000-0000-0000-000000000001";

describe("GET /api/storefronts/[id]/posts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid UUID", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });

    const req = createGetRequest("http://localhost:3000/api/storefronts/bad/posts");
    const res = await GET(req, { params: Promise.resolve({ id: "bad" }) });
    expect(res.status).toBe(400);
  });

  it("returns posts for valid storefront", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ id: "post-1", title: "Sale!", type: "promotion" }],
        error: null,
      }),
    };
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });

    const req = createGetRequest(`http://localhost:3000/api/storefronts/${UUID}/posts`);
    const res = await GET(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.posts).toHaveLength(1);
  });
});

describe("POST /api/storefronts/[id]/posts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated requests", async () => {
    mockAuth(null);
    const req = createPostRequest(`http://localhost:3000/api/storefronts/${UUID}/posts`, {
      title: "My Post",
    });
    const res = await POST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(401);
  });

  it("rejects invalid UUID", async () => {
    mockAuth({ id: "user-1" });
    const req = createPostRequest("http://localhost:3000/api/storefronts/bad/posts", {
      title: "My Post",
    });
    const res = await POST(req, { params: Promise.resolve({ id: "bad" }) });
    expect(res.status).toBe(400);
  });

  it("rejects title too short", async () => {
    mockAuth({ id: "user-1" });
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: UUID, seller_id: "user-1", status: "live" },
      }),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });

    const req = createPostRequest(`http://localhost:3000/api/storefronts/${UUID}/posts`, {
      title: "Hi",
    });
    const res = await POST(req, { params: Promise.resolve({ id: UUID }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Validation failed");
  });
});
