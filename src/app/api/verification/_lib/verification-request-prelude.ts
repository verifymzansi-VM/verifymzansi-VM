import { type NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buildVerificationEmailConfirmationRequiredPayload } from "@/lib/constants/verification-email-confirmation";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import type { Logger } from "@/lib/utils/logger";

type ConfirmedVerificationRequest =
  | {
      success: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: User;
    }
  | {
      success: false;
      response: NextResponse;
    };

export async function enforceConfirmedVerificationRequest(
  request: NextRequest,
  logger: Logger
): Promise<ConfirmedVerificationRequest> {
  const mutationBlock = enforceMutationRequest(request, logger);
  if (mutationBlock) {
    return { success: false, response: mutationBlock };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!user.email_confirmed_at) {
    return {
      success: false,
      response: NextResponse.json(buildVerificationEmailConfirmationRequiredPayload(), {
        status: 403,
      }),
    };
  }

  return { success: true, supabase, user };
}
