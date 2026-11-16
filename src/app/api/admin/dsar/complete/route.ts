import { adminDsarCompleteSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import {
  handlePrivacyStaffRoute,
  privacyRevision,
  processFrontendPrivacyRequest,
} from "@/lib/foundation/privacy-requests";

const log = createLogger("DSARComplete");

/**
 * POST /api/admin/dsar/complete
 *
 * Marks an in-progress DSAR request as completed after fulfillment.
 * Requires identity verification first, and deletion-type cases require an
 * explicit operator attestation.
 */
export async function POST(req: Request) {
  return handlePrivacyStaffRoute(req, log, "complete", (api, body) => {
    const input = adminDsarCompleteSchema
      .extend({ revision: privacyRevision })
      .strict()
      .parse(body);
    return processFrontendPrivacyRequest(api, {
      ...input,
      action: "complete",
      note: input.notes,
      attestation: input.deletionAttestation,
    });
  });
}
