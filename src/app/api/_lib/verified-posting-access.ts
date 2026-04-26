import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createVerificationRequiredPayload, isVerifiedMember } from "@/app/post/_lib/post-access";
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR } from "@/lib/account/compat";
import { resolveAccountVerification } from "@/lib/account/resolved-verification";
import { hasPhoneNumber } from "@/lib/account/require-phone";
import type { MarketplaceArea } from "@/types/enums";

type VerificationClient = Pick<SupabaseClient, "from">;

export async function enforceVerifiedPostingAccess(
  supabase: VerificationClient,
  userId: string,
  area: MarketplaceArea
): Promise<NextResponse | null> {
  const verification = await resolveAccountVerification(supabase, userId, {
    includeStepsWhenVerified: true,
  });
  const profile = verification.profile;

  if (!profile) {
    return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
  }

  if (!isVerifiedMember(verification.accountVerificationStatus)) {
    return NextResponse.json(createVerificationRequiredPayload(area), { status: 403 });
  }

  if (!(await hasPhoneNumber(supabase, userId))) {
    return NextResponse.json(
      { error: "Phone number required", redirectUrl: "/dashboard/complete-profile" },
      { status: 403 }
    );
  }

  return null;
}
