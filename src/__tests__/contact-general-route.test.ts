import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateAdminClient,
  mockCheckRateLimit,
  mockVerifyTurnstile,
  mockLogger,
  mockNotifyStaffForAdminEvent,
  mockSendSupportRequestNotification,
  mockSendSupportAcknowledgement,
  mockAudit,
} = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockCheckRateLimit: vi.fn().mockReturnValue({ limited: false }),
  mockVerifyTurnstile: vi.fn().mockResolvedValue({ success: true }),
  mockNotifyStaffForAdminEvent: vi.fn().mockResolvedValue(true),
  mockSendSupportRequestNotification: vi.fn().mockResolvedValue({ success: true }),
  mockSendSupportAcknowledgement: vi.fn().mockResolvedValue({ success: true, messageId: "ack-id" }),
  mockAudit: vi.fn().mockResolvedValue(undefined),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/turnstile", () => ({
  verifyTurnstileToken: mockVerifyTurnstile,
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => mockLogger,
}));
vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/notifications", () => ({
  notifyStaffForAdminEvent: mockNotifyStaffForAdminEvent,
}));
vi.mock("@/lib/services/email", () => ({
  sendSupportRequestNotification: mockSendSupportRequestNotification,
  sendSupportAcknowledgement: mockSendSupportAcknowledgement,
}));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockAudit }));

import { POST } from "@/app/api/contact/general/route";

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    json: async () => body,
    headers: { get: vi.fn().mockReturnValue("203.0.113.10") },
    nextUrl: new URL("http://localhost:3000/api/contact/general"),
  } as unknown as NextRequest;
}

const validBody = {
  name: "Nomsa",
  email: "nomsa@example.com",
  message: "Hello there, I would like more information.",
  turnstileToken: "turnstile-token",
};

describe("POST /api/contact/general", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockReturnValue({ limited: false });
    mockVerifyTurnstile.mockResolvedValue({ success: true });
    mockSendSupportRequestNotification.mockResolvedValue({ success: true });
    mockSendSupportAcknowledgement.mockResolvedValue({ success: true, messageId: "ack-id" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects invalid JSON payloads", async () => {
    const response = await POST({
      method: "POST",
      json: async () => {
        throw new Error("bad json");
      },
      headers: { get: vi.fn().mockReturnValue(null) },
    } as unknown as NextRequest);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON payload" });
  });

  it("fails closed in production when Turnstile is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.TURNSTILE_SECRET_KEY;

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "CAPTCHA service unavailable" });
  });

  it("rate limits repeated submissions", async () => {
    mockCheckRateLimit.mockReturnValue({ limited: true, retryAfter: 120 });

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    await expect(response.json()).resolves.toEqual({
      error: "Too many submissions. Please try again later.",
    });
  });

  it("returns a safe error when inquiry persistence fails", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({
          error: { message: "db exploded" },
        }),
      }),
    });

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to submit message",
    });
    expect(mockLogger.error).toHaveBeenCalledWith("Failed to store contact submission", {
      error: "db exploded",
    });
  });

  it("sanitizes stored messages and acknowledges success", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    });

    const response = await POST(
      createRequest({
        ...validBody,
        message: '<script>alert("xss")</script>Hello from customer support form.',
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reference: expect.stringMatching(/^VM-/),
      acknowledgement: "accepted",
    });
    expect(insert).toHaveBeenCalledWith({
      id: expect.any(String),
      name: "Nomsa",
      email: "nomsa@example.com",
      message: "[general_support] alert(&quot;xss&quot;)Hello from customer support form.",
      status: "new",
    });
    expect(mockLogger.info).toHaveBeenCalledWith("Contact form submission received", {
      name: "Nomsa",
      category: "general_support",
      email: "nom***",
    });
    expect(mockNotifyStaffForAdminEvent).toHaveBeenCalledWith({
      capability: "queue:view",
      title: "New support request submitted",
      message: "Nomsa submitted a general support request.",
      href: "/admin/support",
    });
  });

  it("accepts long Turnstile tokens from Cloudflare", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    });

    const longToken = ` ${"a".repeat(1200)} `;
    const response = await POST(createRequest({ ...validBody, turnstileToken: longToken }));

    expect(response.status).toBe(200);
    expect(mockVerifyTurnstile).toHaveBeenCalledWith({
      token: "a".repeat(1200),
      remoteIp: "203.0.113.10",
    });
  });

  it("preserves saved requests when the email alert fails", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    });
    mockSendSupportRequestNotification.mockResolvedValue({ success: false, error: "Unavailable" });
    const response = await POST(createRequest({ ...validBody, category: "payment_refund" }));
    expect(response.status).toBe(200);
    expect(mockSendSupportRequestNotification).toHaveBeenCalledWith(
      "payment_refund",
      expect.any(String)
    );
    expect(mockLogger.warn).toHaveBeenCalledWith("Support request stored but email failed", {
      submissionId: expect.any(String),
      template: "support_staff_alert",
    });
  });

  it("records acknowledgement failure without losing a saved request", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockCreateAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue({ insert }) });
    mockSendSupportAcknowledgement.mockResolvedValue({ success: false, error: "Unavailable" });
    const response = await POST(createRequest(validBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, acknowledgement: "failed" });
    const id = insert.mock.calls[0][0].id;
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "communication_email_failed",
        targetId: id,
        targetType: "contact_submission",
        metadata: expect.objectContaining({ template: "support_acknowledgement" }),
      })
    );
    expect(mockSendSupportAcknowledgement).toHaveBeenCalledWith(
      validBody.email,
      id,
      "general_support"
    );
  });

  it("blocks repeated messages to one recipient across different IPs", async () => {
    mockCheckRateLimit
      .mockReturnValueOnce({ limited: false })
      .mockReturnValueOnce({ limited: true, retryAfter: 60 });
    const response = await POST(createRequest(validBody));
    expect(response.status).toBe(429);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockSendSupportAcknowledgement).not.toHaveBeenCalled();
    expect(mockCheckRateLimit.mock.calls[1][0]).toMatchObject({ degradedMode: "block" });
    expect(mockCheckRateLimit.mock.calls[1][0].key).not.toContain(validBody.email);
  });
});
