import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import { createLogger } from "@/lib/utils/logger";

type MinimalUser = {
  id: string;
  email?: string | null;
  user_metadata?: unknown;
};

const log = createLogger("EnsureProfile");

function normalizeDisplayNameValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derive a display name from a user's metadata or email prefix.
 */
export function getDefaultDisplayName(user: {
  email?: string | null;
  user_metadata?: unknown;
}): string {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName = normalizeDisplayNameValue(metadata.display_name);
  const fullName = normalizeDisplayNameValue(metadata.full_name);

  if (displayName) {
    return displayName;
  }

  if (fullName) {
    return fullName;
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
): Promise<{ id: string; display_name: string } | null> {
  const resolvedDisplayName = getDefaultDisplayName(user);
  const { data: existing } = await admin
    .from(ACCOUNT_PROFILE_TABLE)
    .select("id, display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    const existingDisplayName = normalizeDisplayNameValue(existing.display_name);

    if (existingDisplayName) {
      return {
        id: existing.id,
        display_name: existingDisplayName,
      };
    }

    const { data: repaired, error: repairError } = await admin
      .from(ACCOUNT_PROFILE_TABLE)
      .update({ display_name: resolvedDisplayName })
      .eq("id", existing.id)
      .eq("user_id", user.id)
      .select("id, display_name")
      .single();

    if (repairError || !repaired) {
      log.error("Failed to repair account profile display name", {
        error: repairError?.message,
        userId: user.id,
      });
      return null;
    }

    log.info("Repaired missing account profile display name", { userId: user.id });
    return repaired as { id: string; display_name: string };
  }

  const { data: created, error: createError } = await admin
    .from(ACCOUNT_PROFILE_TABLE)
    .upsert(
      {
        user_id: user.id,
        display_name: resolvedDisplayName,
        account_verification_status: "incomplete",
        account_status: "active",
      },
      { onConflict: "user_id" }
    )
    .select("id, display_name")
    .single();

  if (createError || !created) {
    log.error("Failed to auto-create account profile", {
      error: createError?.message,
      userId: user.id,
    });
    return null;
  }

  log.info("Auto-created missing account profile", { userId: user.id });
  return created as { id: string; display_name: string };
}

export function resolveAccountDisplayName(options: {
  profileDisplayName?: string | null;
  email?: string | null;
  user_metadata?: unknown;
}): string {
  const profileDisplayName = normalizeDisplayNameValue(options.profileDisplayName);

  if (profileDisplayName) {
    return profileDisplayName;
  }

  return getDefaultDisplayName({
    email: options.email,
    user_metadata: options.user_metadata,
  });
}
