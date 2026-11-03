import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import {
  verifyFoundationDeploymentConnection,
  verifyFoundationReleaseArtifact,
  FoundationReleasePending,
  verifyFoundationArtifactIntegrity,
} from "./lib/foundation-deployment";
import { verifyRoleOpenapi } from "./lib/foundation-api-openapi.mjs";
import { verifyFoundationGateway } from "../src/lib/foundation/gateway-readiness";
import { createFoundationPublicApi } from "../src/lib/foundation/public-api";
import { searchFoundationPresentedCards } from "../src/lib/foundation/public-cards";

loadEnvConfig(process.cwd());
async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.length > 1 || (args.length === 1 && args[0] !== "--provisioned-runtime"))
    throw new Error("Unsupported foundation preflight argument");
  const runtimeOnly = args[0] === "--provisioned-runtime";
  const connection = verifyFoundationDeploymentConnection(process.env);
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
  const { serviceOpenapi } = await verifyFoundationGateway(process.env);
  verifyRoleOpenapi(serviceOpenapi, apiManifest, "service_role");
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
  console.log(
    runtimeOnly
      ? "Provisioned London application runtime verified: SQL digest, public read, service API contract and schema isolation. No database migration was executed; clean baseline acceptance remains separate."
      : "Foundation public read, service API contract and schema isolation verified; authenticated grants, provider and recovery acceptance remain separate checks."
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
