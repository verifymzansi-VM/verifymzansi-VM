import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { idRouteParamsSchema } from "@/app/api/_lib/route-params";
import {
  isIdReviewed,
  loadOwnedBusiness,
  type OwnedBusiness,
} from "@/lib/business-verification/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseAndValidateRouteParams } from "@/lib/utils/api";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import type { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export type OwnerContext = {
  userId: string;
  admin: SupabaseClient;
  business: OwnedBusiness;
};

type Options = {
  log: ReturnType<typeof createLogger>;
  mutation?: boolean;
  /** Shared rate-limit action, keyed per account and business. */
  rateAction?: string;
  /** Viewing status is allowed before ID review; actions are not. */
  requireIdReviewed?: boolean;
};

/**
 * Common gate for the owner's business verification routes: same-origin and
 * CSRF for mutations, signed in, owns the business, and (for actions) has the
 * ID Reviewed sticker. Returns a response to send when the gate fails.
 */
export async function requireVerificationOwner(
  request: NextRequest,
  params: Promise<{ id: string }>,
  options: Options
): Promise<OwnerContext | NextResponse> {
  if (options.mutation) {
    const originBlock = enforceSameOriginMutation(request, options.log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(request, options.log);
    if (csrfBlock) return csrfBlock;
  }

  const parsed = parseAndValidateRouteParams(await params, idRouteParamsSchema, {
    validationErrorMessage: "Invalid business ID",
    includeValidationDetails: false,
  });
  if (!parsed.success) return parsed.response;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (options.rateAction) {
    const limit = await checkRateLimit({
      key: `${user.id}:${parsed.data.id}`,
      action: options.rateAction,
      degradedMode: "local",
    });
    if (limit.limited) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } }
      );
    }
  }

  const admin = createAdminClient();
  const business = await loadOwnedBusiness(admin, user.id, parsed.data.id);
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  if (options.requireIdReviewed !== false && !(await isIdReviewed(admin, user.id))) {
    return NextResponse.json(
      {
        error: "Verify your ID first, then you can verify your business.",
        code: "id_review_required",
        redirectUrl: "/verification",
      },
      { status: 403 }
    );
  }

  return { userId: user.id, admin, business };
}
