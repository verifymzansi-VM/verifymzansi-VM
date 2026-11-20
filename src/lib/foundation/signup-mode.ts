import { z } from "zod";
import { createFoundationPublicApi } from "./public-api";

/**
 * The sign-up mode held in the database (update
 * 20261120040242_signup_mode_member_invitations.sql): "invite_only" (the
 * default) or "open". Only the database owner changes it
 * (internal.set_signup_mode, SQL editor); the sign-up hook in Auth enforces
 * it. The website reads it only to word its registration reply.
 */
export type FoundationSignupMode = "invite_only" | "open";

const signupModeResult = z.strictObject({ mode: z.enum(["invite_only", "open"]) });

/** The current sign-up mode, or null when it cannot be read (the caller then
 * falls back to FOUNDATION_REGISTRATION_INVITE_ONLY). Never throws. */
export async function readFoundationSignupMode(
  connection: unknown,
  fetcher?: typeof fetch
): Promise<FoundationSignupMode | null> {
  try {
    const api = createFoundationPublicApi(connection, fetcher);
    const { data, error } = await api.rpc("get_signup_mode", {}, { get: false });
    if (error) return null;
    const parsed = signupModeResult.safeParse(data);
    return parsed.success ? parsed.data.mode : null;
  } catch {
    return null;
  }
}
