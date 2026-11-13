import { type NextRequest } from "next/server";
import { z } from "zod";

import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { settleStaffCommand, staffCommandRefusal } from "@/lib/foundation/staff-command";

const log = createLogger("BusinessVerificationSeenRequest");

const schema = z
  .object({
    method: z.enum(["video", "visit"]),
    /** Where to visit: any trading location. Never shown publicly. */
    address: z.string().trim().max(300).optional(),
    slots: z.array(z.string().trim().min(3).max(80)).min(1).max(3),
    consentScreenshots: z.literal(true),
  })
  .refine((v) => v.method === "video" || (v.address && v.address.length >= 5), {
    message: "Add the address we should visit",
    path: ["address"],
  });

/**
 * POST /api/businesses/[id]/verification/seen
 * The owner asks to be seen by VerifyMzansi: a live video call (default) or
 * an in-person visit where we can. Staff schedule it and report back.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "business-verification:seen",
    mutate: true,
    successStatus: 201,
    unavailableMessage: "The business check could not be confirmed. Reload before trying again.",
    signInMessage: "Sign in to request a business check",
    refusal: staffCommandRefusal,
    command: async (api, body) => {
      const id = z.uuid().parse((await params).id);
      const input = schema.strict().parse(body);
      return settleStaffCommand(
        api.rpc(
          "request_frontend_business_seen",
          {
            p_business: id,
            p_method: input.method,
            p_slots: input.slots,
            p_consent: input.consentScreenshots,
            ...(input.method === "visit" && input.address ? { p_address: input.address } : {}),
          },
          { get: false }
        ),
        z.strictObject({
          caseId: z.uuid(),
          status: z.literal("pending"),
          reused: z.boolean().optional(),
        })
      );
    },
  });
}
