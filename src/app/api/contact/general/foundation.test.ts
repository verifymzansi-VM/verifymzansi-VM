/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCheckRateLimit,
  mockVerifyTurnstile,
  mockRpc,
  mockSendSupportRequestNotification,
  mockSendSupportAcknowledgement,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockVerifyTurnstile: vi.fn(),
  mockRpc: vi.fn(),
  mockSendSupportRequestNotification: vi.fn(),
  mockSendSupportAcknowledgement: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
vi.mock("@/lib/foundation/service-api", () => ({
  createFoundationServiceApi: () => ({ rpc: mockRpc }),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/turnstile", () => ({ verifyTurnstileToken: mockVerifyTurnstile }));
vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/services/email", () => ({
  sendSupportRequestNotification: mockSendSupportRequestNotification,
  sendSupportAcknowledgement: mockSendSupportAcknowledgement,
}));

import { POST } from "./route";
import { createAdminClient } from "@/lib/supabase/admin";

const TICKET = "6f1c4a52-3b1e-4d7a-9a51-0c2f3e4d5a6b";

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    url: "http://localhost:3000/api/contact/general",
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

describe("POST /api/contact/general (foundation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockVerifyTurnstile.mockResolvedValue({ success: true });
    mockSendSupportRequestNotification.mockResolvedValue({ success: true });
    mockSendSupportAcknowledgement.mockResolvedValue({ success: true });
    mockRpc.mockImplementation(async (name: string) =>
      name === "submit_frontend_support"
        ? { data: { id: TICKET, reused: false, accepted: null }, error: null }
        : { data: true, error: null }
    );
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
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("fails closed in production when Turnstile is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "CAPTCHA service unavailable" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rate limits repeated submissions", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfter: 120 });

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    await expect(response.json()).resolves.toEqual({
      error: "Too many submissions. Please try again later.",
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("accepts long Turnstile tokens from Cloudflare", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const longToken = ` ${"a".repeat(1200)} `;

    const response = await POST(createRequest({ ...validBody, turnstileToken: longToken }));

    expect(response.status).toBe(200);
    expect(mockVerifyTurnstile).toHaveBeenCalledWith({
      token: "a".repeat(1200),
      remoteIp: "127.0.0.1",
    });
  });

  it("blocks repeated messages to one recipient across different IPs", async () => {
    mockCheckRateLimit
      .mockResolvedValueOnce({ limited: false })
      .mockResolvedValueOnce({ limited: true, retryAfter: 60 });

    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(429);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockSendSupportAcknowledgement).not.toHaveBeenCalled();
    expect(mockCheckRateLimit.mock.calls[1][0]).toMatchObject({ degradedMode: "block" });
    expect(mockCheckRateLimit.mock.calls[1][0].key).not.toContain(validBody.email);
  });

  it("stores the request through foundation and never touches the retired backend", async () => {
    const response = await POST(createRequest({ ...validBody, category: "payment_refund" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      reference: `VM-${TICKET.toUpperCase()}`,
      acknowledgement: "accepted",
    });
    expect(mockRpc).toHaveBeenCalledWith(
      "submit_frontend_support",
      {
        p_name: "Nomsa",
        p_email: "nomsa@example.com",
        p_category: "payment_refund",
        p_message: validBody.message,
      },
      { get: false }
    );
    expect(mockSendSupportRequestNotification).toHaveBeenCalledWith("payment_refund", TICKET);
    expect(mockSendSupportAcknowledgement).toHaveBeenCalledWith(
      "nomsa@example.com",
      TICKET,
      "payment_refund"
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
