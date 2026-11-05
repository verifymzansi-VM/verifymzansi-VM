import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { settleStaffCommand } from "./staff-command";

const timestamp = z.iso.datetime({ offset: true });
const role = z.enum(["member", "moderator", "governor", "admin"]);
const staffRole = role.exclude(["member"]);
const staffChange = {
  id: z.uuid(),
  target_id: z.uuid(),
  from_role: role,
  to_role: role,
  reason: z.string().min(5).max(500),
};
export function readRestoredStaffRoles(
  api: FoundationAuthenticatedApi,
  actorId: string,
  page: number,
  filter?: string
) {
  return settleStaffCommand(
    api.rpc(
      "get_frontend_staff_role_review",
      {
        p_page: page,
        ...(filter ? { p_role: staffRole.parse(filter) } : {}),
      },
      { get: false }
    ),
    z
      .strictObject({
        actor_id: z.literal(actorId),
        staff_total: z.number().int().nonnegative(),
        staff: z
          .array(
            z.strictObject({
              user_id: z.uuid(),
              role: staffRole,
              granted_at: timestamp,
              mfa_required_after: timestamp.nullable(),
            })
          )
          .max(50),
        pending: z
          .array(
            z.strictObject({
              ...staffChange,
              proposer_id: z.uuid().nullable(),
              created_at: timestamp,
              expires_at: timestamp,
            })
          )
          .max(100),
        history: z
          .array(
            z.strictObject({
              ...staffChange,
              reviewer_id: z.uuid().nullable(),
              decided_at: timestamp,
            })
          )
          .max(25),
        people: z
          .array(
            z.strictObject({
              user_id: z.uuid(),
              email: z.string().max(254).nullable(),
              display_name: z.string().max(120).nullable(),
            })
          )
          .max(300),
      })
      .refine((v) => v.staff.length === Math.min(50, Math.max(0, v.staff_total - (page - 1) * 50)))
  );
}
