import { getDataBackend } from "../data-backend";
type CacheEntry = {
  blob: Blob;
  cachedAt: number;
};

const MAX_ENTRIES = 30;
const TTL_MS = 10 * 60 * 1000;

const artifactBlobCache = new Map<string, CacheEntry>();

function isExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.cachedAt > TTL_MS;
}

function pruneExpiredEntries(): void {
  for (const [artifactId, entry] of artifactBlobCache.entries()) {
    if (isExpired(entry)) {
      artifactBlobCache.delete(artifactId);
    }
  }
}

function enforceMaxEntries(): void {
  if (artifactBlobCache.size <= MAX_ENTRIES) {
    return;
  }

  const entries = Array.from(artifactBlobCache.entries()).sort(
    (a, b) => a[1].cachedAt - b[1].cachedAt
  );

  const overflow = artifactBlobCache.size - MAX_ENTRIES;
  for (let i = 0; i < overflow; i += 1) {
    const key = entries[i]?.[0];
    if (key) {
      artifactBlobCache.delete(key);
    }
  }
}

export function getCachedKycArtifactBlob(artifactId: string): Blob | null {
  // Native reads require the currently represented claim and account. A shared
  // artifact-only cache cannot establish either boundary after auth changes.
  if (getDataBackend() === "foundation") {
    artifactBlobCache.clear();
    return null;
  }
  const entry = artifactBlobCache.get(artifactId);
  if (!entry) {
    return null;
  }

  if (isExpired(entry)) {
    artifactBlobCache.delete(artifactId);
    return null;
  }

  return entry.blob;
}

export function setCachedKycArtifactBlob(artifactId: string, blob: Blob): void {
  if (getDataBackend() === "foundation") {
    artifactBlobCache.clear();
    return;
  }
  pruneExpiredEntries();
  artifactBlobCache.set(artifactId, {
    blob,
    cachedAt: Date.now(),
  });
  enforceMaxEntries();
}

export function clearCachedKycArtifactBlobs(): void {
  artifactBlobCache.clear();
}
