import { restoredSharePreview } from "@/lib/foundation/marketplace-server";
import { OffloadUnavailableError, renderShareCard } from "@/lib/offload/client";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { formatZARShort } from "@/lib/utils/format";
import { uuidSchema } from "@/lib/validations/shared";
import { checkRateLimit, getClientRateLimitKey } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("SharePreview");

// The link types in shared URLs and the public post kind each one shows.
const SOURCES = {
  listing: { kind: "listing", label: "Mzansi Market" },
  business: { kind: "business", label: "Mzansi Business" },
  promotion: { kind: "event", label: "Tourism & Events" },
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const { type, id } = await params;
  if (!Object.hasOwn(SOURCES, type) || !uuidSchema.safeParse(id).success)
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const limit = await checkRateLimit({
    key: getClientRateLimitKey(request),
    action: "share-preview:render",
    degradedMode: "block",
  });
  if (limit.limited) {
    return new Response(limit.degraded ? "Preview temporarily unavailable" : "Too many requests", {
      status: limit.degraded ? 503 : 429,
      headers: { "Retry-After": String(limit.retryAfter ?? 60), "Cache-Control": "no-store" },
    });
  }
  const source = SOURCES[type as keyof typeof SOURCES];
  let post: Awaited<ReturnType<typeof restoredSharePreview>>;
  try {
    // Public reads only: a post that is not publicly live comes back as null.
    post = await restoredSharePreview(source.kind, id);
  } catch (error) {
    log.warn("Share preview post unavailable", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response("Preview temporarily unavailable", {
      status: 503,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
  }
  if (!post)
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const title = String(post.title || source.label).slice(0, 110);
  const location = [post.location_city, post.location_province].filter(Boolean).join(", ");
  const hasVideo = post.has_video;
  const photo = post.video_thumbnail;
  const origin = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";
  let poster: string | undefined;
  if (typeof photo === "string") {
    const url = new URL(normalizeMediaUrl(photo), origin);
    const publicHost = ["media.verifymzansi.com", "media-staging.verifymzansi.com"].includes(
      url.hostname
    );
    const publicPath =
      url.origin === new URL(origin).origin &&
      /^\/(api\/media\/serve\/|images\/|e2e-media\/)/.test(url.pathname);
    if (
      ["https:", "http:"].includes(url.protocol) &&
      (publicHost || publicPath) &&
      !/\.(webp|avif)$/i.test(url.pathname)
    )
      poster = url.href;
  }
  const section = post.tourism ? "Tourism & Events" : source.label;
  const price =
    typeof post.price_cents === "number" && post.price_cents > 0
      ? formatZARShort(post.price_cents)
      : "";
  let bytes: ArrayBuffer;
  try {
    bytes = await renderShareCard({ title, section, price, location, hasVideo, poster });
  } catch (error) {
    if (!(error instanceof OffloadUnavailableError)) throw error;
    log.warn("Share preview renderer unavailable", { error: error.message });
    return new Response("Preview temporarily unavailable", {
      status: 503,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
  }
  return new Response(bytes, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
}
