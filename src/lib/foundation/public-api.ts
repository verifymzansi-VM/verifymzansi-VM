import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseFoundationConnection } from "./connection";
import type { FoundationPublicDatabase } from "../../../database/foundation/api-role-types";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";

export type FoundationPublicApi = Pick<SupabaseClient<FoundationPublicDatabase, "api">, "rpc">;

/** Client options for keyed (publishable or secret) API RPC clients: api schema,
 * no retries, sessions, cookies, caching or redirects. */
export function foundationRpcClientOptions(fetcher: typeof fetch) {
  return {
    db: { schema: "api" as const, retry: false },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (request: Parameters<typeof fetch>[0], init?: RequestInit) =>
        fetcher(request, { ...init, credentials: "omit", cache: "no-store", redirect: "error" }),
    },
  };
}

/** A separate foundation connection: legacy factories stay on their source schema.
 * Explicit identity prevents accidentally pointing new adapters at Mumbai or a
 * benchmark project. No cookies, session persistence or ambient env credentials.
 * The returned surface has only API RPCs; no table, Auth or schema escape hatch.
 */
export function createFoundationPublicApi(
  input: unknown,
  fetcher: typeof fetch = createTimeoutFetch()
): FoundationPublicApi {
  const config = parseFoundationConnection(input);
  const client = createClient<FoundationPublicDatabase, "api">(
    config.url,
    config.publishableKey,
    foundationRpcClientOptions(fetcher)
  );
  return Object.freeze({ rpc: client.rpc.bind(client) });
}
