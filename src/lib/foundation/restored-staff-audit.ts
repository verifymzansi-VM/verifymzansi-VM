import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { settleStaffCommand } from "./staff-command";
import { auditSubjectFilters } from "./audit-filters";
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const inputSchema = z
  .strictObject({
    page: z.number().int().min(1).max(100000),
    action: z
      .string()
      .regex(/^[a-z0-9_:]{1,80}$/i)
      .optional(),
    type: z
      .string()
      .regex(/^[a-z0-9_]{1,80}$/i)
      .optional(),
    ...auditSubjectFilters,
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to);
const event = z.strictObject({
  id: z.string().regex(/^[a-z_]+:[a-zA-Z0-9-]{1,40}$/),
  occurred_at: z.iso.datetime({ offset: true }),
  actor_id: z.uuid().nullable(),
  actor_name: z.string().max(120).nullable(),
  target_id: z.uuid().nullable(),
  target_type: z.enum([
    "post",
    "report",
    "case",
    "organisation",
    "partner",
    "account",
    "feature_flag",
    "payment",
  ]),
  action: z.string().regex(/^[a-z][a-z0-9_]{0,149}$/),
  reason: z.string().max(5000).nullable(),
});
export async function readRestoredStaffAudit(
  api: FoundationAuthenticatedApi,
  callerId: string,
  input: unknown
) {
  const request = inputSchema.parse(input);
  return settleStaffCommand(
    api.rpc("get_frontend_staff_audit_page", { p_request: request }, { get: false }),
    z
      .strictObject({
        account_id: z.literal(callerId),
        page: z.literal(request.page),
        limit: z.literal(50),
        total: integer,
        items: z.array(event).max(50),
      })
      .refine(
        (v) =>
          new Set(v.items.map((e) => e.id)).size === v.items.length &&
          v.items.length === Math.min(50, Math.max(0, v.total - (v.page - 1) * 50))
      )
  );
}
