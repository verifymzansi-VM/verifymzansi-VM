/**
 * POST /api/admin/sample-posts
 * Staff remove ({ slug, hidden: true }) or restore ({ slug, hidden: false })
 * one display-only sample post. Same origin and CSRF, a per-client limit, a
 * GoTrue-verified session; the database checks post:moderate and a recent
 * authenticator code.
 */
import { type NextRequest } from "next/server";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { staffCommandRefusal } from "@/lib/foundation/staff-command";
import { setStaffSamplePostHidden } from "@/lib/foundation/staff-sample-posts";
import { forgetHiddenSampleSlugs } from "@/lib/sample-posts/hidden";
import { listCatalogueSamples } from "@/lib/sample-posts/load";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("StaffSamplePosts");

export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:sample-posts:visibility",
    mutate: true,
    refusal: staffCommandRefusal,
    signInMessage: "Sign in to manage sample posts",
    unavailableMessage: "The change could not be confirmed. Reload the page before trying again.",
    maxBytes: 512,
    command: async (api, body) => {
      const catalogue = new Set((await listCatalogueSamples()).map((sample) => sample.slug));
      const result = await setStaffSamplePostHidden(api, body, catalogue);
      // This server instance shows the change at once; others within 30 seconds.
      forgetHiddenSampleSlugs();
      return { success: true as const, sample: result };
    },
  });
}
