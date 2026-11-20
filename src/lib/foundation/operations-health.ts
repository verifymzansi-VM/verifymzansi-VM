import "server-only";

import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { settleStaffCommand } from "./staff-command";

/**
 * The staff "Operations health" page's one read
 * (api.get_staff_operations_health, 20261120163500_staff_operations_health.sql):
 * staff with `audit:view` and a recent authenticator code. Every scheduled job
 * with its last run and whether it is late; stuck emails and privacy request
 * notices (and how many from the last 30 days can never be sent); payment problems of the past 7 days; account deletions held back,
 * file deletions and ID evidence past its deletion date; open cost alarms.
 * Counts are complete; each list has at most 50 rows. No account id, name,
 * email, phone or message text.
 */

/** The scheduled jobs, in the order the database lists them. */
export const SCHEDULED_JOBS = [
  "slot_renewals",
  "post_lifecycle",
  "sponsorships",
  "inbox_purge",
  "intro_trials",
  "commissions",
  "bank_transfer_expiry",
  "package_add_invoices",
  "email_delivery",
  "payment_alerts",
  "privacy_notices",
  "retention",
  "form_drafts",
  "evidence_cleanup",
  "media_cleanup",
  "payment_checks",
  "refund_check",
] as const;
export type ScheduledJob = (typeof SCHEDULED_JOBS)[number];

const instant = z.iso.datetime({ offset: true });
const count = z.number().int().min(0);
const code = z.string().regex(/^[a-z_]{1,80}$/);
const list = <T extends z.ZodType>(item: T) => z.array(item).max(50);

const operationsHealthSchema = z.strictObject({
  generated_at: instant,
  jobs: z
    .array(
      z.strictObject({
        job: z.enum(SCHEDULED_JOBS),
        every: z.enum(["minute", "5_minutes", "10_minutes", "day"]),
        last_run_at: instant.nullable(),
        late: z.boolean(),
      })
    )
    .max(SCHEDULED_JOBS.length),
  emails: z.strictObject({
    waiting: count,
    stuck: count,
    items: list(
      z.strictObject({
        kind: code,
        attempts: count,
        queued_at: instant,
        last_error: code.nullable(),
      })
    ),
  }),
  notices: z.strictObject({
    stuck: count,
    // Notices queued in the last 30 days that the notice job can never send
    // (the request was minimised, or the account's address changed or is not
    // confirmed); never listed.
    undeliverable: count,
    items: list(z.strictObject({ kind: code, attempts: count, queued_at: instant })),
  }),
  payments: z.strictObject({
    problems: count,
    not_activated: count,
    items: list(
      z.strictObject({
        // The first 8 characters of the payment id; none for a notice that
        // named no payment.
        payment_ref: z
          .string()
          .regex(/^[0-9a-f]{8}$/)
          .nullable(),
        reason: code,
        source: code,
        first_seen_at: instant,
        last_seen_at: instant,
        occurrences: z.number().int().min(1),
        alerted: z.boolean(),
      })
    ),
  }),
  deletions: z.strictObject({
    accounts_blocked: count,
    files_stuck: count,
    files_queued: count,
    evidence_overdue: count,
    legal_holds: count,
    items: list(
      z.strictObject({
        reason: code,
        blocked_at: instant,
        erase_after: instant,
        closed_by: z.enum(["member", "staff"]),
      })
    ),
  }),
  incidents: z.strictObject({
    open: count,
    items: list(
      z.strictObject({
        metric: code,
        level: z.enum(["warning", "critical"]),
        period: z.string().regex(/^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$/),
        raised_at: instant,
      })
    ),
  }),
});
export type OperationsHealth = z.infer<typeof operationsHealthSchema>;

export async function readStaffOperationsHealth(
  api: FoundationAuthenticatedApi
): Promise<OperationsHealth> {
  return settleStaffCommand(
    api.rpc("get_staff_operations_health", {}, { get: false }),
    operationsHealthSchema
  );
}
