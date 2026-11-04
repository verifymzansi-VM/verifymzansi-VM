import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { settleStaffCommand } from "./staff-command";
import type { AuditLogEntry } from "../utils/admin-queries";
const labels = {
  market: "MZANSI_MARKET",
  business: "MZANSI_BUSINESS",
  tourism_events: "PROMOTIONS_EVENTS",
} as const;
export async function readFrontendAreaActivity(
  api: FoundationAuthenticatedApi,
  callerId: string,
  area?: "market" | "business" | "tourism_events",
  limit = 20
) {
  const request = z
    .strictObject({
      area: z.enum(["market", "business", "tourism_events"]).optional(),
      limit: z.number().int().min(1).max(100),
    })
    .parse({ area, limit });
  const result = await settleStaffCommand(
    api.rpc(
      "get_frontend_area_activity",
      { ...(request.area ? { p_area: request.area } : {}), p_limit: request.limit },
      { get: false }
    ),
    z
      .strictObject({
        account_id: z.literal(callerId),
        area: z.literal(area ?? null),
        items: z
          .array(
            z.strictObject({
              id: z.string().regex(/^(moderation|report):[a-zA-Z0-9-]{1,40}$/),
              actor_id: z.uuid().nullable(),
              target_id: z.uuid(),
              target_type: z.enum(["listing", "business", "promotion", "report"]),
              area: z.enum(["market", "business", "tourism_events"]).nullable(),
              action: z.string().regex(/^[a-z_]{1,100}$/),
              created_at: z.iso.datetime({ offset: true }),
            })
          )
          .max(limit),
        today: z.record(z.string().regex(/^[a-z_]{1,100}$/), z.number().int().nonnegative()),
      })
      .refine(
        (v) =>
          new Set(v.items.map((e) => e.id)).size === v.items.length &&
          v.items.every((e) => !area || e.area === area)
      )
  );
  const items: AuditLogEntry[] = result.items.map((row) => ({
    ...row,
    area: row.area ? labels[row.area] : null,
    metadata: {},
  }));
  return { items, today: result.today };
}
