import { adminDsarDecideSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import {
  handlePrivacyStaffRoute,
  privacyRevision,
  processFrontendPrivacyRequest,
} from "@/lib/foundation/privacy-requests";

const log = createLogger("DSARDecide");

/**
 * POST /api/admin/dsar/decide
 *
 * Updates a DSAR request:
 *   approve         → in_progress
 *   reject          → rejected (+ rejection notification email)
 *   verify_identity → identity_verified = true (unblocks export/complete)
 */
export async function POST(req: Request) {
  return handlePrivacyStaffRoute(req, log, "decide", (api, body) => {
    const input = adminDsarDecideSchema.extend({ revision: privacyRevision }).strict().parse(body);
    return processFrontendPrivacyRequest(api, {
      ...input,
      action: input.decision,
      note: input.notes,
    });
  });
}
