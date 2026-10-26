import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const quantity = z.string().regex(/^\d+(?:\.\d+)?$/);
const count = z.number().int().nonnegative();
const instant = z.iso.datetime({ offset: true });
const alarm = z.strictObject({
  id: z.uuid(),
  metric: z.string(),
  level: z.enum(["warning", "critical"]),
  period: z.string(),
  used: quantity,
  free_quantity: quantity,
  raised_at: instant,
});
const overview = z.strictObject({
  generated_at: instant,
  lines: z
    .array(
      z.strictObject({
        metric: z.string(),
        label: z.string(),
        unit: z.enum(["bytes", "count"]),
        provider: z.string(),
        period: z.enum(["current", "month", "day"]),
        measurement: z.enum(["database_observation", "estimate", "provider_required"]),
        billing_scope: z.enum(["unverified", "account", "organization", "project", "contract"]),
        source_url: z.url().nullable(),
        used: quantity.nullable(),
        free_quantity: quantity.nullable(),
        percent_of_free: z.number().nonnegative().nullable(),
        level: z.enum([
          "ok",
          "warning",
          "critical",
          "check_provider",
          "no_free_allowance",
          "allowance_unknown",
          "unverified_allowance",
          "estimated_usage",
        ]),
        overage_note: z.string(),
        verified_on: z.iso.date().nullable(),
      })
    )
    .min(1)
    .max(100),
  drivers: z.strictObject({
    accounts: count,
    new_accounts_this_month: count,
    live_posts: count,
    uploads_last_30_days: count,
    average_bytes_per_live_post: quantity,
    unused_media_bytes_awaiting_cleanup: quantity,
    expired_posts_awaiting_deletion: count,
    evidence_files: count,
    posts_by_status: z.record(z.string(), count),
  }),
  largest_storage_accounts: z
    .array(
      z.strictObject({
        account_id: z.uuid(),
        bytes: quantity,
        live_posts: count,
        package_posts: count,
      })
    )
    .max(10),
  open_alarms: z.array(alarm).max(1000),
});
export class FoundationCostError extends Error {
  constructor(readonly status: 400 | 403 | 409 | 503) {
    super("Operations costs are temporarily unavailable");
  }
}
function fail(error: { code?: string }) {
  throw new FoundationCostError(error.code === "42501" ? 403 : error.code === "22023" ? 409 : 503);
}
/** SQL rechecks live staff authority and uses no owner-selected or service client. */
export async function readFoundationStaffCosts(api: FoundationAuthenticatedApi) {
  const result = await api.rpc("staff_cost_overview", {});
  if (result.error) fail(result.error);
  const parsed = overview.safeParse(result.data);
  if (!parsed.success) throw new FoundationCostError(503);
  return parsed.data;
}
export async function acknowledgeFoundationCostAlarm(
  api: FoundationAuthenticatedApi,
  input: unknown
) {
  const command = z.strictObject({ alarm_id: z.uuid() }).safeParse(input);
  if (!command.success) throw new FoundationCostError(400);
  const result = await api.rpc("acknowledge_cost_alarm", { p_alarm_id: command.data.alarm_id });
  if (result.error) fail(result.error);
  const parsed = z.strictObject({ id: z.uuid(), acknowledged_at: instant }).safeParse(result.data);
  if (!parsed.success || parsed.data.id !== command.data.alarm_id)
    throw new FoundationCostError(503);
  return parsed.data;
}
