import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { FoundationAuthenticatedDatabase } from "../../../database/foundation/api-role-types";
import { parseFoundationConnection } from "./connection";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";

export type FoundationAuthenticatedApi = Pick<
  SupabaseClient<FoundationAuthenticatedDatabase, "api">,
  "rpc"
>;
const callerShape = z.object({
  role: z.literal("authenticated"),
  sub: z.uuid(),
  session_id: z.uuid(),
});

/** Pass the actual token from the current request's Auth session. This shape
 * check prevents key/role mixups; it does NOT verify a token or grant authority.
 * PostgREST verifies the signature and SQL rechecks the live caller/session.
 * No actor, capability or MFA assertion is constructed here. No shared singleton,
 * refresh, cookie/storage state or automatic retry can substitute another caller.
 */
export function createFoundationAuthenticatedApi(
  input: unknown,
  accessToken: string,
  fetcher: typeof fetch = createTimeoutFetch()
): FoundationAuthenticatedApi {
  const config = parseFoundationConnection(input);
  try {
    if (
      typeof accessToken !== "string" ||
      accessToken.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)
    )
      throw new Error();
    const payload = accessToken.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    callerShape.parse(JSON.parse(atob(payload)));
  } catch {
    throw new Error("A current authenticated caller token is required");
  }
  const client = createClient<FoundationAuthenticatedDatabase, "api">(
    config.url,
    config.publishableKey,
    {
      db: { schema: "api", retry: false },
      accessToken: async () => accessToken,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (request, init) =>
          fetcher(request, { ...init, credentials: "omit", cache: "no-store", redirect: "error" }),
      },
    }
  );
  return Object.freeze({ rpc: client.rpc.bind(client) });
}
