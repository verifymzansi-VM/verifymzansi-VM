import { verifyFoundationDeploymentConnection } from "./deployment-connection";
import { parseFoundationPostingTerms } from "./posting-terms";
import { createTimeoutFetch } from "../supabase/fetch-with-timeout";

/** Read-only gateway checks. Never use a publishable key for the OpenAPI root:
 * hosted Supabase restricts that endpoint to secret keys. Anonymous readiness
 * must execute an actual public read instead. No sessions or user rows are read. */
export async function verifyFoundationGateway(
  environment: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch = createTimeoutFetch()
) {
  const connection = verifyFoundationDeploymentConnection(environment);
  const request = async (path: string, key: string, schema: string) => {
    const response = await fetcher(`${connection.url}/rest/v1/${path}`, {
      headers: {
        apikey: key,
        Accept: path ? "application/json" : "application/openapi+json",
        "Accept-Profile": schema,
      },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    // Keep provider bodies, keys, and returned data out of error messages.
    const body: unknown = await response.json().catch(() => null);
    return { response, body };
  };
  const secret = environment.FOUNDATION_SUPABASE_SECRET_KEY!;
  const [publicRead, service, ...hidden] = await Promise.all([
    request("rpc/get_current_posting_terms", connection.publishableKey, "api"),
    request("", secret, "api"),
    ...["public", "private", "internal", "graphql_public"].map((schema) =>
      request("rpc/get_current_posting_terms", secret, schema)
    ),
  ]);
  if (!publicRead.response.ok || !parseFoundationPostingTerms(publicRead.body))
    throw new Error("Foundation public API read or publishable credential check failed");
  if (!service.response.ok || !service.body || typeof service.body !== "object")
    throw new Error("Foundation service API exposure or credential check failed");
  const spec = service.body as { swagger?: unknown; paths?: unknown; definitions?: unknown };
  if (
    spec.swagger !== "2.0" ||
    !spec.paths ||
    typeof spec.paths !== "object" ||
    Array.isArray(spec.paths) ||
    !Object.keys(spec.paths).some((path) => path.startsWith("/rpc/")) ||
    Object.keys(spec.paths).some((path) => path !== "/" && !path.startsWith("/rpc/")) ||
    Object.keys(spec.definitions ?? {}).length !== 0
  )
    throw new Error("Foundation service API must expose functions only");
  for (const { response, body } of hidden) {
    if (
      response.status !== 406 ||
      !body ||
      typeof body !== "object" ||
      !("code" in body) ||
      body.code !== "PGRST106"
    )
      throw new Error("Only the foundation API schema may be exposed");
  }
  return { serviceOpenapi: service.body };
}
