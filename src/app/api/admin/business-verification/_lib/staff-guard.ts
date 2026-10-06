import { NextResponse } from "next/server";

import { idRouteParamsSchema } from "@/app/api/_lib/route-params";
import type { Capability } from "@/lib/auth/roles";
import { checkQueueClaim } from "@/lib/services/queue-claims";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { parseAndValidateRouteParams } from "@/lib/utils/api";
import type { createLogger } from "@/lib/utils/logger";
import { readBoundedRequestFormData, RequestBodyTooLargeError } from "@/lib/utils/request-body";

type Guarded = Extract<Awaited<ReturnType<typeof enforceAdminMutationGuard>>, { success: true }>;

export type StaffCaseContext = {
  caseId: string;
  user: Guarded["user"];
  actorRole: Guarded["actorRole"];
};

/**
 * Common gate for staff actions on one business verification case: valid
 * case id, same-origin + CSRF + staff role + MFA (enforceAdminMutationGuard),
 * and — for queue work — the caller holds the case's claim (or is a governor
 * or admin acting on an unclaimed case).
 */
export async function requireStaffCase(
  request: Request,
  params: Promise<{ id: string }>,
  options: {
    log: ReturnType<typeof createLogger>;
    capability?: Capability;
    requireClaim?: boolean;
  }
): Promise<StaffCaseContext | NextResponse> {
  const route = parseAndValidateRouteParams(await params, idRouteParamsSchema, {
    validationErrorMessage: "Invalid case ID",
    includeValidationDetails: false,
  });
  if (!route.success) return route.response;

  const guard = await enforceAdminMutationGuard({
    request,
    logger: options.log,
    capability: options.capability ?? "queue:view",
    rateLimitAction: "admin:business-verification",
  });
  if (!guard.success) return guard.response;

  if (options.requireClaim !== false) {
    const refused = await checkQueueClaim(guard.user.id, {
      type: "business_verification",
      id: route.data.id,
    });
    if (refused) return refused;
  }

  return { caseId: route.data.id, user: guard.user, actorRole: guard.actorRole };
}

/** A staff upload (multipart, 6 MB cap) with its `file` field. */
export async function readStaffUpload(
  request: Request,
  missingMessage: string
): Promise<{ form: FormData; file: File } | NextResponse> {
  let form: FormData;
  try {
    form = await readBoundedRequestFormData(request, 6 * 1024 * 1024);
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    return NextResponse.json(
      { error: tooLarge ? "Files can be up to 5 MB." : "Send multipart/form-data." },
      { status: tooLarge ? 413 : 400 }
    );
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: missingMessage }, { status: 400 });
  }
  return { form, file };
}
