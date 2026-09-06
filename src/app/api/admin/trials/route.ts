import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("TrialManagement");
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("configure"),
    target: z.enum(["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"]),
    reason: z.string().trim().min(5).max(500),
    values: z.object({
      slotLimit: z.number().int().min(0).max(500),
      launchEnabled: z.boolean(),
      sevenDayEnabled: z.boolean(),
    }),
  }),
  z.object({
    action: z.literal("revoke"),
    target: z.uuid(),
    reason: z.string().trim().min(5).max(500),
    values: z.object({}),
  }),
  z.object({
    action: z.literal("extend"),
    target: z.uuid(),
    reason: z.string().trim().min(5).max(500),
    values: z.object({ expiresAt: z.iso.datetime() }),
  }),
]);
export async function POST(request: Request) {
  const guard = await enforceAdminMutationGuard({
    request,
    logger: log,
    rateLimitAction: "admin:trials",
    capability: "trials:manage",
  });
  if (!guard.success) return guard.response;
  const body = await parseAndValidateJsonRequest(request, schema);
  if (!body.success) return body.response;
  const { error } = await createAdminClient().rpc("manage_intro_trial", {
    p_actor_id: guard.user.id,
    p_action: body.data.action,
    p_target: body.data.target,
    p_values: body.data.values,
    p_reason: body.data.reason,
  });
  if (error) {
    log.warn("Trial management refused", { code: error.code });
    return NextResponse.json(
      {
        error:
          "Change could not be applied. Extensions require an active 30-day trial and must end within 60 days of activation.",
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ success: true });
}
