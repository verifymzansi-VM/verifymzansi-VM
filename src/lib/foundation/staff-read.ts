import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

// Preserve Postgres microseconds in cursors; Date is for display only.
const instant = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/)
  .pipe(z.iso.datetime({ offset: true }));
const auditId = z.string().regex(/^[a-z_]+:[a-zA-Z0-9-]{1,40}$/);
export const foundationAuditRequest = z
  .strictObject({
    limit: z.number().int().min(1).max(100).optional(),
    before_at: instant.optional(),
    before_id: auditId.optional(),
    action: z
      .string()
      .max(100)
      .regex(/^[a-z_]+(:[a-z_]+)?$/)
      .optional(),
    actor: z.uuid().optional(),
    target: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => Boolean(value.before_at) === Boolean(value.before_id))
  .refine((value) => !value.from || !value.to || value.from <= value.to);
const auditEvent = z.strictObject({
  id: auditId,
  occurred_at: instant,
  actor_id: z.uuid().nullable(),
  actor_name: z.string().max(120).nullable(),
  target_id: z.uuid().nullable(),
  target_type: z.enum(["post", "report", "case", "organisation", "partner", "account"]),
  action: z.string().min(1).max(150),
  reason: z.string().max(5000).nullable(),
});
export const foundationAuditPage = z
  .strictObject({
    version: z.literal(1),
    items: z.array(auditEvent).max(100),
    next_cursor: z.strictObject({ before_at: instant, before_id: auditId }).nullable(),
  })
  .refine((value) => new Set(value.items.map((row) => row.id)).size === value.items.length)
  .refine(
    (value) =>
      !value.next_cursor ||
      Boolean(
        value.items.length &&
        value.items.at(-1)?.id === value.next_cursor.before_id &&
        value.items.at(-1)?.occurred_at === value.next_cursor.before_at
      )
  );
export type FoundationAuditPage = z.infer<typeof foundationAuditPage>;
export type FoundationAuditRequest = z.infer<typeof foundationAuditRequest>;

export const foundationDecisionRequest = z
  .strictObject({
    limit: z.number().int().min(1).max(100).optional(),
    status: z.enum(["proposed", "approved", "withdrawn", "all"]).optional(),
    action: z.enum(["approve_override", "reject", "restrict_account"]).optional(),
    case_id: z.uuid().optional(),
    id: z.uuid().optional(),
    before_at: instant.optional(),
    before_id: z.uuid().optional(),
  })
  .refine((value) => Boolean(value.before_at) === Boolean(value.before_id));
const decision = z
  .strictObject({
    id: z.uuid(),
    case_id: z.uuid(),
    subject_id: z.uuid(),
    case_kind: z.enum(["kyc", "business", "restriction"]),
    action: z.enum(["approve_override", "reject", "restrict_account"]),
    status: z.enum(["proposed", "approved", "withdrawn"]),
    case_version: z.number().int().positive(),
    current_case_version: z.number().int().positive(),
    proposed_by: z.uuid(),
    proposed_at: instant,
    approved_by: z.uuid().nullable(),
    approved_at: instant.nullable(),
    withdrawn_by: z.uuid().nullable(),
    withdrawn_at: instant.nullable(),
    withdrawal_reason: z.string().max(4096).nullable(),
    can_approve: z.boolean(),
    can_withdraw: z.boolean(),
  })
  .refine((value) =>
    value.status === "approved"
      ? Boolean(value.approved_by && value.approved_at)
      : value.approved_by === null && value.approved_at === null
  )
  .refine((value) =>
    value.status === "withdrawn"
      ? Boolean(value.withdrawn_by && value.withdrawn_at && value.withdrawal_reason)
      : value.withdrawn_by === null &&
        value.withdrawn_at === null &&
        value.withdrawal_reason === null
  );
export const foundationDecisionPage = z
  .strictObject({
    version: z.literal(1),
    caller_id: z.uuid(),
    items: z.array(decision).max(100),
    next_cursor: z.strictObject({ before_at: instant, before_id: z.uuid() }).nullable(),
  })
  .refine((value) => new Set(value.items.map((row) => row.id)).size === value.items.length)
  .refine((value) =>
    value.items.every(
      (row) =>
        !row.can_approve ||
        (row.status === "proposed" &&
          row.proposed_by !== value.caller_id &&
          row.subject_id !== value.caller_id &&
          row.case_version === row.current_case_version)
    )
  )
  .refine(
    (value) =>
      !value.next_cursor ||
      Boolean(
        value.items.length &&
        value.items.at(-1)?.id === value.next_cursor.before_id &&
        value.items.at(-1)?.proposed_at === value.next_cursor.before_at
      )
  );
export type FoundationDecisionPage = z.infer<typeof foundationDecisionPage>;

export class FoundationStaffReadError extends Error {
  constructor(
    readonly status: 400 | 403 | 503,
    readonly mfaRequired = false
  ) {
    super(
      status === 400
        ? "Check the filters and try again"
        : status === 403
          ? "Your staff access must be verified again"
          : "Staff records are temporarily unavailable"
    );
  }
}
function refusal(error: { code?: string; message?: string }) {
  throw new FoundationStaffReadError(
    error.code === "42501"
      ? 403
      : ["22023", "22P02", "22007", "22008"].includes(error.code ?? "")
        ? 400
        : 503,
    error.code === "42501" && /second.factor|authenticator app/.test(error.message ?? "")
  );
}

/** Caller-bound API only. No service client, actor selector or source fallback.
 * The filter's actor UUID selects audit events; it never supplies authority.
 */
export async function readFoundationStaffAudit(
  api: FoundationAuthenticatedApi,
  input: unknown = {}
) {
  const request = foundationAuditRequest.safeParse(input);
  if (!request.success) throw new FoundationStaffReadError(400);
  try {
    const result = await api.rpc("staff_audit_page", { p_request: request.data });
    if (result.error) refusal(result.error);
    const parsed = foundationAuditPage.safeParse(result.data);
    if (!parsed.success) throw new FoundationStaffReadError(503);
    return parsed.data;
  } catch (error) {
    if (error instanceof FoundationStaffReadError) throw error;
    throw new FoundationStaffReadError(503);
  }
}
export async function readFoundationStaffDecisions(
  api: FoundationAuthenticatedApi,
  callerId: string,
  input: unknown = {}
) {
  const request = foundationDecisionRequest.safeParse(input);
  if (!request.success || !z.uuid().safeParse(callerId).success)
    throw new FoundationStaffReadError(400);
  try {
    const result = await api.rpc("staff_decision_page", { p_request: request.data });
    if (result.error) refusal(result.error);
    const parsed = foundationDecisionPage.safeParse(result.data);
    if (
      !parsed.success ||
      parsed.data.caller_id !== callerId ||
      !parsed.data.items.every(
        (row) =>
          (!request.data.id || row.id === request.data.id) &&
          (!request.data.case_id || row.case_id === request.data.case_id) &&
          (!request.data.action || row.action === request.data.action) &&
          (request.data.status === "all" || row.status === (request.data.status ?? "proposed"))
      )
    )
      throw new FoundationStaffReadError(503);
    return parsed.data;
  } catch (error) {
    if (error instanceof FoundationStaffReadError) throw error;
    throw new FoundationStaffReadError(503);
  }
}
