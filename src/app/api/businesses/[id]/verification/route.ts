import { type NextRequest } from "next/server";
import { z } from "zod";

import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { staffCommandRefusal } from "@/lib/foundation/staff-command";
import { readMyBusinessChecks } from "@/lib/foundation/business-seen";

const log = createLogger("BusinessVerificationState");

/**
 * GET /api/businesses/[id]/verification
 * The owner's view: sticker state, their cases (without staff-only findings),
 * the message thread, and other verified profiles this one can join.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "business-verification:read",
    mutate: false,
    unavailableMessage: "Could not load verification status",
    signInMessage: "Sign in to view your business verification",
    refusal: staffCommandRefusal,
    command: async (api) => readMyBusinessChecks(api, z.uuid().parse((await params).id)),
  });
}
