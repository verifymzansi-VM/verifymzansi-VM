import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/utils/logger";
import {
  internalApiError,
  logApiError,
  parseAndValidateJsonRequest,
  parseAndValidateSearchParams,
  rateLimitResponse,
  unauthorizedResponse,
} from "@/lib/utils/api";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import {
  createBooleanFlagSchema,
  createBoundedIntegerSchema,
  uuidSchema,
} from "@/lib/validations/shared";

const log = createLogger("LeadsRoute");

const leadQuerySchema = z.object({
  unread: createBooleanFlagSchema(false),
  limit: createBoundedIntegerSchema({
    defaultValue: 25,
    min: 1,
    max: 50,
    fieldName: "limit",
  }),
  countOnly: createBooleanFlagSchema(false),
});

const leadMutationSchema = z.object({
  id: uuidSchema,
  status: z.enum(["read", "contacted", "closed"]),
});

/**
 * GET /api/leads
 * Fetch the authenticated user's leads and unread lead count.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const rl = checkLocalRateLimit(user.id, "leads:read");
    if (rl.limited) {
      return rateLimitResponse(rl.retryAfter ?? 60);
    }

    const parsedQuery = parseAndValidateSearchParams(
      new URL(request.url).searchParams,
      leadQuerySchema,
      {
        validationErrorMessage: "Invalid leads query",
      }
    );

    if (!parsedQuery.success) {
      return parsedQuery.response;
    }

    const { unread: unreadOnly, limit, countOnly } = parsedQuery.data;

    const { count: unreadCount } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "new");

    if (countOnly) {
      return NextResponse.json({ unreadCount: unreadCount || 0, leads: [] });
    }

    let query = supabase
      .from("leads")
      .select("id, target_id, target_type, message, status, buyer_name, buyer_email, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      query = query.eq("status", "new");
    }

    const { data, error } = await query;

    if (error) {
      log.error("Failed to fetch leads", { error: error.message, userId: user.id });
      return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
    }

    return NextResponse.json(
      {
        leads: data || [],
        unreadCount: unreadCount || 0,
      },
      {
        headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      }
    );
  } catch (error) {
    logApiError(log, "Unexpected leads fetch error", error);
    return internalApiError();
  }
}

/**
 * PATCH /api/leads
 * Update a lead status for the authenticated owner.
 */
export async function PATCH(request: NextRequest) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) {
      return sameOriginFailure;
    }

    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const rl = checkLocalRateLimit(user.id, "leads:update");
    if (rl.limited) {
      return rateLimitResponse(rl.retryAfter ?? 60);
    }

    const parsedBody = await parseAndValidateJsonRequest(request, leadMutationSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid lead update request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const { data, error } = await supabase
      .from("leads")
      .update({ status: parsedBody.data.status })
      .eq("id", parsedBody.data.id)
      .select("id, status")
      .maybeSingle();

    if (error) {
      log.error("Failed to update lead status", {
        error: error.message,
        userId: user.id,
        leadId: parsedBody.data.id,
      });
      return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, lead: data });
  } catch (error) {
    logApiError(log, "Unexpected leads update error", error);
    return internalApiError();
  }
}
