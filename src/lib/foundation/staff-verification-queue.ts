import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { foundationInstant } from "./public-post-contract";
import { nativeIdentityScopeSchema } from "../admin/native-identity-review";
import { settleStaffCommand, FoundationStaffCommandError } from "./staff-command";
const row = z
  .strictObject({
    id: z.uuid(),
    step_type: z.enum(["id_doc", "selfie"]),
    created_at: foundationInstant,
    updated_at: foundationInstant,
    reviewed_at: foundationInstant.nullable(),
    risk_score: z.number().int().min(0).max(100),
    risk_level: z.enum(["low", "high"]),
    auto_status: z.enum(["manual_review", "awaiting_second_reviewer"]),
  })
  .refine((v) => v.risk_score > 50 === (v.risk_level === "high"));
const snapshot = z
  .strictObject({
    account_id: z.uuid(),
    total_steps: z.number().int().nonnegative(),
    groups: z
      .array(
        z.strictObject({
          case_id: z.uuid(),
          owner_id: z.uuid(),
          version: z.number().int().positive(),
          display_name: z.string().nullable(),
          created_at: foundationInstant,
          steps: z.array(row).max(2),
          review_scope: nativeIdentityScopeSchema.nullable(),
        })
      )
      .max(1400),
  })
  .refine((v) => new Set(v.groups.map((g) => g.case_id)).size === v.groups.length)
  .refine((v) =>
    v.groups.every(
      (g) =>
        new Set(g.steps.map((s) => s.step_type)).size === g.steps.length &&
        (!g.review_scope ||
          (g.review_scope.caseId === g.case_id && g.review_scope.caseVersion === g.version))
    )
  );
export async function readFrontendStaffVerificationQueue(
  api: FoundationAuthenticatedApi,
  accountId: string,
  limit = 100,
  includeIds: string[] = []
) {
  const request = z
    .strictObject({
      limit: z.number().int().min(1).max(100),
      includeIds: z.array(z.uuid()).max(300),
    })
    .parse({ limit, includeIds });
  const facts = await settleStaffCommand(
    api.rpc(
      "get_frontend_staff_verification_queue",
      { p_limit: request.limit, p_include_ids: request.includeIds },
      { get: false }
    ),
    snapshot
  );
  if (
    facts.account_id !== accountId ||
    facts.groups.some((g) => g.owner_id === accountId) ||
    facts.groups.reduce((n, g) => n + g.steps.length, 0) > facts.total_steps
  )
    throw new FoundationStaffCommandError(
      503,
      "The identity queue changed. Reload it before continuing."
    );
  return {
    total: facts.total_steps,
    groups: facts.groups
      .filter((g) => g.steps.length > 0)
      .map((g) => ({
        user_id: g.owner_id,
        account_display_name: g.display_name?.trim() || "Member",
        account_verification_status: null,
        latest_created_at: g.created_at,
        pending_step_count: g.steps.length,
        primary_step_id: g.steps[0].id,
        primary_step_type: g.steps[0].step_type,
        steps: g.steps.map((s) => ({
          ...s,
          user_id: g.owner_id,
          claim_case_id: g.case_id,
          status: "pending",
          ...(g.review_scope ? { foundation: g.review_scope } : {}),
          account_display_name: g.display_name,
          account_verification_status: null,
        })),
      })),
  };
}
