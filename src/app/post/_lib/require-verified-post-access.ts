import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveAccountVerification } from "@/lib/account/resolved-verification";
import { buildVerificationRedirectUrl, isVerifiedMember } from "@/app/post/_lib/post-access";

export async function requireVerifiedPostAccess(returnUrl: string) {
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
