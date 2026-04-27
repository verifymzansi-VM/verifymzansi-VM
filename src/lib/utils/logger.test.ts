/* eslint-disable no-console */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "./logger";

describe("logger", () => {
  beforeEach(() => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("creates a logger with all four levels", () => {
    const log = createLogger("Test");
    expect(log.debug).toBeDefined();
    expect(log.info).toBeDefined();
    expect(log.warn).toBeDefined();
    expect(log.error).toBeDefined();
  });

  it("logs messages with context", () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = createLogger("SMS");
    log.info("Message sent");

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("[SMS]"));
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("Message sent"));
  });

  it("outputs structured JSON in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = createLogger("Payments");
    log.error("Payment failed", { amount: 100 });

    const output = vi.mocked(console.error).mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe("error");
    expect(parsed.context).toBe("Payments");
    expect(parsed.message).toBe("Payment failed");
    expect(parsed.meta.amount).toBe(100);
  });

  it("scrubs PII fields in metadata", () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = createLogger("Auth");
    log.info("User login", {
      phone: "+27821234567",
      email: "user@test.com",
      otp: "123456",
      password: "mysecret",
      userId: "safe-value",
    });

    const output = vi.mocked(console.info).mock.calls[0][0] as string;
    expect(output).not.toContain("+27821234567");
    expect(output).not.toContain("user@test.com");
    expect(output).not.toContain("123456");
    expect(output).not.toContain("mysecret");
    expect(output).toContain("safe-value");
  });

  it("scrubs nested PII fields", () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = createLogger("Test");
    log.info("nested", {
      user: { email: "nested@test.com", name: "safe" },
    });

    const output = vi.mocked(console.info).mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.meta.user.email).not.toBe("nested@test.com");
    expect(parsed.meta.user.email).toContain("***");
    expect(parsed.meta.user.name).toBe("safe");
  });

  it("respects log level - suppresses debug in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = createLogger("Test");
    log.debug("This should not appear");

    expect(console.debug).not.toHaveBeenCalled();
  });

  it("respects LOG_LEVEL env override", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "error");
    const log = createLogger("Test");

    log.info("suppressed");
    log.warn("suppressed");
    log.error("visible");

    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("handles metadata with no PII fields", () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = createLogger("Clean");
    log.info("clean log", { count: 5, status: "ok" });

    const output = vi.mocked(console.info).mock.calls[0][0] as string;
    expect(output).toContain('"count":5');
    expect(output).toContain('"status":"ok"');
  });

  it("handles calls without metadata", () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = createLogger("Simple");
    log.info("no meta");

    const output = vi.mocked(console.info).mock.calls[0][0] as string;
    expect(output).toContain("no meta");
    expect(output).not.toContain("{}");
  });

  it("masks short PII values fully", () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = createLogger("Test");
    log.info("short val", { token: "abc" });

    const output = vi.mocked(console.info).mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.meta.token).toBe("***");
  });

  it("scrubs sensitive key variants and headers recursively", () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = createLogger("Webhook");
    log.warn("provider callback failed", {
      headers: {
        authorization: "Bearer live-token-value",
        "set-cookie": "session=super-secret-cookie",
      },
      ozowClientSecret: "client-secret-value",
      refreshToken: "refresh-token-value",
      safeTraceId: "trace-123",
    });

    const output = vi.mocked(console.warn).mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(JSON.stringify(parsed.meta)).not.toContain("live-token-value");
    expect(JSON.stringify(parsed.meta)).not.toContain("super-secret-cookie");
    expect(JSON.stringify(parsed.meta)).not.toContain("client-secret-value");
    expect(JSON.stringify(parsed.meta)).not.toContain("refresh-token-value");
    expect(parsed.meta.safeTraceId).toBe("trace-123");
  });
});
