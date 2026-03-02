import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("SMS");

/**
 * Africa's Talking SMS service for South African phone numbers.
 *
 * Uses the REST API directly via fetch() for edge-runtime compatibility
 * (the africastalking npm SDK depends on Node.js http/https modules which
 * are unavailable in Cloudflare Workers / V8 isolates).
 */

const SmsParamsSchema = z.object({
  to: z.union([
    z.string().regex(/^\+27\d{9}$/, "Must be a valid SA phone number starting with +27"),
    z.array(z.string().regex(/^\+27\d{9}$/)),
  ]),
  message: z.string().min(1, "Message cannot be empty"),
});

type SendSmsParams = z.infer<typeof SmsParamsSchema>;

interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/** Africa's Talking REST API response shape */
interface ATSmsResponse {
  SMSMessageData: {
    Message: string;
    Recipients: Array<{
      number: string;
      status: string;
      statusCode: number;
      messageId: string;
      cost: string;
    }>;
  };
}

/**
 * Send SMS via Africa's Talking REST API (edge-compatible, no SDK required).
 *
 * @param params - SMS parameters (to, message)
 * @returns Result indicating success or failure
 */
export async function sendSms(params: SendSmsParams): Promise<SendSmsResult> {
  if (process.env.NODE_ENV === "development" && process.env.SMS_MOCK === "true") {
    log.info("Mock SMS sent", { to: Array.isArray(params.to) ? params.to[0] : params.to });
    return {
      success: true,
      messageId: "mock-" + Date.now(),
    };
  }

  try {
    const validatedParams = SmsParamsSchema.parse(params);

    const apiKey = process.env.AFRICASTALKING_API_KEY;
    const username = process.env.AFRICASTALKING_USERNAME;

    if (!apiKey || !username) {
      throw new Error("Africa's Talking credentials not configured");
    }

    // Sandbox uses a different host
    const isSandbox = username.toLowerCase() === "sandbox";
    const baseUrl = isSandbox
      ? "https://api.sandbox.africastalking.com"
      : "https://api.africastalking.com";

    const recipients = Array.isArray(validatedParams.to)
      ? validatedParams.to
      : [validatedParams.to];

    const senderId = process.env.AFRICASTALKING_SENDER_ID;

    // Build URL-encoded form body
    const formData = new URLSearchParams();
    formData.set("username", username);
    formData.set("to", recipients.join(","));
    formData.set("message", validatedParams.message);
    if (senderId) {
      formData.set("from", senderId);
    }

    const response = await fetch(`${baseUrl}/version1/messaging`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        apiKey: apiKey,
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      log.error("Africa's Talking HTTP error", {
        status: response.status,
        body: text,
        username,
        baseUrl,
        hasApiKey: !!apiKey,
        apiKeyPrefix: apiKey.slice(0, 10) + "...",
      });
      if (response.status === 401) {
        log.error(
          "AT 401 — API key is rejected. Regenerate it at https://account.africastalking.com → Settings → API Key"
        );
      }
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    const result: ATSmsResponse = await response.json();

    log.info("Africa's Talking response received", {
      recipientCount: result.SMSMessageData?.Recipients?.length ?? 0,
    });

    // Check if message was sent successfully
    if (result.SMSMessageData?.Recipients) {
      const atRecipients = result.SMSMessageData.Recipients;

      if (atRecipients.length === 0) {
        return { success: false, error: "No recipients in SMS response" };
      }

      // Check ALL recipients, not just the first one
      const failed = atRecipients.filter((r) => r.statusCode !== 101);
      if (failed.length > 0) {
        return {
          success: false,
          error: failed[0].status || `${failed.length} of ${atRecipients.length} recipients failed`,
        };
      }

      return {
        success: true,
        messageId: atRecipients[0].messageId,
      };
    }

    return {
      success: false,
      error: "No recipient data in response",
    };
  } catch (error) {
    log.error("Africa's Talking error", {
      error: error instanceof Error ? error.message : "SMS sending failed",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "SMS sending failed",
    };
  }
}

/**
 * Send OTP via SMS
 *
 * @param phone - South African phone number (with +27 prefix)
 * @param otp - 6-digit OTP code
 * @returns Result indicating success or failure
 */
const OtpFormat = z.string().regex(/^\d{6}$/, "OTP must be exactly 6 digits");

export async function sendOtpSms(phone: string, otp: string): Promise<SendSmsResult> {
  // Validate OTP format before embedding in SMS text
  OtpFormat.parse(otp);

  const message = `Your VerifyMzansi verification code is: ${otp}. Valid for 5 minutes. Do not share this code.`;

  return sendSms({
    to: phone,
    message,
  });
}

/**
 * Send notification SMS
 *
 * @param phone - Phone number
 * @param message - Notification message
 * @returns Result indicating success or failure
 */
export async function sendNotificationSms(phone: string, message: string): Promise<SendSmsResult> {
  return sendSms({
    to: phone,
    message: `VerifyMzansi: ${message}`,
  });
}
