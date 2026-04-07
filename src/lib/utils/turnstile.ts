/**
 * Cloudflare Turnstile CAPTCHA verification
 *
 * Turnstile is Cloudflare's privacy-friendly CAPTCHA alternative.
 * https://developers.cloudflare.com/turnstile/
 */

import { createLogger } from "@/lib/utils/logger";
import { TURNSTILE_VERIFY_REQUEST_TIMEOUT_MS } from "@/lib/turnstile-constants";
import { shouldBypassTurnstileInNonProduction } from "@/lib/turnstile-mode";

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
  temporary?: boolean;
}

export type TurnstileConfigStatus =
  | { configured: true }
  | {
      configured: false;
      reason: "missing-secret" | "missing-site-key" | "dummy-site-key" | "dev-host-bypass";
    };

async function readResponseBody(response: {
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}): Promise<string> {
  if (typeof response.text === "function") {
    return response.text().catch(() => "");
  }

  if (typeof response.json === "function") {
    const data = await response.json().catch(() => undefined);
    if (typeof data === "string") {
      return data;
    }
    if (data !== undefined) {
      try {
        return JSON.stringify(data);
      } catch {
        return "";
      }
    }
  }

  return "";
}

export function getTurnstileConfigStatus(options?: {
  requestHost?: string | null;
  configuredAppUrl?: string | null;
}): TurnstileConfigStatus {
  if (
    shouldBypassTurnstileInNonProduction({
      currentHost: options?.requestHost,
      configuredAppUrl: options?.configuredAppUrl ?? process.env.NEXT_PUBLIC_APP_URL,
      nodeEnv: process.env.NODE_ENV,
    })
  ) {
    return { configured: false, reason: "dev-host-bypass" };
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();

  if (!secretKey || secretKey === "dummy_secret_key") {
    return { configured: false, reason: "missing-secret" };
  }

  if (!siteKey) {
    return { configured: false, reason: "missing-site-key" };
  }

  if (siteKey === "dummy_site_key") {
    return { configured: false, reason: "dummy-site-key" };
  }

  return { configured: true };
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
  const configStatus = getTurnstileConfigStatus();

  if (!configStatus.configured) {
    log.error("Secret key not configured or is dummy");
    // In local dev with explicit bypass, or Playwright test mode, allow bypass token
    if (
      (process.env.ENABLE_DEV_TURNSTILE_BYPASS === "true" ||
        process.env.PLAYWRIGHT_TEST_MODE === "1") &&
      params.token === "dev-turnstile-bypass"
    ) {
      return { success: true };
    }
    throw new Error("Turnstile secret key not configured");
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY as string;

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
      signal: AbortSignal.timeout(TURNSTILE_VERIFY_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await readResponseBody(response);
      log.error("Turnstile API returned non-OK status", { status: response.status, body: text });

      if (response.status >= 500) {
        log.warn("Turnstile upstream temporarily unavailable", {
          category: "upstream_5xx",
          status: response.status,
        });
        return {
          success: false,
          temporary: true,
          error: "Security verification service is temporarily unavailable. Please retry.",
        };
      }

      return {
        success: false,
        error: `Turnstile verification request failed (HTTP ${response.status})`,
      };
    }

    const data = await response.json();

    if (!data.success) {
      const errorCodes = data["error-codes"] || [];
      log.warn("Turnstile token verification failed", {
        category: "invalid_token",
        errorCodes,
      });
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
    const isTimeoutError = error instanceof DOMException && error.name === "TimeoutError";
    const isAbortError = error instanceof DOMException && error.name === "AbortError";

    log.error("Verification error", {
      error: error instanceof Error ? error.message : "unknown error",
      temporary: isTimeoutError || isAbortError,
    });

    if (isTimeoutError || isAbortError) {
      log.warn("Turnstile verification request timed out", {
        category: "request_timeout",
      });
      return {
        success: false,
        temporary: true,
        error: "Security verification timed out. Please retry.",
      };
    }

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
