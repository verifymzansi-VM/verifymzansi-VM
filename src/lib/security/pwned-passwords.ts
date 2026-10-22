import { createHash } from "node:crypto";
import { createLogger } from "@/lib/utils/logger";
import { readBoundedRequestText } from "@/lib/utils/request-body";

export const PWNED_PASSWORD_ERROR =
  "This password has appeared in a known data breach. Choose a different password.";

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range";
const REQUEST_TIMEOUT_MS = 1500;
const log = createLogger("PasswordBreachCheck");

export class PwnedPasswordCheckUnavailableError extends Error {
  constructor(message = "Compromised password check is temporarily unavailable") {
    super(message);
    this.name = "PwnedPasswordCheckUnavailableError";
  }
}

function sha1HexUpper(value: string) {
  return createHash("sha1").update(value, "utf8").digest("hex").toUpperCase();
}

function createTimeoutSignal(timeoutMs: number) {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timeout === "object" && "unref" in timeout) {
    timeout.unref();
  }
  return controller.signal;
}

export async function getPwnedPasswordCount(password: string): Promise<number> {
  const hash = sha1HexUpper(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const response = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
    headers: {
      "Add-Padding": "true",
      "User-Agent": "VerifyMzansi-password-breach-check",
    },
    cache: "no-store",
    signal: createTimeoutSignal(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new PwnedPasswordCheckUnavailableError(`HIBP responded with ${response.status}`);
  }

  let body: string;
  try {
    body = await readBoundedRequestText(response, 256 * 1024);
  } catch {
    throw new PwnedPasswordCheckUnavailableError("Invalid HIBP response body");
  }
  const lines = body.trim().split(/\r?\n/);
  let matchedCount = 0;
  for (const line of lines) {
    const match = /^([A-F0-9]{35}):(\d+)$/i.exec(line.trim());
    const count = match ? Number(match[2]) : NaN;
    if (!match || !Number.isSafeInteger(count)) {
      throw new PwnedPasswordCheckUnavailableError("Malformed HIBP range response");
    }
    if (match[1].toUpperCase() === suffix) matchedCount = Math.max(matchedCount, count);
  }
  return matchedCount;
}

export async function isPwnedPassword(password: string): Promise<boolean> {
  return (await getPwnedPasswordCount(password)) > 0;
}

/**
 * The breach check stays on unless PASSWORD_BREACH_CHECK is "off". It is
 * independent of Supabase's own (Pro) leaked-password protection, so both can
 * run together.
 */
function passwordBreachCheckEnabled(): boolean {
  return process.env.PASSWORD_BREACH_CHECK?.trim().toLowerCase() !== "off";
}

export type PasswordBreachContext = "register" | "change_password" | "reset_password";

/**
 * Checks a new password against Have I Been Pwned (k-anonymity: only the first
 * five characters of its SHA-1 leave the server). Fails open: if the service
 * is slow, down or answers badly, the password is accepted and an event is
 * logged, so people are never locked out of signing up. Never logs the
 * password or its hash.
 */
export async function checkPasswordBreach(
  password: string,
  context: PasswordBreachContext
): Promise<"breached" | "clear" | "skipped" | "unavailable"> {
  if (!passwordBreachCheckEnabled()) return "skipped";
  try {
    return (await isPwnedPassword(password)) ? "breached" : "clear";
  } catch (error) {
    log.warn("password_breach_check_unavailable", {
      context,
      outcome: "allowed",
      reason:
        error instanceof PwnedPasswordCheckUnavailableError
          ? error.message
          : error instanceof Error
            ? error.name
            : "unknown",
    });
    return "unavailable";
  }
}
