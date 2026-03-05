import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Notifications");

export interface CreateNotificationInput {
  userId: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  href?: string;
}

/**
 * Insert a notification for a user. Call from server actions, API routes, or webhooks.
 * The Supabase Realtime subscription on the `notifications` table will push
 * the new row to the client's NotificationBell automatically.
 *
 * @example
 * ```ts
 * await createNotification({
 *   userId: sellerId,
 *   type: "success",
 *   title: "Your listing was approved!",
 *   message: "Your listing 'Red Sneakers' is now live.",
 *   href: "/dashboard/listings",
 * });
 * ```
 */
export async function createNotification(input: CreateNotificationInput): Promise<boolean> {
  try {
    const supabase = await createClient();

    const { error } = await supabase.from("notifications").insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      message: input.message ?? null,
      href: input.href ?? null,
    });

    if (error) {
      log.error("createNotification failed", { error: error.message });
      return false;
    }

    return true;
  } catch (err) {
    log.error("createNotification unexpected error", { error: String(err) });
    return false;
  }
}

/**
 * Send multiple notifications at once (e.g., bulk moderation actions).
 */
export async function createNotifications(inputs: CreateNotificationInput[]): Promise<boolean> {
  if (inputs.length === 0) return true;

  try {
    const supabase = await createClient();

    const { error } = await supabase.from("notifications").insert(
      inputs.map((input) => ({
        user_id: input.userId,
        type: input.type,
        title: input.title,
        message: input.message ?? null,
        href: input.href ?? null,
      }))
    );

    if (error) {
      log.error("createNotifications failed", { error: error.message });
      return false;
    }

    return true;
  } catch (err) {
    log.error("createNotifications unexpected error", { error: String(err) });
    return false;
  }
}
