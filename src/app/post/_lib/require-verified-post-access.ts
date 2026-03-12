import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_PROFILE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import { buildVerificationRedirectUrl, isVerifiedMember } from "@/app/post/_lib/post-access";

export async function requireVerifiedPostAccess(returnUrl: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const { data: profile } = await supabase
    .from(ACCOUNT_PROFILE_TABLE)
    .select("account_verification_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!isVerifiedMember(readAccountVerificationStatus(profile))) {
    redirect(buildVerificationRedirectUrl(returnUrl));
  }
}
