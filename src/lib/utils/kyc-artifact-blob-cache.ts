// Foundation evidence reads require the currently represented claim and
// account. A shared artifact-only cache cannot establish either boundary after
// auth changes, so evidence bytes are never cached between reads.

export function getCachedKycArtifactBlob(_artifactId: string): Blob | null {
  return null;
}

export function setCachedKycArtifactBlob(_artifactId: string, _blob: Blob): void {}

export function clearCachedKycArtifactBlobs(): void {}
