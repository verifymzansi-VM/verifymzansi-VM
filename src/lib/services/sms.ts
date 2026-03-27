import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("SMS");
const AT_SENDER_ID_REGEX = /^[A-Za-z0-9]{1,12}$/;

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

interface SendSmsAttemptResult extends SendSmsResult {
  invalidSenderIdRejected?: boolean;
}

interface SenderIdValidationResult {
  valid: boolean;
  value?: string;
  reason?: string;
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

function validateAfricaTalkingSenderId(senderId: string | undefined): SenderIdValidationResult {
  if (!senderId) {
    return { valid: false, reason: "missing" };
  }

  const trimmed = senderId.trim();
  if (!trimmed) {
    return { valid: false, reason: "blank" };
  }

  if (!AT_SENDER_ID_REGEX.test(trimmed)) {
    return {
      valid: false,
      reason: "must be 1-12 alphanumeric characters",
    };
  }

  return { valid: true, value: trimmed };
}

/**
 * Send SMS via Africa's Talking REST API (edge-compatible, no SDK required).
 * Retries transient failures (network errors, 5xx) up to MAX_RETRIES times
 * with exponential backoff before surfacing the error.
 *
 * @param params - SMS parameters (to, message)
 * @returns Result indicating success or failure
 */
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

function isRetryable(error: unknown, statusCode?: number): boolean {
  if (statusCode && statusCode >= 500) return true;
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  if (error instanceof TypeError) return true; // fetch network error
  return false;
}

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

    const senderIdResult = validateAfricaTalkingSenderId(process.env.AFRICASTALKING_SENDER_ID);
    if (!senderIdResult.valid && process.env.AFRICASTALKING_SENDER_ID) {
      log.warn("Ignoring invalid Africa's Talking sender ID", {
        reason: senderIdResult.reason,
        configuredLength: process.env.AFRICASTALKING_SENDER_ID.trim().length,
      });
    }

    const sendAttempt = async (includeSenderId: boolean): Promise<SendSmsAttemptResult> => {
      const formData = new URLSearchParams();
      formData.set("username", username);
      formData.set("to", recipients.join(","));
      formData.set("message", validatedParams.message);
      if (includeSenderId && senderIdResult.valid && senderIdResult.value) {
        formData.set("from", senderIdResult.value);
      }

      const response = await fetch(`${baseUrl}/version1/messaging`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          apiKey: apiKey,
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      // Read body once as text so we can log it before parsing
      const rawBody = await response.text();

      if (!response.ok) {
        log.error("Africa's Talking HTTP error", {
          status: response.status,
          body: rawBody,
          username,
          baseUrl,
          hasApiKey: !!apiKey,
          apiKeyPrefix: apiKey.slice(0, 4) + "...",
          includeSenderId,
        });
        if (response.status === 401) {
          log.error(
            "AT 401 — API key is rejected. Regenerate it at https://account.africastalking.com → Settings → API Key"
          );
        }
        return { success: false, error: `HTTP ${response.status}: ${rawBody}` };
      }

      let result: ATSmsResponse;
      try {
        result = JSON.parse(rawBody);
      } catch (parseErr) {
        log.error("Africa's Talking JSON parse error", {
          rawBody: rawBody.slice(0, 500),
          error: parseErr instanceof Error ? parseErr.message : "Unknown parse error",
          includeSenderId,
        });
        // AT returned 200 OK but body isn't valid JSON — do not assume success
        return { success: false, error: "Unexpected response format from SMS provider" };
      }

      log.info("Africa's Talking response received", {
        recipientCount: result.SMSMessageData?.Recipients?.length ?? 0,
        rawResponse: rawBody.slice(0, 500),
        includeSenderId,
      });

      const providerMessage = result.SMSMessageData?.Message?.trim();

      if (result.SMSMessageData?.Recipients) {
        const atRecipients = result.SMSMessageData.Recipients;

        if (atRecipients.length === 0) {
          const normalizedProviderMessage = providerMessage?.toLowerCase() ?? "";
          if (
            normalizedProviderMessage.includes("invalidsenderid") ||
            normalizedProviderMessage.includes("invalid sender")
          ) {
            log.warn("AT rejected sender ID", {
              providerMessage,
              includeSenderId,
            });
            return {
              success: false,
              error: providerMessage || "SMS provider rejected the configured sender ID",
              invalidSenderIdRejected: true,
            };
          }

          // AT can accept the message before per-recipient details are available.
          log.warn("AT returned 200 OK with empty Recipients array", {
            rawBody: rawBody.slice(0, 500),
            includeSenderId,
          });
          return { success: true, messageId: "at-accepted-empty-recipients" };
        }

        // AT success codes: 100 (Processed), 101 (Sent), 102 (Queued)
        // Anything under 200 is a non-failure state per AT docs
        const failed = atRecipients.filter((r) => r.statusCode >= 200);
        if (failed.length > 0) {
          log.warn("AT recipients with non-success status", {
            failed: failed.map((f) => ({
              number: f.number,
              status: f.status,
              statusCode: f.statusCode,
            })),
            includeSenderId,
          });
          return {
            success: false,
            error:
              failed[0].status || `${failed.length} of ${atRecipients.length} recipients failed`,
          };
        }

        return {
          success: true,
          messageId: atRecipients[0].messageId,
        };
      }

      // SMSMessageData or Recipients missing but AT returned 200 OK
      // Without recipient status data, we cannot confirm delivery — report failure
      log.warn("AT returned 200 OK but no SMSMessageData.Recipients", {
        rawBody: rawBody.slice(0, 500),
        includeSenderId,
      });
      return { success: false, error: "No recipient data in response" };
    };

    const firstAttempt = await sendAttempt(senderIdResult.valid);
    if (
      !firstAttempt.success &&
      firstAttempt.invalidSenderIdRejected &&
      senderIdResult.valid &&
      senderIdResult.value
    ) {
      log.warn("Retrying SMS without sender ID after provider rejection", {
        senderId: senderIdResult.value,
      });
      return await sendAttempt(false);
    }

    // Retry transient failures with exponential backoff
    if (!firstAttempt.success && !firstAttempt.invalidSenderIdRejected) {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        log.warn("Retrying SMS after transient failure", {
          attempt,
          backoffMs: backoff,
          previousError: firstAttempt.error,
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
        const retryResult = await sendAttempt(senderIdResult.valid);
        if (retryResult.success) return retryResult;
        // If the retry also failed with a non-retryable error, stop
        if (retryResult.invalidSenderIdRejected) return retryResult;
      }
    }

    return firstAttempt;
  } catch (error) {
    // Retry transient errors (network failures, timeouts) at the outer level
    if (isRetryable(error)) {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        log.warn("Retrying SMS after caught exception", {
          attempt,
          backoffMs: backoff,
          error: error instanceof Error ? error.message : "Unknown",
        });
        await new Promise((resolve) => setTimeout(resolve, backoff));
        try {
          const validatedRetry = SmsParamsSchema.parse(params);
          const retryRecipients = Array.isArray(validatedRetry.to)
            ? validatedRetry.to
            : [validatedRetry.to];
          // Minimal inline retry — cannot reuse sendAttempt because it was
          // defined inside the try block for scoping reasons.
          const apiKey = process.env.AFRICASTALKING_API_KEY!;
          const username = process.env.AFRICASTALKING_USERNAME!;
          const isSandbox = username.toLowerCase() === "sandbox";
          const baseUrl = isSandbox
            ? "https://api.sandbox.africastalking.com"
            : "https://api.africastalking.com";
          const formData = new URLSearchParams();
          formData.set("username", username);
          formData.set("to", retryRecipients.join(","));
          formData.set("message", validatedRetry.message);
          const resp = await fetch(`${baseUrl}/version1/messaging`, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/x-www-form-urlencoded",
              apiKey,
            },
            body: formData.toString(),
            signal: AbortSignal.timeout(10_000),
          });
          if (resp.ok) {
            const body: ATSmsResponse = await resp.json();
            const r = body.SMSMessageData?.Recipients?.[0];
            if (r && r.statusCode < 200) {
              return { success: true, messageId: r.messageId };
            }
          }
        } catch {
          // continue to next retry
        }
      }
    }

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
