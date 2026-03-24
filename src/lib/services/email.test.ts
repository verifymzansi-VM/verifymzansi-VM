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
  sendAccountEnforcementEmail,
  sendPaymentFailedEmail,
  sendVerificationApprovedEmail,
  sendVerificationRejectedEmail,
  sendVerificationResubmissionEmail,
  sendPaymentReceiptEmail,
  sendDsarCompletedEmail,
  sendDsarSubmissionEmail,
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

  describe("sendVerificationResubmissionEmail", () => {
    it("sends resubmission email with reason", async () => {
      const result = await sendVerificationResubmissionEmail(
        "user@example.com",
        "Sipho",
        "Please upload a clearer selfie"
      );

      expect(result.success).toBe(true);
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain("resubmission");
      expect(call.html).toContain("Please upload a clearer selfie");
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

  describe("sendPaymentFailedEmail", () => {
    it("sends failed payment template with billing retry link", async () => {
      const result = await sendPaymentFailedEmail(
        "user@example.com",
        "Nomsa",
        149,
        "Mzansi Business"
      );

      expect(result.success).toBe(true);
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain("Payment failed");
      expect(call.html).toContain("Retry payment");
    });
  });

  describe("sendAccountEnforcementEmail", () => {
    it("sends suspension account update with reason", async () => {
      const result = await sendAccountEnforcementEmail({
        email: "user@example.com",
        accountName: "Lebo",
        action: "suspend",
        reason: "Repeated policy violations",
        suspendedUntil: "2026-04-01T10:00:00.000Z",
      });

      expect(result.success).toBe(true);
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain("Account suspended");
      expect(call.html).toContain("Repeated policy violations");
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

  describe("sendDsarSubmissionEmail", () => {
    it("sends DSAR confirmation with reference and due date", async () => {
      const result = await sendDsarSubmissionEmail(
        "user@example.com",
        "DSAR-1234ABCD",
        "2026-04-16T00:00:00.000Z"
      );

      expect(result.success).toBe(true);
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain("DSAR-1234ABCD");
      expect(call.html).toContain("DSAR-1234ABCD");
      expect(call.text).toContain("DSAR-1234ABCD");
    });
  });

  describe("sendDsarCompletedEmail", () => {
    it("sends DSAR completion with summary when provided", async () => {
      const result = await sendDsarCompletedEmail(
        "user@example.com",
        "DSAR-1234ABCD",
        "Your account export was delivered securely"
      );

      expect(result.success).toBe(true);
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain("DSAR-1234ABCD");
      expect(call.html).toContain("Your account export was delivered securely");
      expect(call.text).toContain("Your account export was delivered securely");
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
