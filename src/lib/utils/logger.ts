/**
 * Structured Logger
 *
 * Lightweight logging utility that:
 * - Supports log levels (debug, info, warn, error)
 * - Outputs structured JSON in production, human-readable in dev
 * - Scrubs PII fields (phone, email, OTP) from metadata
 * - Zero external dependencies
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Fields whose values should be masked in logs */
const PII_FIELDS = new Set([
  "phone",
  "email",
  "otp",
  "otp_hash",
  "id_number",
  "password",
  "token",
  "api_key",
  "apiKey",
  "secret",
  "passphrase",
  "cellNumber",
  "cell_number",
  "emailAddress",
  "email_address",
  "requesterEmail",
  "requester_email",
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "address",
  "dob",
  "date_of_birth",
  "dateOfBirth",
]);

function maskValue(value: unknown): string {
  if (typeof value !== "string") return "***";
  if (value.length <= 4) return "***";
  return value.slice(0, 2) + "***" + value.slice(-2);
}

/**
 * Recursively scrub PII fields from a metadata object.
 * Returns a new object with sensitive values masked.
 */
function scrubPii(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PII_FIELDS.has(key)) {
      result[key] = maskValue(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object" ? scrubPii(item as Record<string, unknown>) : item
      );
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = scrubPii(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function getMinLevel(): LogLevel {
  if (process.env.LOG_LEVEL) {
    const level = process.env.LOG_LEVEL.toLowerCase() as LogLevel;
    if (level in LEVEL_PRIORITY) return level;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getMinLevel()];
}

function formatMessage(
  level: LogLevel,
  context: string,
  message: string,
  meta?: Record<string, unknown>
) {
  const timestamp = new Date().toISOString();
  const scrubbedMeta = meta ? scrubPii(meta) : undefined;

  // Production: structured JSON for log aggregation
  if (process.env.NODE_ENV === "production") {
    return JSON.stringify({
      timestamp,
      level,
      context,
      message,
      ...(scrubbedMeta && Object.keys(scrubbedMeta).length > 0 ? { meta: scrubbedMeta } : {}),
    });
  }

  // Development: human-readable
  const metaStr =
    scrubbedMeta && Object.keys(scrubbedMeta).length > 0 ? ` ${JSON.stringify(scrubbedMeta)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${metaStr}`;
}

/**
 * Create a logger scoped to a specific module/context.
 *
 * @example
 * ```ts
 * const log = createLogger("SMS");
 * log.info("OTP sent", { phone: "+27821234567" });
 * // Dev:  [2026-02-20T...] [INFO] [SMS] OTP sent {"phone":"+2***67"}
 * // Prod: {"timestamp":"...","level":"info","context":"SMS","message":"OTP sent","meta":{"phone":"+2***67"}}
 * ```
 */
export function createLogger(context: string) {
  return {
    debug(message: string, meta?: Record<string, unknown>) {
      // eslint-disable-next-line no-console
      if (shouldLog("debug")) console.debug(formatMessage("debug", context, message, meta));
    },
    info(message: string, meta?: Record<string, unknown>) {
      // eslint-disable-next-line no-console
      if (shouldLog("info")) console.info(formatMessage("info", context, message, meta));
    },
    warn(message: string, meta?: Record<string, unknown>) {
      if (shouldLog("warn")) console.warn(formatMessage("warn", context, message, meta));
    },
    error(message: string, meta?: Record<string, unknown>) {
      if (shouldLog("error")) console.error(formatMessage("error", context, message, meta));
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
