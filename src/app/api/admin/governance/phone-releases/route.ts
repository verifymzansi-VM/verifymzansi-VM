import type { NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { normalizeSaPhone } from "@/lib/utils/phone";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { staffCommandRefusal } from "@/lib/foundation/staff-command";
import {
  BLOCKED_PHONE_PATTERN,
  proposePhoneRelease,
  RELEASE_REASON,
  reviewPhoneRelease,
} from "@/lib/foundation/phone-releases";

const log = createLogger("GovernancePhoneRelease");

// 082 123 4567, 27821234567 and +27 82 123 4567 all become +27821234567.
const phone = z
  .string()
  .max(40)
  .transform((value) => normalizeSaPhone(value))
  .pipe(z.string().regex(BLOCKED_PHONE_PATTERN, "Enter a South African number."));

const schema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("propose"),
    phone,
    reason: z.string().trim().min(RELEASE_REASON.min).max(RELEASE_REASON.max),
  }),
  z.strictObject({ action: z.enum(["approve", "reject"]), phone }),
]);

/**
 * POST /api/admin/governance/phone-releases
 *
 * Asks to release one phone number a ban blocks, or approves or rejects a
 * waiting request. A different staff member must approve; the ID ban stays.
 */
export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request: request,
    log,
    action: "admin:governance:phone-release",
    mutate: true,
    unavailableMessage: "The change could not be confirmed. Reload the page before trying again.",
    signInMessage: "Sign in to review restrictions",
    refusal: staffCommandRefusal,
    command: async (api, body) => {
      const input = schema.parse(body);
      if (input.action === "propose") {
        const result = await proposePhoneRelease(api, input.phone, input.reason);
        return { status: result.status };
      }
      const result = await reviewPhoneRelease(api, input.phone, input.action === "approve");
      return { status: result.status };
    },
  });
}
