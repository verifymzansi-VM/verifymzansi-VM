import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppLogger } from "@/lib/utils/logger";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";

type PostingMutationSession =
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: NonNullable<
        Awaited<
          ReturnType<Awaited<ReturnType<typeof createClient>>["auth"]["getUser"]>
        >["data"]["user"]
      >;
      getAdmin: () => ReturnType<typeof createAdminClient>;
      response?: never;
    }
  | {
      supabase?: never;
      user?: never;
      getAdmin?: never;
      response: NextResponse;
    };

export async function requirePostingMutationSession(
  request: Request,
  log: AppLogger
): Promise<PostingMutationSession> {
  const mutationBlock = enforceMutationRequest(request, log);
  if (mutationBlock) {
    return { response: mutationBlock };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  let admin: ReturnType<typeof createAdminClient> | null = null;
  const getAdmin = () => {
    admin ??= createAdminClient();
    return admin;
  };

  return { supabase, user, getAdmin };
}
