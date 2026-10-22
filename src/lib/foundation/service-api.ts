import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { FoundationServiceDatabase } from "../../../database/foundation/api-role-types";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { foundationRpcClientOptions } from "./public-api";

export type FoundationServiceApi = Pick<SupabaseClient<FoundationServiceDatabase, "api">, "rpc">;
const secretKey = z.string().regex(/^sb_secret_[A-Za-z0-9_-]+$/);

/** Trusted server commands only (for example an enquiry after Turnstile and
 * rate limits). The secret key bypasses no SQL checks: service functions
 * still validate every input, and only service-granted RPCs are typed here.
 * Never import from client components; never reuse across requests. */
export function createFoundationServiceApi(
  environment = process.env,
  fetcher: typeof fetch = createTimeoutFetch()
): FoundationServiceApi {
  const connection = readFoundationRuntimeConnection(environment);
  const key = secretKey.safeParse(environment.FOUNDATION_SUPABASE_SECRET_KEY);
  if (!key.success) throw new Error("Foundation service binding is unavailable");
  const client = createClient<FoundationServiceDatabase, "api">(
    connection.url,
    key.data,
    foundationRpcClientOptions(fetcher)
  );
  return Object.freeze({ rpc: client.rpc.bind(client) });
}
