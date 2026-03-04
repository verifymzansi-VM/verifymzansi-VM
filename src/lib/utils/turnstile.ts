/**
 * Cloudflare Turnstile CAPTCHA verification
 *
 * Turnstile is Cloudflare's privacy-friendly CAPTCHA alternative.
 * https://developers.cloudflare.com/turnstile/
 */

import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Turnstile");

interface TurnstileVerifyParams {
  token: string;
  remoteIp?: string;
}

interface TurnstileVerifyResult {
  success: boolean;
  error?: string;
  challengeTimestamp?: string;
  hostname?: string;
}

/**
 * Verify a Turnstile token with Cloudflare
 *
 * @param params - Token and optional remote IP
 * @returns Verification result
 */
export async function verifyTurnstileToken(
  params: TurnstileVerifyParams
): Promise<TurnstileVerifyResult> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!secretKey || secretKey === "dummy_secret_key") {
    log.error("Secret key not configured or is dummy");
    // In development or Playwright test mode, allow bypass token
    if (
      (process.env.NODE_ENV === "development" || process.env.PLAYWRIGHT_TEST_MODE === "1") &&
      params.token === "dev-turnstile-bypass"
    ) {
      return { success: true };
    }
    throw new Error("Turnstile secret key not configured");
  }

  // Allow placeholder in development ONLY when secret key is not set.
  // When a real key is configured, always verify against Cloudflare
  // to prevent bypass if NODE_ENV=development leaks to staging.
  // (Bypass without a key is handled above.)

  try {
    // Use form-encoded body — Cloudflare's primary documented format.
    // JSON was returning HTTP 400 on some Cloudflare Workers runtimes.
    const form = new URLSearchParams();
    form.append("secret", secretKey);
    form.append("response", params.token);
    if (params.remoteIp) {
      form.append("remoteip", params.remoteIp);
    }

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      log.error("Turnstile API returned non-OK status", { status: response.status, body: text });
      return {
        success: false,
        error: `Turnstile verification request failed (HTTP ${response.status})`,
      };
    }

    const data = await response.json();

    if (!data.success) {
      const errorCodes = data["error-codes"] || [];
      return {
        success: false,
        error: errorCodes.join(", ") || "CAPTCHA verification failed",
      };
    }

    return {
      success: true,
      challengeTimestamp: data.challenge_ts,
      hostname: data.hostname,
    };
  } catch (error) {
    log.error("Verification error", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}

/**
 * Middleware helper to verify Turnstile token from request
 *
 * @param token - Turnstile token from request body
 * @param remoteIp - Client IP address
 * @returns True if valid, throws error if invalid
 */
export async function requireValidTurnstile(
  token: string | undefined,
  remoteIp?: string
): Promise<void> {
  if (!token) {
    throw new Error("CAPTCHA token missing");
  }

  const result = await verifyTurnstileToken({ token, remoteIp });

  if (!result.success) {
    throw new Error(result.error || "CAPTCHA verification failed");
  }
}
