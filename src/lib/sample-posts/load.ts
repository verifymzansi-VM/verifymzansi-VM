import "server-only";
import type { CarouselItem } from "@/components/showrooms/carousel-item-transforms";
import { createLogger } from "@/lib/utils/logger";
import {
  APPROVED_SAMPLE_POSTS,
  samplePostsEnabled,
  validateSamplePost,
  type SamplePostEntry,
  type SamplePostSource,
} from "./catalogue";

const log = createLogger("SamplePosts");

/** Local preview media live here (git-ignored, development only). */
const LOCAL_SAMPLE_MEDIA_PATH = "/sample-posts-local";
const LOCAL_CATALOGUE_FILE = "src/lib/sample-posts/catalogue.local.json";

export interface ResolvedSamplePost extends SamplePostEntry {
  source: SamplePostSource;
  videoUrl: string;
  posterUrl: string;
}

type ShowroomSurface = "home" | "business" | "market" | "tourism";

function mediaBase() {
  return (process.env.NEXT_PUBLIC_MEDIA_URL || "https://media.verifymzansi.com").replace(/\/$/, "");
}

function mediaUrl(key: string, source: SamplePostSource) {
  return source === "local"
    ? `${LOCAL_SAMPLE_MEDIA_PATH}/${encodeURIComponent(key)}`
    : `${mediaBase()}/${key}`;
}

/**
 * The git-ignored preview file, read only by the development server. The
 * branch is removed from production builds (NODE_ENV is inlined), so nothing
 * local can ever reach the live site.
 */
async function readLocalEntries(): Promise<unknown[]> {
  if (process.env.NODE_ENV === "development") {
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const parsed: unknown = JSON.parse(
        await readFile(join(process.cwd(), LOCAL_CATALOGUE_FILE), "utf8")
      );
      if (Array.isArray(parsed)) return parsed;
      log.warn("catalogue.local.json must contain a JSON array; ignoring it");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        log.warn("catalogue.local.json could not be read; ignoring it", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }
  return [];
}

/** Validates and resolves entries; invalid or duplicate entries are skipped. */
export function resolveSamplePosts(
  sources: { source: SamplePostSource; entries: readonly unknown[] }[]
): ResolvedSamplePost[] {
  const seen = new Set<string>();
  const resolved: ResolvedSamplePost[] = [];
  for (const { source, entries } of sources) {
    entries.forEach((value, index) => {
      const result = validateSamplePost(value, source);
      if (!result.ok) {
        log.warn("Skipping invalid sample post", { source, index, errors: result.errors });
        return;
      }
      if (seen.has(result.entry.slug)) {
        log.warn("Skipping duplicate sample post slug", { source, slug: result.entry.slug });
        return;
      }
      seen.add(result.entry.slug);
      resolved.push({
        ...result.entry,
        source,
        videoUrl: mediaUrl(result.entry.videoKey, source),
        posterUrl: mediaUrl(result.entry.posterKey, source),
      });
    });
  }
  return resolved;
}

/** Every sample that may be shown now; empty while the switch is off. */
export async function listSamplePosts(): Promise<ResolvedSamplePost[]> {
  if (!samplePostsEnabled()) return [];
  return resolveSamplePosts([
    { source: "committed", entries: APPROVED_SAMPLE_POSTS },
    { source: "local", entries: await readLocalEntries() },
  ]);
}

export async function findSamplePost(slug: string): Promise<ResolvedSamplePost | null> {
  return (await listSamplePosts()).find((post) => post.slug === slug) ?? null;
}

/** Which showrooms a sample belongs in, mirroring where real posts appear. */
function sampleMatchesSurface(post: SamplePostEntry, surface: ShowroomSurface): boolean {
  switch (surface) {
    case "home":
      return true;
    case "market":
      return post.area === "market";
    case "business":
      return post.area === "business";
    case "tourism":
      return (
        post.area === "event" ||
        (post.area === "business" && post.category === "tourism_hospitality")
      );
  }
}

function sampleToCarouselItem(post: ResolvedSamplePost): CarouselItem {
  return {
    id: `sample-${post.slug}`,
    type: post.area === "market" ? "listing" : post.area === "event" ? "promotion" : "business",
    href: `/sample/${post.slug}`,
    title: post.title,
    description: post.description,
    location: post.city,
    mediaUrl: post.videoUrl,
    posterUrl: post.posterUrl,
    price: null,
    sample: true,
  };
}

/** Sample cards for one showroom, in catalogue order. */
export async function loadSampleCarouselItems(surface: ShowroomSurface): Promise<CarouselItem[]> {
  return (await listSamplePosts())
    .filter((post) => sampleMatchesSurface(post, surface))
    .map(sampleToCarouselItem);
}
