import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { uuidSchema } from "@/lib/validations/shared";
import {
  handlePrivacyStaffRoute,
  privacyRevision,
  processFrontendPrivacyRequest,
} from "@/lib/foundation/privacy-requests";

const log = createLogger("DsarCase");

const caseActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("extend"),
    requestId: uuidSchema,
    reason: z.string().trim().min(10).max(1000),
  }),
  z.object({
    action: z.literal("assign"),
    requestId: uuidSchema,
    /** null clears the assignment. */
    assigneeId: uuidSchema.nullable(),
  }),
]);

/**
 * POST /api/admin/dsar/case
 *
 *   extend → move the deadline once, where the rules allow it, with a reason.
 *            The requester is notified by a durable email job.
 *   assign → give the case to someone who can handle data requests.
 */
export async function POST(request: Request) {
  return handlePrivacyStaffRoute(request, log, "case", (api, body) => {
    const input = z
      .discriminatedUnion("action", [
        caseActionSchema.options[0].extend({ revision: privacyRevision }).strict(),
        caseActionSchema.options[1].extend({ revision: privacyRevision }).strict(),
      ])
      .parse(body);
    return processFrontendPrivacyRequest(api, {
      ...input,
      ...(input.action === "extend" ? { note: input.reason } : {}),
    });
  });
}
