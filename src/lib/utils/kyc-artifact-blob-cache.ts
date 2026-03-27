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
  pruneExpiredEntries();
  artifactBlobCache.set(artifactId, {
    blob,
    cachedAt: Date.now(),
  });
  enforceMaxEntries();
}
