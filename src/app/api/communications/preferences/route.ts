import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import {
  internalApiError,
  logApiError,
  parseAndValidateJsonRequest,
  parseAndValidateSearchParams,
} from "@/lib/utils/api";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";
import { getConsents, updateConsent, type ConsentPurpose } from "@/lib/services/consent";

const log = createLogger("CommunicationPreferences");

const preferenceQuerySchema = z.object({
  includeRequired: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

const preferenceUpdateSchema = z
  .object({
    marketing_email: z.boolean().optional(),
    marketing_sms: z.boolean().optional(),
    analytics: z.boolean().optional(),
    third_party_sharing: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one preference must be provided",
  });

const OPTIONAL_PREFERENCES: ConsentPurpose[] = [
  "marketing_email",
  "marketing_sms",
  "analytics",
  "third_party_sharing",
];

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkLocalRateLimit(user.id, "communication:preferences:read");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const parsedQuery = parseAndValidateSearchParams(
      new URL(request.url).searchParams,
      preferenceQuerySchema,
      {
        validationErrorMessage: "Invalid communication preferences query",
      }
    );

    if (!parsedQuery.success) {
      return parsedQuery.response;
    }

    const consentRecord = await getConsents(user.id);
    const optionalConsents = OPTIONAL_PREFERENCES.reduce<Record<string, boolean>>((acc, key) => {
      acc[key] = consentRecord[key];
      return acc;
    }, {});

    const includeRequired = parsedQuery.data.includeRequired;

    return NextResponse.json(
      {
        preferences: optionalConsents,
        required: includeRequired
          ? {
              transactional_email: true,
              data_processing: consentRecord.data_processing,
            }
          : undefined,
      },
      {
        headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      }
    );
  } catch (error) {
    logApiError(log, "Failed to fetch communication preferences", error);
    return internalApiError();
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const sameOriginBlock = enforceSameOriginMutation(request, log);
    if (sameOriginBlock) return sameOriginBlock;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkLocalRateLimit(user.id, "communication:preferences:update");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const bodyResult = await parseAndValidateJsonRequest(request, preferenceUpdateSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid communication preferences payload",
      includeValidationDetails: false,
    });

    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const updates = Object.entries(bodyResult.data) as Array<[ConsentPurpose, boolean]>;

    const updateResults = await Promise.all(
      updates.map(([purpose, granted]) => updateConsent({ userId: user.id, purpose, granted }))
    );

    const failed = updateResults.find((result) => !result.success);
    if (failed) {
      return NextResponse.json(
        { error: failed.error || "Failed to update preferences" },
        { status: 500 }
      );
    }

    const preferences = await getConsents(user.id);

    return NextResponse.json({
      success: true,
      preferences: {
        marketing_email: preferences.marketing_email,
        marketing_sms: preferences.marketing_sms,
        analytics: preferences.analytics,
        third_party_sharing: preferences.third_party_sharing,
      },
    });
  } catch (error) {
    logApiError(log, "Failed to update communication preferences", error);
    return internalApiError();
  }
}
