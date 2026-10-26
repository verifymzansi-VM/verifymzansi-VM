import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import {
  FoundationReleasePending,
  verifyFoundationDeploymentConnection,
  verifyFoundationReleaseArtifact,
} from "./lib/foundation-deployment";
import { verifyFoundationGateway } from "../src/lib/foundation/gateway-readiness";
import { verifyRoleOpenapi } from "./lib/foundation-api-openapi.mjs";

// An inactive upload permits hosted acceptance without declaring a release.
// This entry point never deploys or changes traffic. Production still uses
// preflight-foundation.ts and requires releaseReady=true.
loadEnvConfig(process.cwd());
async function main() {
  if (process.argv.length !== 2) throw new Error("Unsupported candidate argument");
  verifyFoundationDeploymentConnection(process.env);
  const [assembly, candidate, api] = await Promise.all([
    readFile("database/foundation/assembly.json", "utf8"),
    readFile("database/foundation/candidate.sql", "utf8"),
    readFile("database/foundation/api-manifest.json", "utf8"),
  ]);
  const manifest = JSON.parse(assembly);
  try {
    verifyFoundationReleaseArtifact(manifest, candidate);
  } catch (error) {
    if (!(error instanceof FoundationReleasePending)) throw error;
  }
  const apiManifest = JSON.parse(api);
  if (apiManifest.candidateHash !== manifest.candidateHash)
    throw new Error("Foundation API contract is stale");
  const { serviceOpenapi } = await verifyFoundationGateway(process.env);
  verifyRoleOpenapi(serviceOpenapi, apiManifest, "service_role");
  console.log(
    "Candidate connection, SQL digest, gateway and service API contract verified. Inactive upload only; production release acceptance remains separate."
  );
}
main().catch(() => {
  console.error("Candidate verification failed. Credentials withheld; no deployment attempted.");
  process.exitCode = 1;
});
