import { createHash } from "node:crypto";

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

  const body = await response.text();
  for (const line of body.split(/\r?\n/)) {
    const [candidateSuffix, count] = line.trim().split(":");
    if (candidateSuffix === suffix) {
      return Number.parseInt(count ?? "0", 10) || 0;
    }
  }

  return 0;
}

export async function isPwnedPassword(password: string): Promise<boolean> {
  return (await getPwnedPasswordCount(password)) > 0;
}
