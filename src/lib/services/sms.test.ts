import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSms, sendOtpSms, sendNotificationSms } from "./sms";

/** Helper to build a mock fetch Response returning a JSON body */
function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

describe("sms service", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // Force production-path (skip dev mock) so fetch is exercised
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AFRICASTALKING_API_KEY", "test-key");
    vi.stubEnv("AFRICASTALKING_USERNAME", "sandbox");
    vi.stubEnv("AFRICASTALKING_SENDER_ID", "VerifyMzansi");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  describe("sendSms", () => {
    it("sends SMS successfully", async () => {
      globalThis.fetch = mockFetchResponse({
        SMSMessageData: {
          Recipients: [{ statusCode: 101, messageId: "sms-123", status: "Success" }],
        },
      });

      const result = await sendSms({
        to: "+27821234567",
        message: "Hello",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("sms-123");

      // Verify fetch was called with correct Africa's Talking API endpoint
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.sandbox.africastalking.com/version1/messaging",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("handles array of recipients", async () => {
      globalThis.fetch = mockFetchResponse({
        SMSMessageData: {
          Recipients: [{ statusCode: 101, messageId: "sms-456" }],
        },
      });

      const result = await sendSms({
        to: ["+27821234567", "+27829876543"],
        message: "Bulk message",
      });

      expect(result.success).toBe(true);

      // Verify both numbers are comma-separated in the form body
      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = callArgs[1].body as string;
      expect(body).toContain("%2B27821234567%2C%2B27829876543");
    });

    it("returns failure for non-101 status code", async () => {
      globalThis.fetch = mockFetchResponse({
        SMSMessageData: {
          Recipients: [{ statusCode: 403, status: "Insufficient balance" }],
        },
      });

      const result = await sendSms({
        to: "+27821234567",
        message: "Fail test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Insufficient balance");
    });

    it("returns failure when no recipient data", async () => {
      globalThis.fetch = mockFetchResponse({ SMSMessageData: {} });

      const result = await sendSms({
        to: "+27821234567",
        message: "No recipients",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("No recipient data in response");
    });

    it("catches thrown errors", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("API Down"));

      const result = await sendSms({
        to: "+27821234567",
        message: "crash",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("API Down");
    });

    it("handles HTTP error responses", async () => {
      globalThis.fetch = mockFetchResponse("Unauthorized", 401);

      const result = await sendSms({
        to: "+27821234567",
        message: "test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 401");
    });

    it("uses production URL when username is not sandbox", async () => {
      vi.stubEnv("AFRICASTALKING_USERNAME", "my_app");

      globalThis.fetch = mockFetchResponse({
        SMSMessageData: {
          Recipients: [{ statusCode: 101, messageId: "prod-1" }],
        },
      });

      await sendSms({ to: "+27821234567", message: "prod test" });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.africastalking.com/version1/messaging",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("sendOtpSms", () => {
    it("sends OTP with correct format", async () => {
      globalThis.fetch = mockFetchResponse({
        SMSMessageData: {
          Recipients: [{ statusCode: 101, messageId: "otp-1" }],
        },
      });

      const result = await sendOtpSms("+27821234567", "123456");

      expect(result.success).toBe(true);

      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = decodeURIComponent(callArgs[1].body as string);
      expect(body).toContain("123456");
    });
  });

  describe("sendNotificationSms", () => {
    it("prefixes message with VerifyMzansi", async () => {
      globalThis.fetch = mockFetchResponse({
        SMSMessageData: {
          Recipients: [{ statusCode: 101, messageId: "notif-1" }],
        },
      });

      await sendNotificationSms("+27821234567", "Your listing was approved");

      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = new URLSearchParams(callArgs[1].body as string);
      expect(body.get("message")).toBe("VerifyMzansi: Your listing was approved");
    });
  });
});
