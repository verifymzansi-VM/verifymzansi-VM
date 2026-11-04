import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { nativeContentReviewSchema } from "../admin/native-content-review";
import type { ReportItem } from "../admin/report-item";
import type { ClaimView } from "../services/queue-claims";
import { settleStaffCommand } from "./staff-command";
const instant = z.iso.datetime({ offset: true }),
  count = z.number().int().nonnegative();
const row = z
  .strictObject({
    id: z.uuid(),
    target_id: z.uuid().nullable(),
    target_type: z.enum(["listing", "business", "promotion", "content"]),
    area: z.enum(["market", "business", "tourism_events"]).nullable(),
    category: z.enum(["scam", "prohibited_item", "impersonation", "harassment", "misleading_info"]),
    selected_reason: z
      .enum([
        "scam",
        "misleading",
        "expired",
        "fake_listing",
        "prohibited_item",
        "harassment",
        "impersonation",
        "spam",
        "other",
      ])
      .nullable(),
    severity: z.enum(["high", "standard"]),
    status: z.enum(["open", "in_progress", "resolved", "dismissed"]),
    description: z.string().min(10).max(2000).nullable(),
    created_at: instant,
    updated_at: instant,
    claim: z
      .strictObject({
        mine: z.boolean(),
        holder_name: z.string().min(1).max(120),
        expires_at: instant,
      })
      .nullable(),
    foundation: nativeContentReviewSchema.nullable(),
  })
  .refine((v) =>
    v.foundation
      ? v.claim?.mine === true && v.status === "in_progress" && v.description !== null
      : v.description === null && !v.claim?.mine
  );
export async function readFrontendReportQueue(
  api: FoundationAuthenticatedApi,
  callerId: string,
  area?: "market" | "business" | "tourism_events"
) {
  const result = await settleStaffCommand(
    api.rpc("get_frontend_report_queue", area ? { p_area: area } : {}, { get: false }),
    z
      .strictObject({
        account_id: z.literal(callerId),
        open_total: count,
        my_claims: z.number().int().min(0).max(20),
        items: z.array(row).max(470),
      })
      .refine(
        (v) =>
          new Set(v.items.map((r) => r.id)).size === v.items.length &&
          v.items.filter((r) => r.claim?.mine).length === v.my_claims &&
          v.items.filter((r) => r.status === "open" || r.status === "in_progress").length <=
            v.open_total &&
          v.items.every((r) => !area || r.area === area)
      )
  );
  const claims: Record<string, ClaimView> = {};
  const reports: ReportItem[] = result.items.map((r) => {
    if (r.claim)
      claims[`report:${r.id}`] = {
        mine: r.claim.mine,
        holderName: r.claim.holder_name,
        expiresAt: r.claim.expires_at,
      };
    return {
      id: r.id,
      target_id: r.target_id,
      target_type: r.target_type,
      category: r.selected_reason ?? r.category,
      severity: r.severity,
      status: r.status,
      created_at: r.created_at,
      ...(r.description !== null ? { description: r.description } : {}),
      ...(r.foundation ? { foundation: r.foundation } : {}),
    };
  });
  return {
    reports,
    open: reports.filter((r) => r.status === "open" || r.status === "in_progress"),
    openTotal: result.open_total,
    myClaims: result.my_claims,
    claims,
  };
}
