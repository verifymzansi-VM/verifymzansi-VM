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
  sendSupportRequestNotification,
  sendSupportAcknowledgement,
  sendModerationNoticeEmail,
  sendDsarExtensionEmail,
  sendPlatformNotice,
  sendOutboxFinalFailureAlert,
} from "./email";

describe("email service", () => {
  it("sends the full escaped account-warning reason with the durable event key", async () => {
    const reason = "Review <script>not executable</script> & keep the complete explanation.";
    await sendPlatformNotice(
      "owner@example.invalid",
      "account_warning",
      "foundation-outbox/synthetic",
      reason
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].html).toContain(
      "&lt;script&gt;not executable&lt;/script&gt; &amp;"
    );
    expect(mockSend.mock.calls[0][0].html).not.toContain("<script>");
    expect(mockSend.mock.calls[0][0].text).toContain(reason);
    expect(mockSend.mock.calls[0][1].idempotencyKey).toBe("foundation-outbox/synthetic");
    await expect(
      sendPlatformNotice("owner@example.invalid", "account_warning", "foundation-outbox/missing")
    ).rejects.toThrow("details unavailable");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
  it("tells owners of expired, sold and kept posts when they will be deleted", async () => {
    const deletesAt = "2026-11-12T08:30:00Z"; // 10:30 in South Africa
    await sendPlatformNotice("owner@example.invalid", "post_expired", "outbox/expired", undefined, {
      deletesAt,
      holdsSlot: false,
    });
    await sendPlatformNotice("owner@example.invalid", "post_sold", "outbox/sold", undefined, {
      deletesAt,
      holdsSlot: true,
    });
    await sendPlatformNotice("owner@example.invalid", "post_sold", "outbox/early", undefined, {
      deletesAt,
      holdsSlot: false,
    });
    await sendPlatformNotice("owner@example.invalid", "post_kept", "outbox/kept", undefined, {
      deletesAt,
    });
    const [expired, sold, soldEarlier, kept] = mockSend.mock.calls.map(([message]) => message);
    expect(expired.subject).toBe("Your post has expired");
    expect(expired.text).toMatch(/deleted, with its photos and videos, on 12 November 2026.*10:30/);
    expect(expired.text).toContain("ended or was cancelled");
    expect(expired.text).toContain("buy a plan and reactivate it");
    expect(sold.subject).toBe("Your post is marked as sold");
    expect(sold.text).toMatch(/on 12 November 2026/);
    expect(sold.text).toContain("delete the post yourself to free the slot sooner");
    expect(soldEarlier.text).not.toContain("slot");
    expect(kept.subject).toBe("Your post is kept after your payment");
    expect(kept.text).toMatch(/kept until 12 November 2026/);
    expect(sold.text).toContain("/dashboard");
  });
  it("words lifecycle notices without a date when the job does not know it", async () => {
    await sendPlatformNotice("owner@example.invalid", "post_expired", "outbox/expired");
    await sendPlatformNotice("owner@example.invalid", "post_sold", "outbox/sold", undefined, {
      deletesAt: "not a date",
    });
    const [expired, sold] = mockSend.mock.calls.map(([message]) => message);
    expect(expired.text).not.toMatch(/ on [0-9]/);
    expect(expired.text).toContain("otherwise it will be deleted");
    expect(sold.text).toContain("deleted, with its photos and videos, shortly");
    expect(`${expired.text}${sold.text}`).not.toMatch(/3 days|30 days/);
  });
  it("passes durable job keys to Resend for repeatable notices", async () => {
    await sendModerationNoticeEmail({
      email: "user@example.com",
      accountName: "Thando",
      template: "account_ban",
      decisionId: "decision-1",
      idempotencyKey: "operation-job/job-1",
    });
    await sendDsarExtensionEmail(
      "user@example.com",
      "DSAR-12345678",
      "2026-11-01T00:00:00Z",
      "Records in two systems",
      "operation-job/job-2"
    );
    expect(mockSend.mock.calls.map(([, options]) => options.idempotencyKey)).toEqual([
      "operation-job/job-1",
      "operation-job/job-2",
    ]);
  });
  it("routes enquiry replies to the buyer rather than support", async () => {
    await sendContactFormNotification(
      "seller@example.com",
      "Seller",
      "Buyer",
      "buyer@example.com",
      "Is this still available?",
      "Garden cottage"
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "seller@example.com", replyTo: "buyer@example.com" }),
      expect.objectContaining({ idempotencyKey: expect.any(String) })
    );
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RESEND_API_KEY", "re_test_mock_key");
    mockSend.mockResolvedValue({ data: { id: "msg-123" }, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
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
          subject: expect.stringContaining("ID has been reviewed"),
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) })
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

    it("states the expiry date and that plans do not auto-renew for subscriptions", async () => {
      await sendPaymentReceiptEmail(
        "user@example.com",
        "Nomsa",
        199.0,
        "Mzansi Market Pro",
        undefined,
        { kind: "subscription", expiresAt: "2026-05-24T10:00:00.000Z" }
      );

      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toBe("Payment Receipt - Mzansi Market Pro");
      expect(call.html).toContain("24 May 2026");
      expect(call.html).toContain("do not auto-renew");
      expect(call.html).not.toContain("renew automatically");
      // Post lifecycle rules (9 November 2026): ended posts are deleted after 3 days.
      for (const body of [call.html, call.text])
        expect(body).toContain(
          "When your plan ends, its posts are hidden and deleted 3 days later unless you buy a new plan and reactivate them."
        );
      expect(call.text).toContain("24 May 2026");
      expect(call.text).not.toContain("renew automatically");
    });

    it("uses an add-on subject and body naming the add-on and its duration", async () => {
      await sendPaymentReceiptEmail("user@example.com", "Sipho", 99.0, "Mzansi Market", undefined, {
        kind: "addon",
        addonName: "Listing Boost",
        durationDays: 7,
      });

      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toBe("Payment Receipt - Listing Boost");
      expect(call.html).toContain("Listing Boost");
      expect(call.html).toContain("7 days");
      expect(call.html).toContain("one-time purchase");
      expect(call.html).not.toContain("renew automatically");
      expect(call.text).toContain("Listing Boost");
      expect(call.text).toContain("7 days");
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
    it("retries a timeout with the same key and clears the timer after acceptance", async () => {
      vi.useFakeTimers();
      mockSend.mockImplementationOnce(() => new Promise(() => {}));
      const pending = sendVerificationApprovedEmail("user@example.com", "Test");
      await vi.advanceTimersByTimeAsync(9_000);
      expect(await pending).toMatchObject({ success: true });
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[0][1]).toEqual(mockSend.mock.calls[1][1]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("retries a structured 503 even when the message has no status code", async () => {
      vi.useFakeTimers();
      mockSend.mockResolvedValueOnce({
        data: null,
        error: { statusCode: 503, message: "Unavailable" },
      });
      const pending = sendVerificationApprovedEmail("user@example.com", "Test");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toMatchObject({ success: true });
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("does not retry validation errors containing numbers", async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { statusCode: 422, message: "Invalid address 503" },
      });
      expect((await sendVerificationApprovedEmail("user@example.com", "Test")).success).toBe(false);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("does not report acceptance without a provider message ID", async () => {
      mockSend.mockResolvedValue({ data: null, error: null });
      expect((await sendVerificationApprovedEmail("user@example.com", "Test")).success).toBe(false);
    });

    it("uses separate keys for independent emails", async () => {
      await sendVerificationApprovedEmail("user@example.com", "Test");
      await sendVerificationApprovedEmail("user@example.com", "Test");
      expect(mockSend.mock.calls[0][1]).not.toEqual(mockSend.mock.calls[1][1]);
    });

    it("stops after three timeouts without leaking timers", async () => {
      vi.useFakeTimers();
      mockSend.mockImplementation(() => new Promise(() => {}));
      const pending = sendVerificationApprovedEmail("user@example.com", "Test");
      await vi.advanceTimersByTimeAsync(27_000);
      expect(await pending).toMatchObject({ success: false, error: "Email send timed out" });
      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each(["concurrent_idempotent_requests", "invalid_idempotent_request"])(
      "reports a repeated-request refusal (%s) as an unknown outcome, not a failure",
      async (name) => {
        mockSend.mockResolvedValue({
          data: null,
          error: { name, message: "Same idempotency key", statusCode: 409 },
        });
        const result = await sendPlatformNotice(
          "owner@example.invalid",
          "post_expired",
          "foundation-outbox/synthetic"
        );
        expect(result).toMatchObject({ success: false, outcomeUnknown: true });
        expect(mockSend).toHaveBeenCalledOnce();
      }
    );

    it("marks lost emails that may have been delivered in the alert", async () => {
      await sendOutboxFinalFailureAlert([
        { id: "00000000-0000-4000-8000-00000000000c", kind: "post_kept", maybeDelivered: true },
      ]);
      expect(mockSend.mock.calls[0][0].text).toContain(
        "post kept (may have been delivered): 00000000-0000-4000-8000-00000000000c"
      );
      expect(mockSend.mock.calls[0][0].html).toContain("may have been delivered");
    });

    it("alerts the support address about lost queued emails without recipient details", async () => {
      const a = "00000000-0000-4000-8000-00000000000a";
      const b = "00000000-0000-4000-8000-00000000000b";
      await sendOutboxFinalFailureAlert([
        { id: b, kind: "payment_completed" },
        { id: a, kind: "post_expired" },
      ]);
      await sendOutboxFinalFailureAlert([
        { id: a, kind: "post_expired" },
        { id: b, kind: "payment_completed" },
      ]);
      const [payload, options] = mockSend.mock.calls[0];
      expect(payload).toMatchObject({
        to: "support@verifymzansi.com",
        subject: expect.stringContaining("2 queued emails"),
        text: expect.stringContaining(`payment completed: ${b}`),
      });
      expect(payload.subject).toContain("(1 payment)");
      expect(payload.html).toContain(a);
      expect(options.idempotencyKey).toMatch(/^outbox-final-failure\/[0-9a-f]{64}$/);
      expect(mockSend.mock.calls[1][1].idempotencyKey).toBe(options.idempotencyKey);
      expect(mockSend.mock.calls[1][0].text).toBe(payload.text);
    });

    it("routes payment support to billing with an authenticated queue link", async () => {
      await sendSupportRequestNotification("payment_refund", "request-123");
      expect(mockSend.mock.calls[0][0]).toMatchObject({
        to: "billing@verifymzansi.com",
        text: expect.stringContaining("/admin/support"),
      });
    });

    it("acknowledges with a stable reference and category reply address", async () => {
      await sendSupportAcknowledgement("sender@example.com", "request-123", "privacy_popia");
      expect(mockSend.mock.calls[0][0]).toMatchObject({
        to: "sender@example.com",
        replyTo: "privacy@verifymzansi.com",
        text: expect.stringContaining("VM-REQUEST-123"),
      });
      expect(mockSend.mock.calls[0][1]).toEqual({ idempotencyKey: "support-ack/request-123" });
    });
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
