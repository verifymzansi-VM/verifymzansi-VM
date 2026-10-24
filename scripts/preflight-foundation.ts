import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import {
  verifyFoundationDeploymentConnection,
  verifyFoundationReleaseArtifact,
  FoundationReleasePending,
} from "./lib/foundation-deployment";
import { verifyRoleOpenapi } from "./lib/foundation-api-openapi.mjs";
import { createTimeoutFetch } from "../src/lib/supabase/fetch-with-timeout";

loadEnvConfig(process.cwd());
async function main() {
  const connection = verifyFoundationDeploymentConnection(process.env);
  const [assembly, candidate, api] = await Promise.all([
    readFile("database/foundation/assembly.json", "utf8"),
    readFile("database/foundation/candidate.sql", "utf8"),
    readFile("database/foundation/api-manifest.json", "utf8"),
  ]);
  const manifest = JSON.parse(assembly);
  verifyFoundationReleaseArtifact(manifest, candidate);
  const apiManifest = JSON.parse(api);
  if (apiManifest.candidateHash !== manifest.candidateHash)
    throw new Error("Foundation API contract is stale");
  const fetcher = createTimeoutFetch();
  for (const [role, key] of [
    ["anon", connection.publishableKey],
    ["service_role", process.env.FOUNDATION_SUPABASE_SECRET_KEY!],
  ] as const) {
    const response = await fetcher(`${connection.url}/rest/v1/`, {
      headers: { apikey: key, Accept: "application/openapi+json", "Accept-Profile": "api" },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw new Error("Foundation API exposure or credential check failed");
    verifyRoleOpenapi(await response.json(), apiManifest, role);
  }
  for (const schema of ["public", "private", "internal", "graphql_public"]) {
    const response = await fetcher(`${connection.url}/rest/v1/`, {
      headers: { apikey: connection.publishableKey, "Accept-Profile": schema },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    const body = await response.json().catch(() => null);
    if (response.status !== 406 || body?.code !== "PGRST106")
      throw new Error("Only the foundation API schema may be exposed");
  }
  console.log(
    "Foundation connection and anonymous/service API contracts verified; this does not replace authenticated, provider or recovery acceptance."
  );
}
main().catch((error) => {
  if (error instanceof FoundationReleasePending) {
    console.error(
      "INCOMPLETE: foundation acceptance is still open. No legacy schema queries or deployment were attempted."
    );
    process.exitCode = 2;
  } else {
    console.error(
      "Foundation preflight failed: review approved connection, release artifact and API exposure. Credentials withheld."
    );
    process.exitCode = 1;
  }
});
