// The link-preview card behind /api/share-preview. The website and the
// offload Worker (workers/offload.ts) both draw it from this one definition,
// so a preview looks the same wherever it is rendered.

/** Everything the card shows, already shortened and checked by the route. */
export type ShareCardInput = {
  title: string;
  section: string;
  price: string;
  location: string;
  hasVideo: boolean;
  /** An allowed public poster URL; never a .webp or .avif file. */
  poster?: string;
};

const MAX_TEXT = 500;
const MAX_URL = 2048;

const text = (value: unknown) =>
  typeof value === "string" && value.length <= MAX_TEXT ? value : null;

/** Checks a card request arriving from another Worker; null when malformed. */
export function parseShareCardInput(value: unknown): ShareCardInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const title = text(input.title);
  const section = text(input.section);
  const price = text(input.price);
  const location = text(input.location);
  if (title === null || section === null || price === null || location === null) return null;
  if (typeof input.hasVideo !== "boolean") return null;
  let poster: string | undefined;
  if (input.poster !== undefined) {
    if (typeof input.poster !== "string" || input.poster.length > MAX_URL) return null;
    let url: URL;
    try {
      url = new URL(input.poster);
    } catch {
      return null;
    }
    if (!["https:", "http:"].includes(url.protocol)) return null;
    poster = url.href;
  }
  return { title, section, price, location, hasVideo: input.hasVideo, poster };
}

function shareCard({ title, section, price, location, hasVideo }: ShareCardInput, image?: string) {
  return (
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
}

type ImageResponseClass = new (
  element: ReturnType<typeof shareCard>,
  options: { width: number; height: number }
) => Response;

/**
 * Draws the card as a 1200 x 630 PNG with the given renderer (`next/og` on
 * the website, its Workers build in the offload Worker).
 */
export async function renderShareCardPng(
  ImageResponse: ImageResponseClass,
  input: ShareCardInput
): Promise<ArrayBuffer> {
  // Some legacy poster formats cannot be decoded by the renderer. Keep a usable branded card.
  try {
    return await new ImageResponse(shareCard(input, input.poster), {
      width: 1200,
      height: 630,
    }).arrayBuffer();
  } catch {
    return await new ImageResponse(shareCard(input), { width: 1200, height: 630 }).arrayBuffer();
  }
}
