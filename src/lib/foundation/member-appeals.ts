import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { settleStaffCommand } from "./staff-command";

const instant = z.iso.datetime({ offset: true });
const kind = z.enum(["ban", "suspension", "warning", "content_hidden"]);
export const appealOutcome = z.enum(["upheld", "overturned", "partially_overturned", "dismissed"]);
const status = z.union([z.literal("submitted"), appealOutcome]);
const memberDecision = z.strictObject({
  decisionId: z.uuid(),
  kind,
  reason: z.string().max(500),
  startsAt: instant,
  endsAt: instant.nullable(),
  active: z.boolean(),
  appealable: z.boolean(),
  appeal: z
    .strictObject({
      id: z.uuid(),
      status,
      outcome: z.string().max(2000).nullable(),
      resolvedAt: instant.nullable(),
    })
    .nullable(),
});
export async function readMyFrontendDecisions(api: FoundationAuthenticatedApi, accountId: string) {
  const result = await api.rpc("get_my_frontend_decisions", {}, { get: false });
  if (result.error) throw new Error("Account decisions are unavailable");
  return z
    .strictObject({
      account_id: z.literal(accountId),
      items: z.array(memberDecision).max(100),
    })
    .parse(result.data).items;
}

const detail = z.strictObject({
  id: z.uuid(),
  decision_id: z.uuid(),
  appellant_id: z.uuid(),
  reason: z.string().min(20).max(2000),
  kind,
  status,
  created_at: instant,
  reviewer_id: z.uuid().nullable(),
  reviewer_rationale: z.string().max(2000).nullable(),
  resolved_at: instant.nullable(),
  effect_version: z.number().int().positive().nullable(),
  ends_at: instant.nullable(),
  decision_reason: z.string().max(500).nullable(),
  can_resolve: z.boolean(),
});
export async function readFrontendAppeals(
  api: FoundationAuthenticatedApi,
  actorId: string,
  id?: string
) {
  return settleStaffCommand(
    api.rpc("get_frontend_appeal_queue", id ? { p_appeal: z.uuid().parse(id) } : {}, {
      get: false,
    }),
    z
      .strictObject({
        actor_id: z.literal(actorId),
        items: z.array(detail).max(id ? 1 : 50),
        total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      })
      .refine(
        (v) =>
          v.items.length === Math.min(v.total, 50) &&
          v.items.every((item) => (id ? item.id === id : item.status === "submitted"))
      )
  );
}
