import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  buildViewerKey,
  createAnonymousViewerId,
  ENGAGEMENT_VIEWER_COOKIE,
  ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
  isContentTargetType,
  type ContentTargetType,
} from "@/lib/engagement";
import { createClient } from "@/lib/supabase/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkLocalRateLimit, getClientRateLimitKey } from "@/lib/utils/rate-limit";
import type { Logger } from "@/lib/utils/logger";
import { uuidSchema } from "@/lib/validations/shared";

const engagementRequestSchema = z.object({
  targetId: uuidSchema,
  targetType: z.string().refine(isContentTargetType, "Invalid target type"),
});

type PreparedEngagementMutation = {
  targetId: string;
  targetType: ContentTargetType;
  userId: string | null;
  viewerKey: string;
  existingViewerId: string | null;
  nextViewerId: string;
};

type PrepareEngagementMutationOptions = {
  log: Logger;
  rateLimitBucket: string;
  rateLimitMax: number;
  missingViewerResponse: NextResponse;
};

export async function prepareEngagementMutation(
  request: NextRequest,
  options: PrepareEngagementMutationOptions
): Promise<
  | {
      success: true;
      data: PreparedEngagementMutation;
    }
  | {
      success: false;
      response: NextResponse;
    }
> {
  const originBlock = enforceSameOriginMutation(request, options.log);
  if (originBlock) {
    return { success: false, response: originBlock };
  }

  const parsedBody = await parseAndValidateJsonRequest(request, engagementRequestSchema, {
    invalidJsonMessage: "Invalid engagement payload",
    validationErrorMessage: "Invalid engagement payload",
    includeValidationDetails: false,
  });
  if (!parsedBody.success) {
    return { success: false, response: parsedBody.response };
  }

  const rateLimit = checkLocalRateLimit(
    getClientRateLimitKey(request),
    options.rateLimitBucket,
    options.rateLimitMax
  );
  if (rateLimit.limited) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfter ?? 60) },
        }
      ),
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const existingViewerId = request.cookies.get(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null;
  const nextViewerId = existingViewerId ?? createAnonymousViewerId();
  const viewerKey = buildViewerKey(nextViewerId, user?.id);

  if (!viewerKey) {
    return { success: false, response: options.missingViewerResponse };
  }

  return {
    success: true,
    data: {
      targetId: parsedBody.data.targetId,
      targetType: parsedBody.data.targetType as ContentTargetType,
      userId: user?.id ?? null,
      viewerKey,
      existingViewerId,
      nextViewerId,
    },
  };
}

export function setEngagementViewerCookie(
  response: NextResponse,
  viewer: Pick<PreparedEngagementMutation, "existingViewerId" | "nextViewerId">
): void {
  if (viewer.existingViewerId) {
    return;
  }

  response.cookies.set({
    name: ENGAGEMENT_VIEWER_COOKIE,
    value: viewer.nextViewerId,
    maxAge: ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}
