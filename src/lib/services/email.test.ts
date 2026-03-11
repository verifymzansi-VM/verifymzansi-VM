import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted to ensure mockSend is available in the mock factory
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock("resend", () => {
  class MockResend {
    emails = { send: mockSend };
  }
  return { Resend: MockResend };
});

import {
  sendVerificationApprovedEmail,
  sendVerificationRejectedEmail,
  sendPaymentReceiptEmail,
  sendContactFormNotification,
} from "./email";

describe("email service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "re_test_mock_key");
    mockSend.mockResolvedValue({ data: { id: "msg-123" }, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("sendVerificationApprovedEmail", () => {
    it("sends email with correct subject", async () => {
      const result = await sendVerificationApprovedEmail("user@example.com", "Thabo");

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("msg-123");
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user@example.com",
          subject: expect.stringContaining("Verified"),
        })
      );
    });

    it("includes the account holder name in email body", async () => {
      await sendVerificationApprovedEmail("user@example.com", "Zanele");

      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain("Zanele");
      expect(call.text).toContain("Zanele");
    });
  });

  describe("sendVerificationRejectedEmail", () => {
    it("sends rejection email with reason", async () => {
      const result = await sendVerificationRejectedEmail(
        "user@example.com",
        "Sipho",
        "ID document blurry"
      );

      expect(result.success).toBe(true);
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain("ID document blurry");
      expect(call.text).toContain("ID document blurry");
    });
  });

  describe("sendPaymentReceiptEmail", () => {
    it("sends receipt with amount and plan name", async () => {
      const result = await sendPaymentReceiptEmail(
        "user@example.com",
        "Nomsa",
        199.0,
        "Mzansi Market Pro"
      );

      expect(result.success).toBe(true);
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain("199.00");
      expect(call.html).toContain("Mzansi Market Pro");
    });

    it("includes invoice URL when provided", async () => {
      await sendPaymentReceiptEmail(
        "user@example.com",
        "Lebo",
        99.0,
        "Starter",
        "https://example.com/invoice/123"
      );

      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain("https://example.com/invoice/123");
    });
  });

  describe("sendContactFormNotification", () => {
    it("sends contact notification with all details", async () => {
      const result = await sendContactFormNotification(
        "account@example.com",
        "Andile",
        "Buyer Guy",
        "buyer@example.com",
        "Is this still available?",
        "Toyota Hilux 2022"
      );

      expect(result.success).toBe(true);
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain("Toyota Hilux 2022");
      expect(call.html).toContain("Buyer Guy");
      expect(call.html).toContain("Is this still available?");
      expect(call.subject).toContain("Toyota Hilux 2022");
    });
  });

  describe("error handling", () => {
    it("returns error when Resend responds with error", async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: "Invalid email" },
      });

      const result = await sendVerificationApprovedEmail("bad-email", "Test");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid email");
    });

    it("returns error when send throws", async () => {
      mockSend.mockRejectedValue(new Error("Network timeout"));

      const result = await sendVerificationApprovedEmail("user@example.com", "Test");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network timeout");
    });
  });
});
