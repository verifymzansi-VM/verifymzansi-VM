import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend, mockInfo, mockSchedule } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockInfo: vi.fn(),
  mockSchedule: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  PutObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { input };
  }),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: mockInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/lib/utils/background-task", () => ({ scheduleBackgroundTask: mockSchedule }));

import {
  buildSecurityEvent,
  clientFamily,
  recordSecurityEvent,
  sanitizeRoute,
  securityContext,
  securityEventObjectKey,
  writeSecurityEvent,
} from "./security-events";

const KEY = "k".repeat(40);
const EMAIL = "Thando.Dlamini@example.com";
const IP = "196.25.1.200";
const ACCOUNT = "5b0f9a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

describe("security events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SECURITY_LOG_HASH_KEY", KEY);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("keeps only allowlisted fields and never the raw email, IP or query", async () => {
    const record = await buildSecurityEvent(
      {
        event: "auth.sign_in.failed",
        accountId: ACCOUNT,
        ip: IP,
        email: EMAIL,
        country: "ZA",
        userAgent:
          "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36",
        route: `/api/posts/${ACCOUNT}/contact?phone=0821234567`,
        reason: "invalid_credentials",
      },
      new Date("2026-10-22T10:00:00.000Z")
    );
    expect(Object.keys(record).sort()).toEqual(
      [
        "v",
        "event",
        "at",
        "account_id",
        "ip_fp",
        "email_fp",
        "country",
        "client",
        "route",
        "reason",
      ].sort()
    );
    const text = JSON.stringify(record);
    for (const raw of [EMAIL, EMAIL.toLowerCase(), IP, "0821234567", "phone", "Mozilla"])
      expect(text).not.toContain(raw);
    expect(record.route).toBe("/api/posts/:id/contact");
    expect(record.client).toBe("chrome/android");
    expect(record.ip_fp).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("gives one source the same fingerprint, separated by kind and key", async () => {
    const a = await buildSecurityEvent({ event: "request.rate_limited", ip: IP, email: EMAIL });
    const b = await buildSecurityEvent({
      event: "request.rate_limited",
      ip: ` ${IP} `,
      email: EMAIL.toLowerCase(),
    });
    expect(a.ip_fp).toBe(b.ip_fp);
    expect(a.email_fp).toBe(b.email_fp);
    expect(a.ip_fp).not.toBe(a.email_fp);
    vi.stubEnv("SECURITY_LOG_HASH_KEY", "z".repeat(40));
    const c = await buildSecurityEvent({ event: "request.rate_limited", ip: IP });
    expect(c.ip_fp).not.toBe(a.ip_fp);
  });

  it("drops fingerprints rather than writing raw values when no key is configured", async () => {
    vi.stubEnv("SECURITY_LOG_HASH_KEY", "short");
    const record = await buildSecurityEvent({ event: "auth.sign_in.failed", ip: IP, email: EMAIL });
    expect(record).toEqual({ v: 1, event: "auth.sign_in.failed", at: record.at });
  });

  it("rejects unknown events and drops malformed values", async () => {
    await expect(
      buildSecurityEvent({ event: "auth.password" as "auth.sign_in.failed" })
    ).rejects.toThrow("Unknown security event");
    const record = await buildSecurityEvent({
      event: "request.permission_denied",
      accountId: "not-a-uuid",
      country: "South Africa",
      reason: "has spaces and @ signs",
      route: "relative/path",
    });
    expect(record).toEqual({ v: 1, event: "request.permission_denied", at: record.at });
  });

  it("reduces browsers and paths", () => {
    expect(clientFamily("curl/8.4.0")).toBe("script/other");
    expect(clientFamily("Mozilla/5.0 (iPhone) Version/17.0 Mobile Safari/604.1")).toBe(
      "safari/ios"
    );
    expect(clientFamily(null)).toBeUndefined();
    expect(sanitizeRoute("/profile/1234567/edit#x")).toBe("/profile/:n/edit");
    expect(sanitizeRoute("/a/<script>")).toBe("/:segment/:segment");
    expect(sanitizeRoute("/api/auth/reset-password/aSecretResetToken")).toBe(
      "/api/auth/reset-password/:segment"
    );
    expect(sanitizeRoute("/profile/thando.dlamini@example.com")).toBe("/profile/:segment");
  });

  it("reads client context from Cloudflare headers", () => {
    const request = new Request("https://verifymzansi.com/api/auth/login?next=/admin", {
      headers: { "cf-connecting-ip": IP, "cf-ipcountry": "ZA", "user-agent": "curl/8" },
    });
    expect(securityContext(request)).toEqual({
      ip: IP,
      country: "ZA",
      userAgent: "curl/8",
      route: "/api/auth/login",
    });
  });

  it("logs every event and writes to the private bucket only when fully configured", async () => {
    await writeSecurityEvent({ event: "auth.sign_in.succeeded", accountId: ACCOUNT });
    expect(mockInfo).toHaveBeenCalledWith(
      "security_event",
      expect.objectContaining({ event: "auth.sign_in.succeeded", account_id: ACCOUNT })
    );
    expect(mockSend).not.toHaveBeenCalled();

    vi.stubEnv("R2_ACCOUNT_ID", "account");
    vi.stubEnv("SECURITY_LOG_BUCKET", "verifymzansi-security-logs");
    vi.stubEnv("SECURITY_LOG_R2_ACCESS_KEY_ID", "id");
    vi.stubEnv("SECURITY_LOG_R2_SECRET_ACCESS_KEY", "secret");
    await writeSecurityEvent({ event: "auth.sign_in.failed", email: EMAIL });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const put = mockSend.mock.calls[0][0].input as { Bucket: string; Key: string; Body: string };
    expect(put.Bucket).toBe("verifymzansi-security-logs");
    expect(put.Key).toMatch(/^events\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/[0-9T-]+Z-[0-9a-f-]{36}\.json$/);
    expect(put.Body).not.toContain(EMAIL.toLowerCase());
    expect(JSON.parse(put.Body).event).toBe("auth.sign_in.failed");
  });

  it("records a repeated rate-limit hit from one source once a minute", async () => {
    await writeSecurityEvent({
      event: "request.rate_limited",
      rateLimitKey: "203.0.113.9",
      reason: "auth:login",
    });
    await writeSecurityEvent({
      event: "request.rate_limited",
      rateLimitKey: "203.0.113.9",
      reason: "auth:login",
    });
    await writeSecurityEvent({
      event: "request.rate_limited",
      rateLimitKey: "203.0.113.10",
      reason: "auth:login",
    });
    expect(mockInfo).toHaveBeenCalledTimes(2);
  });

  it("files objects by UTC hour", () => {
    expect(
      securityEventObjectKey({ v: 1, event: "auth.sign_in.failed", at: "2026-10-22T09:05:01.250Z" })
    ).toMatch(/^events\/2026\/10\/22\/09\/2026-10-22T090501250Z-/);
  });

  it("schedules the write without awaiting it", () => {
    recordSecurityEvent({ event: "request.csrf_rejected" });
    expect(mockSchedule).toHaveBeenCalledWith(expect.any(Promise), "security event");
  });
});
