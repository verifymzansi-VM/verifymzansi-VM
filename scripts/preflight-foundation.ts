import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import {
  verifyFoundationDeploymentConnection,
  verifyFoundationReleaseArtifact,
  FoundationReleasePending,
} from "./lib/foundation-deployment";
import { verifyRoleOpenapi } from "./lib/foundation-api-openapi.mjs";
import { verifyFoundationGateway } from "../src/lib/foundation/gateway-readiness";

loadEnvConfig(process.cwd());
async function main() {
  verifyFoundationDeploymentConnection(process.env);
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
  const { serviceOpenapi } = await verifyFoundationGateway(process.env);
  verifyRoleOpenapi(serviceOpenapi, apiManifest, "service_role");
  console.log(
    "Foundation public read, service API contract and schema isolation verified; authenticated grants, provider and recovery acceptance remain separate checks."
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
