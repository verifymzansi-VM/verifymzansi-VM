import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import { BannedPageContent } from "./banned-content";

export default async function BannedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from(ACCOUNT_PROFILE_TABLE)
    .select("account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.account_status !== "banned") redirect("/");

  return <BannedPageContent />;
}
