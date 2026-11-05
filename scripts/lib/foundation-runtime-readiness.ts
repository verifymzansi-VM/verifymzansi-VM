import { readFile } from "node:fs/promises";
import {
  verifyFoundationDeploymentConnection,
  verifyFoundationArtifactIntegrity,
  verifyFoundationReleaseArtifact,
} from "./foundation-deployment";
import { verifyRoleOpenapi } from "./foundation-api-openapi.mjs";
import {
  verifyFoundationRuntimeApi,
  provisionedFoundationApiManifest,
} from "./foundation-runtime-api.mjs";
import { verifyFoundationGateway } from "../../src/lib/foundation/gateway-readiness";
import { createFoundationPublicApi } from "../../src/lib/foundation/public-api";
import { searchFoundationPresentedCards } from "../../src/lib/foundation/public-cards";
/** Read-only validation of the configured native gateway and complete role API
 * contracts. Runtime-only checks do not approve a fresh baseline or a release. */
export async function verifyFoundationRuntime(
  environment: Readonly<Record<string, string | undefined>>,
  runtimeOnly: boolean
) {
  const connection = verifyFoundationDeploymentConnection(environment);
  const [assembly, candidate, api] = await Promise.all([
    readFile("database/foundation/assembly.json", "utf8"),
    readFile("database/foundation/candidate.sql", "utf8"),
    readFile("database/foundation/api-manifest.json", "utf8"),
  ]);
  const manifest = JSON.parse(assembly);
  if (runtimeOnly) verifyFoundationArtifactIntegrity(manifest, candidate);
  else verifyFoundationReleaseArtifact(manifest, candidate);
  const apiManifest = JSON.parse(api);
  if (apiManifest.candidateHash !== manifest.candidateHash)
    throw new Error("Foundation API contract is stale");
  const { serviceOpenapi } = await verifyFoundationGateway(environment);
  verifyRoleOpenapi(
    serviceOpenapi,
    runtimeOnly ? provisionedFoundationApiManifest(apiManifest) : apiManifest,
    "service_role"
  );
  await verifyFoundationRuntimeApi(connection);
  const publicApi = createFoundationPublicApi(connection);
  await searchFoundationPresentedCards(publicApi, {
    area: "tourism_events",
    category: "events",
    event_state: "active",
    offset: 0,
    limit: 1,
  });
  await searchFoundationPresentedCards(publicApi, {
    area: "business",
    business_type: "standalone_shop",
    offset: 0,
    limit: 1,
  });
}
