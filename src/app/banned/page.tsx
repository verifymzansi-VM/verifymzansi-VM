import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import { BannedPageContent } from "./banned-content";
import { getDataBackend } from "@/lib/data-backend";
import { readSelfReviewSession } from "@/lib/foundation/self-review-session";
import { FoundationSessionError } from "@/lib/foundation/request-api";

export default async function BannedPage() {
  if (getDataBackend() === "foundation") {
    let status;
    try {
      status = await readSelfReviewSession();
    } catch (error) {
      if (error instanceof FoundationSessionError && error.status === 401) redirect("/");
      throw error;
    }
    if (status?.status !== "banned") redirect("/");
    return <BannedPageContent />;
  }
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
