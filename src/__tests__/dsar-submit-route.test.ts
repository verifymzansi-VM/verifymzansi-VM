import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateAdminClient, mockLogAuditEvent, mockSendDsarSubmissionEmail } = vi.hoisted(
  () => ({
    mockCreateAdminClient: vi.fn(),
    mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
    mockSendDsarSubmissionEmail: vi.fn().mockResolvedValue({ success: true }),
  })
);

const { mockCreateClient, mockGetUser } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/services/email", () => ({
  sendDsarSubmissionEmail: mockSendDsarSubmissionEmail,
}));

import { POST } from "@/app/api/dsar/submit/route";

function createRequest(body: unknown) {
  const headers = new Headers({
    origin: "http://localhost:3000",
    "sec-fetch-site": "same-origin",
  });

  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/dsar/submit",
    headers,
  } as unknown as NextRequest;
}

describe("POST /api/dsar/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", is_anonymous: false } },
    });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: mockGetUser,
      },
    });
  });

  it("returns unauthorized when no authenticated user exists", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(
      createRequest({
        type: "access",
        name: "Nomsa Dlamini",
        email: "nomsa@example.com",
        idNumber: "8001015009087",
        details: "Please send me a copy of my stored account data.",
        turnstileToken: "tok",
      })
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });

  it("rejects invalid request bodies", async () => {
    const res = await POST(createRequest({}));

    expect(res.status).toBe(400);
  });

  it("submits a DSAR case successfully", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" },
              error: null,
            }),
          }),
        }),
      }),
    });

    const res = await POST(
      createRequest({
        type: "access",
        name: "Nomsa Dlamini",
        email: "nomsa@example.com",
        idNumber: "8001015009087",
        details: "Please send me a copy of my stored account data.",
        turnstileToken: "tok",
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      reference: expect.stringContaining("DSAR-"),
    });
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-123",
        actorRole: "member",
        action: "dsar_requested",
      })
    );
    expect(mockSendDsarSubmissionEmail).toHaveBeenCalledWith(
      "nomsa@example.com",
      expect.stringContaining("DSAR-"),
      expect.any(String)
    );
  });

  it("rejects cross-site DSAR submissions", async () => {
    const req = createRequest({
      type: "access",
      name: "Nomsa Dlamini",
      email: "nomsa@example.com",
      details: "Please send me a copy of my stored account data.",
      turnstileToken: "tok",
    });

    req.headers.set("origin", "https://evil.example");
    req.headers.set("sec-fetch-site", "cross-site");

    const res = await POST(req);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "Cross-site requests are not allowed",
    });
  });
});
