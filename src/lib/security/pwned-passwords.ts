import { createHash } from "node:crypto";
import { readBoundedRequestText } from "@/lib/utils/request-body";

export const PWNED_PASSWORD_ERROR =
  "This password has appeared in a known data breach. Choose a different password.";
export const PWNED_PASSWORD_CHECK_UNAVAILABLE_ERROR =
  "Password breach checks are temporarily unavailable. Please try again shortly.";

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range";
const REQUEST_TIMEOUT_MS = 2500;

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
