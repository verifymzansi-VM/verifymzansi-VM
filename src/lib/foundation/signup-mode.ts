import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
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

const emailDomainResult = z.strictObject({ allowed: z.boolean() });

/** Whether `email` may be used (api.check_email_domain): false only while
 * sign-up is open and the sign-up hook's domain rule refuses its domain
 * (malformed, reserved or blocked). Throws when the answer cannot be read. */
export async function checkFoundationEmailDomain(
  api: FoundationAuthenticatedApi,
  email: string
): Promise<boolean> {
  const { data, error } = await api.rpc("check_email_domain", { p_email: email }, { get: false });
  if (error) throw new Error("Email domain check failed");
  return emailDomainResult.parse(data).allowed;
}
