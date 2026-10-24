import { createBrowserClient } from "@supabase/ssr";
import type { FoundationAuthenticatedDatabase } from "../../../database/foundation/api-role-types";
import { getPublicRuntimeConfig } from "../public-runtime-config";
import { parseFoundationConnection } from "./connection";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";

function browserConnection() {
  const values = getPublicRuntimeConfig();
  const url = new URL(values.supabaseUrl);
  const local = url.hostname === "127.0.0.1";
  const connection = parseFoundationConnection({
    url: values.supabaseUrl,
    expectedProjectRef: local ? "local-foundation" : "gntzjtuncsyefujajmjy",
    publishableKey: values.supabaseAnonKey,
  });
  if (local && process.env.NODE_ENV === "production") {
    const app = new URL(values.appUrl);
    if (
      app.protocol !== "http:" ||
      app.hostname !== "127.0.0.1" ||
      (typeof window !== "undefined" && window.location.hostname !== "127.0.0.1")
    )
      throw new Error("Local foundation clients require an isolated local app");
  }
  return connection;
}

let cached: { key: string; client: ReturnType<typeof makeClient> } | undefined;
function makeClient(connection: ReturnType<typeof browserConnection>) {
  const fetcher = createTimeoutFetch();
  return createBrowserClient<FoundationAuthenticatedDatabase, "api">(
    connection.url,
    connection.publishableKey,
    {
      // The SSR package also has a singleton; never borrow a legacy project's client.
      isSingleton: false,
      cookieOptions: { secure: connection.url.startsWith("https://") },
      db: { schema: "api", retry: false },
      auth: { detectSessionInUrl: false, experimental: { appendPkceFlowIdToRedirects: true } },
      global: {
        fetch: (url, init) =>
          fetcher(url, { ...init, credentials: "omit", cache: "no-store", redirect: "error" }),
      },
    }
  );
}

export function getFoundationBrowserClient() {
  const connection = browserConnection();
  // A server render must never retain request Auth state in a module singleton.
  if (typeof window === "undefined") return makeClient(connection);
  const key = connection.url + "|" + connection.publishableKey;
  if (cached?.key !== key) {
    if (cached) void Promise.resolve(cached.client.auth.stopAutoRefresh()).catch(() => {});
    cached = { key, client: makeClient(connection) };
  }
  return cached.client;
}
