import { DEFAULT_SHARE_IMAGE_PNG_BASE64 } from "@/lib/sharing/default-share-image-png";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

const png = Buffer.from(DEFAULT_SHARE_IMAGE_PNG_BASE64, "base64");

// The picture never changes, so it is drawn ahead of time from
// src/lib/sharing/default-share-image.tsx with the renderer this route used
// (pnpm share-image:default) and served as stored. The main Worker no longer
// carries the image renderer (M9.9).
export default function OpenGraphImage() {
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, immutable, no-transform, max-age=31536000",
    },
  });
}
