import { NextResponse } from "next/server";

import { checkLocalRateLimit } from "@/lib/utils/rate-limit";

type AuthClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null } }>;
  };
};

type AuthenticatedMutationResult =
  | {
      user: { id: string };
      response?: never;
    }
  | {
      user?: never;
      response: NextResponse;
    };

export async function requireAuthenticatedLocalMutation(
  supabase: AuthClient,
  rateLimitKey: string
): Promise<AuthenticatedMutationResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const rl = checkLocalRateLimit(user.id, rateLimitKey);
  if (rl.limited) {
    return {
      response: NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      ),
    };
  }

  return { user: { id: user.id } };
}
