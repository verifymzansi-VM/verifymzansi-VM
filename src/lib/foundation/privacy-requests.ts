import "server-only";
import { NextRequest } from "next/server";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { handleFoundationOwnerRoute } from "./owner-route";
import { settleStaffCommand, staffCommandRefusal } from "./staff-command";
import type { Logger } from "../utils/logger";

const instant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const type = z.enum(["access", "correction", "deletion", "objection"]);
const privacyRequest = z.strictObject({
  id: z.uuid(),
  type,
  description: z.string().max(3400),
  status: z.enum(["submitted", "identity_pending", "in_progress", "completed", "rejected"]),
  requester_email: z.string().min(3).max(254),
  identity_check: z.enum(["session", "manual"]),
  identity_verified: z.boolean(),
  revision: z.number().int().positive(),
  created_at: instant,
  received_at: instant,
  due_by: instant,
  extended_due_at: instant.nullable(),
  effective_due_at: instant,
  legal_basis: z.string().max(500),
  extension_reason: z.string().max(1000).nullable(),
  extension_notified_at: instant.nullable(),
  assigned_to: z.uuid().nullable(),
  assignee_name: z.string().max(120).nullable(),
  response_summary: z.string().max(4200).nullable(),
  completed_at: instant.nullable(),
  may_process: z.boolean(),
});
export async function readFrontendPrivacyQueue(
  api: FoundationAuthenticatedApi,
  actorId: string,
  view: string,
  page: number
) {
  return settleStaffCommand(
    api.rpc("get_frontend_privacy_queue", { p_view: view, p_page: page }, { get: false }),
    z
      .strictObject({
        actor_id: z.literal(actorId),
        items: z.array(privacyRequest).max(25),
        total: count,
        overdue: count,
        due_soon: count,
        rules: z
          .array(
            z.strictObject({
              request_type: type,
              extension_days: z.number().int().min(0).max(30),
              statutory: z.boolean(),
            })
          )
          .length(4),
      })
      .refine((v) => v.items.length === Math.min(25, Math.max(0, v.total - (page - 1) * 25)))
  );
}
export const privacyRevision = z.number().int().min(1).max(2147483646);
type Action = "assign" | "extend" | "verify_identity" | "approve" | "reject" | "complete";
export async function processFrontendPrivacyRequest(
  api: FoundationAuthenticatedApi,
  input: {
    requestId: string;
    revision: number;
    action: Action;
    note?: string;
    assigneeId?: string | null;
    attestation?: string;
  }
) {
  const statuses = {
    assign: input.assigneeId ? "assigned" : "unassigned",
    extend: "extended",
    verify_identity: "identity_verified",
    approve: "in_progress",
    reject: "rejected",
    complete: "completed",
  } as const;
  const status = statuses[input.action];
  const result = await settleStaffCommand(
    api.rpc(
      "process_frontend_privacy_request",
      {
        p_case: input.requestId,
        p_revision: input.revision,
        p_action: input.action,
        ...(input.note ? { p_note: input.note } : {}),
        ...(input.assigneeId ? { p_assignee: input.assigneeId } : {}),
        ...(input.attestation ? { p_attestation: input.attestation } : {}),
      },
      { get: false }
    ),
    z
      .strictObject({
        id: z.literal(input.requestId),
        status: z.literal(status),
        due: instant.nullable(),
      })
      .refine((v) => (v.status === "extended") === (v.due !== null))
  );
  return { status: result.status, ...(result.due ? { due: result.due } : {}) };
}
export function handlePrivacyStaffRoute<T>(
  request: Request,
  log: Logger,
  operation: "intake" | "case" | "decide" | "complete",
  command: (api: FoundationAuthenticatedApi, body: unknown) => Promise<T>
) {
  return handleFoundationOwnerRoute({
    request: request instanceof NextRequest ? request : new NextRequest(request),
    log,
    action: "admin:dsar:" + operation,
    mutate: true,
    successStatus: operation === "intake" ? 201 : 200,
    maxBytes: 27000,
    signInMessage: "Sign in to manage data requests",
    unavailableMessage:
      "The data request update could not be confirmed. Reload before trying again.",
    refusal: staffCommandRefusal,
    command,
  });
}
