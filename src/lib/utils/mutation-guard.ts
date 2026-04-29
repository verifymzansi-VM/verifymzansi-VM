import type { NextResponse } from "next/server";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import type { Logger } from "@/lib/utils/logger";

export function enforceMutationRequest(request: Request, logger: Logger): NextResponse | null {
  return enforceSameOriginMutation(request, logger) ?? enforceCsrfToken(request, logger);
}
