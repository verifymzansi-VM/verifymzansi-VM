import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { settleStaffCommand } from "./staff-command";

const instant = z.iso.datetime({ offset: true });
export async function readFrontendSupportMetrics(
  api: FoundationAuthenticatedApi,
  callerId: string
) {
  return settleStaffCommand(
    api.rpc("get_frontend_support_metrics", {}, { get: false }),
    z.strictObject({
      actor_id: z.literal(callerId),
      new: z.number().int().nonnegative(),
      oldest_at: instant.nullable(),
    })
  );
}
const row = z.strictObject({
  id: z.uuid(),
  name: z.string().min(2).max(100),
  email: z.email().max(254),
  message: z.string().min(10).max(2040),
  status: z.enum(["new", "in_progress", "resolved"]),
  revision: z.number().int().positive(),
  created_at: instant,
  emailActivity: z
    .array(
      z.strictObject({
        template: z.enum(["support_acknowledgement", "support_staff_alert"]),
        accepted: z.boolean(),
        created_at: instant,
      })
    )
    .max(2),
});
export async function readFrontendSupportInbox(
  api: FoundationAuthenticatedApi,
  callerId: string,
  page: number,
  ticket?: string
) {
  return settleStaffCommand(
    api.rpc(
      "get_frontend_support_inbox",
      { p_page: page, ...(ticket ? { p_ticket: ticket } : {}) },
      { get: false }
    ),
    z
      .strictObject({
        actor_id: z.literal(callerId),
        total: z.number().int().nonnegative(),
        new_count: z.number().int().nonnegative(),
        oldest_new_at: instant.nullable(),
        can_update: z.boolean(),
        items: z.array(row).max(ticket ? 1 : 50),
      })
      .refine(
        (v) =>
          v.items.length === Math.min(50, Math.max(0, v.total - (ticket ? 0 : (page - 1) * 50))) &&
          v.items.every((r) => !ticket || r.id === ticket)
      )
  );
}
