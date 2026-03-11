import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readAccountVerificationStatus } from "@/lib/account/compat";
import { buildVerificationRedirectUrl, isVerifiedSeller } from "@/app/post/_lib/post-access";

export async function requireVerifiedPostAccess(returnUrl: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const { data: profile } = await supabase
    .from("seller_profiles")
    .select("account_verification_status, seller_verification_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!isVerifiedSeller(readAccountVerificationStatus(profile))) {
    redirect(buildVerificationRedirectUrl(returnUrl));
  }
}
