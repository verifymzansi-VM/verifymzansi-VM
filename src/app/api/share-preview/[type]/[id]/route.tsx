import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { formatZARShort } from "@/lib/utils/format";
import { uuidSchema } from "@/lib/validations/shared";

const SOURCES = {
  listing: {
    table: "listings",
    columns:
      "id, title, description, photos, videos, video_thumbnail, price_cents, location_city, location_province",
    label: "Mzansi Market",
  },
  business: {
    table: "businesses",
    columns:
      "id, business_name, description, area, category, cover_photo, cover_video, video_thumbnail, location_city, location_province",
    label: "Mzansi Business",
  },
  promotion: {
    table: "promotions",
    columns:
      "id, title, description, photos, videos, video_thumbnail, price_cents, start_date, location_city, location_province",
    label: "Tourism & Events",
  },
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const { type, id } = await params;
  if (!Object.hasOwn(SOURCES, type) || !uuidSchema.safeParse(id).success)
    return new Response("Not found", { status: 404 });
  const source = SOURCES[type as keyof typeof SOURCES];
  const client = await createClient();
  const { data, error } = await applyVisibleExpiryFilter(
    client.from(source.table).select(source.columns).eq("id", id).eq("status", "live")
  ).maybeSingle();
  if (error || !data)
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const post = data as unknown as Record<string, unknown>;
  const title = String(post.title || post.business_name || source.label).slice(0, 110);
  const location = [post.location_city, post.location_province].filter(Boolean).join(", ");
  const hasVideo = Boolean(post.cover_video || (Array.isArray(post.videos) && post.videos.length));
  const photo =
    post.video_thumbnail ||
    post.cover_photo ||
    (Array.isArray(post.photos) ? post.photos[0] : null);
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
  const section =
    post.area === "PROMOTIONS_EVENTS" || post.category === "tourism_hospitality"
      ? "Tourism & Events"
      : source.label;
  const price =
    typeof post.price_cents === "number" && post.price_cents > 0
      ? formatZARShort(post.price_cents)
      : "";
  const card = (image?: string) => (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: 1200,
        height: 630,
        background: "#032820",
        color: "#fffef9",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          left: 0,
          top: 0,
          width: 624,
          height: 630,
          boxSizing: "border-box",
          padding: "48px",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 27, fontWeight: 700 }}>VerifyMzansi</div>
          <div style={{ fontSize: 20, color: "#b9cbc5", marginTop: 12 }}>{section}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: title.length > 65 ? 36 : 44, fontWeight: 700, lineHeight: 1.15 }}>
            {title}
          </div>
          {price ? (
            <div style={{ fontSize: 32, color: "#ffc64c", marginTop: 18 }}>{price}</div>
          ) : null}
          {location ? (
            <div style={{ fontSize: 23, color: "#b9cbc5", marginTop: 18 }}>{location}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", fontSize: 21, color: "#ffc64c" }}>
          {hasVideo ? "Watch video & view full profile" : "View photos & full profile"}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 624,
          top: 0,
          display: "flex",
          width: 576,
          height: 630,
          alignItems: "center",
          justifyContent: "center",
          background: "#12483b",
        }}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- ImageResponse requires native img elements.
          <img
            src={image}
            alt=""
            width={576}
            height={630}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 576,
              height: 630,
              objectFit: "cover",
            }}
          />
        ) : !hasVideo ? (
          <div style={{ display: "flex", fontSize: 48, color: "#b9cbc5" }}>VerifyMzansi</div>
        ) : null}
        {hasVideo ? (
          <div
            style={{
              position: "absolute",
              left: 240,
              top: 267,
              display: "flex",
              width: 96,
              height: 96,
              borderRadius: 48,
              background: "#fffef9",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="44" height="44" viewBox="0 0 44 44">
              <path d="M12 7 L36 22 L12 37 Z" fill="#032820" />
            </svg>
          </div>
        ) : null}
        {hasVideo && !image ? (
          <div
            style={{
              position: "absolute",
              top: 395,
              display: "flex",
              fontSize: 22,
              color: "#b9cbc5",
            }}
          >
            Watch the video on VerifyMzansi
          </div>
        ) : null}
      </div>
    </div>
  );
  // Some legacy poster formats cannot be decoded by the renderer. Keep a usable branded card.
  let bytes: ArrayBuffer;
  try {
    bytes = await new ImageResponse(card(poster), { width: 1200, height: 630 }).arrayBuffer();
  } catch {
    bytes = await new ImageResponse(card(), { width: 1200, height: 630 }).arrayBuffer();
  }
  return new Response(bytes, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
}
