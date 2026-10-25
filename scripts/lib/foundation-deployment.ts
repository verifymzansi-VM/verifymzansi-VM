import { createHash } from "node:crypto";
export { verifyFoundationDeploymentConnection } from "../../src/lib/foundation/deployment-connection";

export class FoundationReleasePending extends Error {
  constructor() {
    super("Foundation acceptance is incomplete; deployment remains blocked");
  }
}

export function verifyFoundationReleaseArtifact(
  manifest: { schemaVersion?: unknown; candidateHash?: unknown; releaseReady?: unknown },
  candidate: string
) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.candidateHash !== createHash("sha256").update(candidate).digest("base64url")
  )
    throw new Error("Foundation release artifact is invalid");
  if (manifest.releaseReady !== true) throw new FoundationReleasePending();
}
