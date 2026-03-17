import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateAdminClient, mockLogAuditEvent, mockSendDsarSubmissionEmail } = vi.hoisted(
  () => ({
    mockCreateAdminClient: vi.fn(),
    mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
    mockSendDsarSubmissionEmail: vi.fn().mockResolvedValue({ success: true }),
  })
);

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/services/email", () => ({
  sendDsarSubmissionEmail: mockSendDsarSubmissionEmail,
}));

import { POST } from "@/app/api/dsar/submit/route";

function createRequest(body: unknown) {
  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/dsar/submit",
    headers: {
      get() {
        return null;
      },
    },
  } as unknown as NextRequest;
}

describe("POST /api/dsar/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TURNSTILE_SECRET_KEY;
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
    expect(mockLogAuditEvent).toHaveBeenCalled();
    expect(mockSendDsarSubmissionEmail).toHaveBeenCalledWith(
      "nomsa@example.com",
      expect.stringContaining("DSAR-"),
      expect.any(String)
    );
  });
});
