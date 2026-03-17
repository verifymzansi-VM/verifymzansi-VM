import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import { createLogger } from "@/lib/utils/logger";

type MinimalUser = {
  id: string;
  email?: string | null;
  user_metadata?: unknown;
};

const log = createLogger("EnsureProfile");

/**
 * Derive a display name from a user's metadata or email prefix.
 */
export function getDefaultDisplayName(user: {
  email?: string | null;
  user_metadata?: unknown;
}): string {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName = metadata.display_name;
  const fullName = metadata.full_name;

  if (typeof displayName === "string" && displayName.trim().length > 0) {
    return displayName.trim();
  }

  if (typeof fullName === "string" && fullName.trim().length > 0) {
    return fullName.trim();
  }

  if (user.email) {
    return user.email.split("@")[0] || "New Member";
  }

  return "New Member";
}

/**
 * Look up the user's account profile; if none exists, auto-create one via
 * upsert so the user isn't blocked by a missing row.
 *
 * Returns `{ id: string }` on success, or `null` if the auto-create fails.
 */
export async function ensureAccountProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  user: MinimalUser
): Promise<{ id: string } | null> {
  const { data: existing } = await admin
    .from(ACCOUNT_PROFILE_TABLE)
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return existing as { id: string };
  }

  const { data: created, error: createError } = await admin
    .from(ACCOUNT_PROFILE_TABLE)
    .upsert(
      {
        user_id: user.id,
        display_name: getDefaultDisplayName(user),
        account_verification_status: "incomplete",
        account_status: "active",
      },
      { onConflict: "user_id" }
    )
    .select("id")
    .single();

  if (createError || !created) {
    log.error("Failed to auto-create account profile", {
      error: createError?.message,
      userId: user.id,
    });
    return null;
  }

  log.info("Auto-created missing account profile", { userId: user.id });
  return created as { id: string };
}
