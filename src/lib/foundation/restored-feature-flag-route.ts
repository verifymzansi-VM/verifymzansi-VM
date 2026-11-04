import "server-only";
import type { NextRequest } from "next/server";
import { handleFoundationOwnerRoute } from "./owner-route";
import { setFrontendFeatureFlag } from "./feature-controls";
import { staffCommandRefusal } from "./staff-command";
import { createLogger } from "../utils/logger";
const log = createLogger("NativeFeatureFlag");
export function handleRestoredFeatureFlag(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:feature-flags:toggle",
    mutate: true,
    refusal: staffCommandRefusal,
    signInMessage: "Sign in to manage display settings",
    unavailableMessage: "The setting could not be confirmed. Reload settings before trying again.",
    command: async (api, body) => ({
      success: true,
      flag: await setFrontendFeatureFlag(api, body),
    }),
  });
}
