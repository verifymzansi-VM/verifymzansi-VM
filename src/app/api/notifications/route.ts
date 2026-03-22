import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import {
  internalApiError,
  logApiError,
  parseAndValidateJsonRequest,
  parseAndValidateSearchParams,
} from "@/lib/utils/api";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import {
  createBooleanFlagSchema,
  createBoundedIntegerSchema,
  uuidSchema,
} from "@/lib/validations/shared";

const log = createLogger("NotificationsRoute");

const notificationMutationSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ id: uuidSchema }),
]);

const notificationQuerySchema = z.object({
  unread: createBooleanFlagSchema(false),
  limit: createBoundedIntegerSchema({
    defaultValue: 25,
    min: 1,
    max: 50,
    fieldName: "limit",
  }),
});

/**
 * GET /api/notifications
 * Fetch the authenticated user's notifications.
 * Query params: ?unread=true (filter to unread only), ?limit=25 (pagination)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkLocalRateLimit(user.id, "notifications:read");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const parsedQuery = parseAndValidateSearchParams(
      new URL(request.url).searchParams,
      notificationQuerySchema,
      {
        validationErrorMessage: "Invalid notifications query",
      }
    );

    if (!parsedQuery.success) {
      return parsedQuery.response;
    }

    const { unread: unreadOnly, limit } = parsedQuery.data;

    let query = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      query = query.eq("read", false);
    }

    const { data, error } = await query;

    if (error) {
      log.error("Failed to fetch notifications", { error: error.message, userId: user.id });
      return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
    }

    // Also get unread count
    const { count: unreadCount } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false);

    return NextResponse.json({
      notifications: data || [],
      unreadCount: unreadCount || 0,
    });
  } catch (error) {
    logApiError(log, "Unexpected notifications fetch error", error);
    return internalApiError();
  }
}

/**
 * PATCH /api/notifications
 * Mark notifications as read.
 * Body: { id: string } — mark single notification read
 * Body: { all: true } — mark all notifications read
 */
export async function PATCH(request: NextRequest) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) {
      return sameOriginFailure;
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkLocalRateLimit(user.id, "notifications:update");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, notificationMutationSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Must provide 'id' or 'all: true'",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    if ("all" in parsedBody.data && parsedBody.data.all === true) {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", user.id)
        .eq("read", false);

      if (error) {
        log.error("Failed to mark all notifications as read", {
          error: error.message,
          userId: user.id,
        });
        return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: "All notifications marked as read" });
    }

    if ("id" in parsedBody.data) {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", parsedBody.data.id)
        .eq("user_id", user.id);

      if (error) {
        log.error("Failed to mark notification as read", {
          error: error.message,
          userId: user.id,
        });
        return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Must provide 'id' or 'all: true'" }, { status: 400 });
  } catch (error) {
    logApiError(log, "Unexpected notifications update error", error);
    return internalApiError();
  }
}

/**
 * DELETE /api/notifications
 * Clear all notifications for the user, or delete a single one.
 * Body: { id: string } — delete single notification
 * Body: { all: true } — delete all
 */
export async function DELETE(request: NextRequest) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) {
      return sameOriginFailure;
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsedBody = await parseAndValidateJsonRequest(request, notificationMutationSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Must provide 'id' or 'all: true'",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    if ("all" in parsedBody.data && parsedBody.data.all === true) {
      const { error } = await supabase.from("notifications").delete().eq("user_id", user.id);

      if (error) {
        log.error("Failed to clear notifications", {
          error: error.message,
          userId: user.id,
        });
        return NextResponse.json({ error: "Failed to delete notifications" }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: "All notifications cleared" });
    }

    if ("id" in parsedBody.data) {
      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("id", parsedBody.data.id)
        .eq("user_id", user.id);

      if (error) {
        log.error("Failed to delete notification", {
          error: error.message,
          userId: user.id,
        });
        return NextResponse.json({ error: "Failed to delete notifications" }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Must provide 'id' or 'all: true'" }, { status: 400 });
  } catch (error) {
    logApiError(log, "Unexpected notifications delete error", error);
    return internalApiError();
  }
}
