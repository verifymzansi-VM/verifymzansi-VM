import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockGetUser } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
}));

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: vi.fn(() => null),
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));

import { GET, PUT, DELETE } from "@/app/api/drafts/route";

function createGETRequest(flow?: string): NextRequest {
  const url = new URL("http://localhost:3000/api/drafts");
  if (flow) url.searchParams.set("flow", flow);
  return {
    method: "GET",
    url: url.toString(),
    headers: new Headers(),
    nextUrl: url,
  } as unknown as NextRequest;
}

function createPUTRequest(body: unknown): NextRequest {
  const raw = JSON.stringify(body);
  return {
    method: "PUT",
    url: "http://localhost:3000/api/drafts",
    headers: new Headers({
      origin: "http://localhost:3000",
      "content-type": "application/json",
    }),
    nextUrl: new URL("http://localhost:3000/api/drafts"),
    text: async () => raw,
  } as unknown as NextRequest;
}

function createDELETERequest(flow?: string): NextRequest {
  const url = new URL("http://localhost:3000/api/drafts");
  if (flow) url.searchParams.set("flow", flow);
  return {
    method: "DELETE",
    url: url.toString(),
    headers: new Headers({
      origin: "http://localhost:3000",
    }),
    nextUrl: url,
  } as unknown as NextRequest;
}

const USER = { id: "user-1", email: "test@test.com" };

describe("GET /api/drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: USER } });
  });

  it("returns 400 for missing flow param", async () => {
    const res = await GET(createGETRequest());
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid flow param", async () => {
    const res = await GET(createGETRequest("invalid"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(createGETRequest("listing"));
    expect(res.status).toBe(401);
  });

  it("returns draft for valid flow", async () => {
    const draft = { step: 2, data: { title: "My listing" }, saved_at: "2026-04-12T00:00:00Z" };
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: draft, error: null }),
          }),
        }),
      }),
    });

    const res = await GET(createGETRequest("listing"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft).toEqual(draft);
  });

  it("returns null draft when none exists", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    });

    const res = await GET(createGETRequest("promotion"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft).toBeNull();
  });

  it("returns 500 on database error", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
          }),
        }),
      }),
    });

    const res = await GET(createGETRequest("business"));
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: USER } });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await PUT(createPUTRequest({ flow: "listing", step: 1, data: {} }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid flow", async () => {
    const res = await PUT(createPUTRequest({ flow: "invalid", step: 1, data: {} }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative step", async () => {
    const res = await PUT(createPUTRequest({ flow: "listing", step: -1, data: {} }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing data", async () => {
    const res = await PUT(createPUTRequest({ flow: "listing", step: 1 }));
    expect(res.status).toBe(400);
  });

  it("upserts draft successfully", async () => {
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });

    const res = await PUT(createPUTRequest({ flow: "listing", step: 2, data: { title: "Test" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 413 for oversized payload", async () => {
    const bigData = "x".repeat(65 * 1024);
    const req = {
      method: "PUT",
      url: "http://localhost:3000/api/drafts",
      headers: new Headers({ origin: "http://localhost:3000" }),
      nextUrl: new URL("http://localhost:3000/api/drafts"),
      text: async () => bigData,
    } as unknown as NextRequest;

    const res = await PUT(req);
    expect(res.status).toBe(413);
  });
});

describe("DELETE /api/drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: USER } });
  });

  it("returns 400 for missing flow", async () => {
    const res = await DELETE(createDELETERequest());
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await DELETE(createDELETERequest("listing"));
    expect(res.status).toBe(401);
  });

  it("deletes draft successfully", async () => {
    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    });

    const res = await DELETE(createDELETERequest("listing"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
