import { createAdminClient } from "@/lib/supabase/admin";
import { hasCapability, type Capability } from "@/lib/auth/roles";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Notifications");

export interface CreateNotificationInput {
  userId: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  href?: string;
}

interface NotifyStaffForAdminEventInput {
  capability: Capability;
  title: string;
  message?: string;
  href: string;
  excludeUserId?: string;
}

type AuthListUser = {
  id: string;
  app_metadata?: Record<string, unknown> | null;
};

/**
 * Rollout guard for owner lifecycle notifications.
 * Set ENABLE_OWNER_LIFECYCLE_NOTIFICATIONS=false to disable these messages.
 */
export function shouldSendOwnerLifecycleNotifications(): boolean {
  return process.env.ENABLE_OWNER_LIFECYCLE_NOTIFICATIONS !== "false";
}

/**
 * Insert a notification for a user. Call from server actions, API routes, or webhooks.
 * The Supabase Realtime subscription on the `notifications` table will push
 * the new row to the client's NotificationBell automatically.
 *
 * @example
 * ```ts
 * await createNotification({
 *   userId: ownerId,
 *   type: "success",
 *   title: "Your listing was approved!",
 *   message: "Your listing 'Red Sneakers' is now live.",
 *   href: "/dashboard/listings",
 * });
 * ```
 */
export async function createNotification(input: CreateNotificationInput): Promise<boolean> {
  try {
    const supabase = createAdminClient();

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
    const supabase = createAdminClient();

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

async function listStaffRecipientIdsForCapability(
  capability: Capability,
  excludeUserId?: string
): Promise<string[]> {
  const supabase = createAdminClient();
  const authAdmin = supabase.auth.admin;
  const recipientIds = new Set<string>();
  const perPage = 200;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await authAdmin.listUsers({ page, perPage });
    if (error) {
      throw new Error(error.message || "Failed to list staff users");
    }

    const users = (data?.users ?? []) as AuthListUser[];
    for (const user of users) {
      if (!user?.id || user.id === excludeUserId) {
        continue;
      }

      if (
        hasCapability({ app_metadata: user.app_metadata ?? {}, is_anonymous: false }, capability)
      ) {
        recipientIds.add(user.id);
      }
    }

    if (users.length < perPage) {
      break;
    }
  }

  return [...recipientIds];
}

export async function notifyStaffForAdminEvent(
  input: NotifyStaffForAdminEventInput
): Promise<boolean> {
  try {
    const recipientIds = await listStaffRecipientIdsForCapability(
      input.capability,
      input.excludeUserId
    );

    if (recipientIds.length === 0) {
      return true;
    }

    return createNotifications(
      recipientIds.map((userId) => ({
        userId,
        type: "warning",
        title: input.title,
        message: input.message,
        href: input.href,
      }))
    );
  } catch (err) {
    log.error("notifyStaffForAdminEvent failed", {
      error: err instanceof Error ? err.message : String(err),
      capability: input.capability,
    });
    return false;
  }
}
