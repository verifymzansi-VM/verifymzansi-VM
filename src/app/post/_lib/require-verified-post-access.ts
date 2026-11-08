import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveAccountVerification } from "@/lib/account/resolved-verification";
import { buildVerificationRedirectUrl, isVerifiedMember } from "@/app/post/_lib/post-access";
import { getDataBackend } from "@/lib/data-backend";
import { buildLoginUrl } from "@/lib/utils/navigation";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("PostAccess");

type FoundationPostAccess = "allowed" | "verification" | "login" | "forbidden";

/**
 * Early page check for the create-post forms. It only decides where to send
 * the member; the database still refuses an unverified submit and approval.
 *
 * Foundation: asks the replacement database for the signed-in member's own
 * readiness (identity accepted, phone proven and area confirmed). Anything
 * other than a clear "ready" — including an unavailable or malformed answer —
 * sends the member to /verification, which never redirects back by itself.
 */
async function readFoundationPostAccess(): Promise<FoundationPostAccess> {
  const { readFoundationServerSession, FoundationServerSessionError } =
    await import("@/lib/foundation/server-session");
  const { readFoundationVerificationReadiness, FoundationVerificationReadinessError } =
    await import("@/lib/foundation/verification-readiness");
  let session: Awaited<ReturnType<typeof readFoundationServerSession>>;
  try {
    session = await readFoundationServerSession();
  } catch (error) {
    if (error instanceof FoundationServerSessionError && error.status === 401) return "login";
    if (error instanceof FoundationServerSessionError && error.status === 403) return "forbidden";
    // Category only: never ids, emails or raw error messages.
    log.warn("Post access session unavailable", {
      reason:
        error instanceof FoundationServerSessionError ? `session_${error.status}` : "session_threw",
    });
    return "verification";
  }
  try {
    const readiness = await readFoundationVerificationReadiness(session.api);
    return readiness.verification_ready === true ? "allowed" : "verification";
  } catch (error) {
    log.warn(
      "Post access readiness unavailable",
      error instanceof FoundationVerificationReadinessError
        ? { reason: error.reason, code: error.code }
        : { reason: "threw", code: null }
    );
    return "verification";
  }
}

export async function requireVerifiedPostAccess(returnUrl: string) {
  if (getDataBackend() === "foundation") {
    // redirect() throws, so it stays outside the try blocks above.
    const access = await readFoundationPostAccess();
    if (access === "allowed") return;
    if (access === "login") redirect(buildLoginUrl(returnUrl));
    if (access === "forbidden") redirect("/error?reason=forbidden");
    redirect(buildVerificationRedirectUrl(returnUrl));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const verification = await resolveAccountVerification(supabase, user.id, {
    includeStepsWhenVerified: true,
  });

  if (!isVerifiedMember(verification.accountVerificationStatus)) {
    redirect(buildVerificationRedirectUrl(returnUrl));
  }
}
