import * as Sentry from "@sentry/nextjs";
import { createLogger } from "@/lib/utils/logger";

/**
 * Report an incident that needs a person to act (for example a committed
 * decision whose follow-up effect failed). Critical incidents go to Sentry as
 * `fatal` events, which is the configured alert channel, and to the log.
 * Metadata is sent without personal data: pass ids, not emails or names.
 */
export function reportCriticalIncident(
  context: string,
  message: string,
  meta: Record<string, string | number | boolean | null | undefined> = {}
): void {
  createLogger(context).error(message, { severity: "critical", ...meta });
  try {
    Sentry.captureMessage(message, {
      level: "fatal",
      tags: { context, severity: "critical" },
      extra: meta,
    });
  } catch {
    // Alerting must never break the request that reported the incident.
  }
}
