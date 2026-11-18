import "server-only";
import { z } from "zod";
import type { FoundationPublicApi } from "@/lib/foundation/public-api";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import { isSampleSlug } from "./catalogue";

/**
 * The samples staff removed (api.get_hidden_sample_posts, slugs only). Every
 * caller fails closed: when the list cannot be read, no sample is shown.
 */
const hiddenResponse = z.strictObject({
  slugs: z.array(z.string().refine(isSampleSlug)).max(500),
});

const READ_TIMEOUT_MS = 1_500;
/** A successful read is kept this long per server instance. */
const HIDDEN_TTL_MS = 30_000;

let remembered: { slugs: ReadonlySet<string>; until: number } | null = null;
let pending: Promise<ReadonlySet<string>> | null = null;

/** Reads the hide-list now; throws when it cannot be read or is malformed. */
export async function readHiddenSampleSlugs(
  api: FoundationPublicApi = foundationServerPublicApi()
): Promise<ReadonlySet<string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const response = await Promise.race([
    api.rpc("get_hidden_sample_posts", {}, { get: false }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Hidden samples read timed out")), READ_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  if (response.error) throw new Error("Hidden samples unavailable");
  return new Set(hiddenResponse.parse(response.data).slugs);
}

/**
 * The hide-list, kept for 30 seconds per server instance (one read at a time).
 * Throws when it cannot be read: callers then show no sample at all.
 */
export async function loadHiddenSampleSlugs(
  read: () => Promise<ReadonlySet<string>> = () => readHiddenSampleSlugs(),
  now: () => number = Date.now
): Promise<ReadonlySet<string>> {
  if (remembered && remembered.until > now()) return remembered.slugs;
  if (!pending) {
    pending = read()
      .then((slugs) => {
        remembered = { slugs, until: now() + HIDDEN_TTL_MS };
        return slugs;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Forget the kept hide-list (after staff change it on this instance, and in tests). */
export function forgetHiddenSampleSlugs() {
  remembered = null;
}
