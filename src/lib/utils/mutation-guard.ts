import type { NextResponse } from "next/server";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import type { Logger } from "@/lib/utils/logger";
import { recordSecurityEvent, securityContext } from "@/lib/security/security-events";

export function enforceMutationRequest(request: Request, logger: Logger): NextResponse | null {
  const blocked = enforceSameOriginMutation(request, logger);
  if (blocked) return blocked;
  const csrf = enforceCsrfToken(request, logger);
  // csrf.ts is shared with the browser, so the rejection is recorded here.
  if (csrf) recordSecurityEvent({ event: "request.csrf_rejected", ...securityContext(request) });
  return csrf;
}
