import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    .select("seller_verification_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!isVerifiedSeller(profile?.seller_verification_status ?? null)) {
    redirect(buildVerificationRedirectUrl(returnUrl));
  }
}
