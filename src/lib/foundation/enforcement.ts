import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { settleStaffCommand } from "./staff-command";

const date = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const item = z.strictObject({
  id: z.uuid(),
  decision_id: z.uuid(),
  account_id: z.uuid(),
  kind: z.enum(["ban", "suspension"]),
  reason: z.string().min(10).max(500),
  starts_at: date,
  ends_at: date.nullable(),
  emergency: z.boolean(),
  version: z.number().int().positive().nullable(),
  conflicted: z.boolean(),
  display_name: z.string().max(120).nullable(),
});
const event = z.strictObject({
  id: z.string().min(1).max(60),
  action: z.enum(["warn", "hide", "suspension", "emergency suspension", "ban", "lift"]),
  account_id: z.uuid(),
  reason: z.string().max(500),
  created_at: date,
});
export async function readFrontendEnforcement(api: FoundationAuthenticatedApi, callerId: string) {
  return settleStaffCommand(
    api.rpc("get_frontend_enforcement", {}, { get: false }),
    z
      .strictObject({
        actor_id: z.literal(callerId),
        total: count,
        suspensions: count,
        bans: count,
        emergency: count,
        items: z.array(item).max(50),
        recent: z.array(event).max(20),
      })
      .refine(
        (v) =>
          v.total === v.suspensions + v.bans &&
          v.emergency <= v.suspensions &&
          v.items.length === Math.min(v.total, 50)
      )
  );
}

export async function readMyRestrictionStatus(api: FoundationAuthenticatedApi, callerId: string) {
  const { data, error } = await api.rpc("get_my_frontend_restriction_status", {}, { get: false });
  if (error?.code === "42501") return null;
  if (error) throw new Error("Restriction status unavailable");
  return z
    .strictObject({
      account_id: z.literal(callerId),
      status: z.enum(["active", "banned", "suspended"]),
      ends_at: date.nullable(),
    })
    .refine((v) => (v.status === "suspended") === (v.ends_at !== null))
    .parse(data);
}
