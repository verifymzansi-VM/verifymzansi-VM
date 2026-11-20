/**
 * Checks on an ID photo or selfie that the verification page says it took
 * with the camera. The page draws the camera frame onto a canvas and saves it
 * as a JPEG, which carries no EXIF block; a gallery photo or a camera app's
 * file usually does.
 *
 * Honestly: none of this proves the picture came from a live camera. A
 * modified browser, a script or a virtual camera can send any image that
 * passes. These checks only refuse what our page never sends; staff still
 * review every photo.
 */

/** The ID photo's long edge must be at least this many pixels to be readable. */
export const MIN_ID_LONG_EDGE = 1000;

export type CameraPhotoProblem = "not_jpeg" | "has_exif" | "too_small" | "unreadable";

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** Width and height from a JPEG's frame header, and whether it has an EXIF block. */
export function readJpegFacts(
  bytes: Uint8Array
): { width: number; height: number; exif: boolean } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let offset = 2;
  let exif = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // Fill bytes before a marker.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Markers without a length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    const start = offset + 4;
    if (
      marker === 0xe1 &&
      length >= 8 &&
      bytes[start] === 0x45 && // E
      bytes[start + 1] === 0x78 && // x
      bytes[start + 2] === 0x69 && // i
      bytes[start + 3] === 0x66 && // f
      bytes[start + 4] === 0 &&
      bytes[start + 5] === 0
    )
      exif = true;
    if (SOF_MARKERS.has(marker)) {
      if (length < 7) return null;
      const height = (bytes[start + 1] << 8) | bytes[start + 2];
      const width = (bytes[start + 3] << 8) | bytes[start + 4];
      if (!width || !height) return null;
      return { width, height, exif };
    }
    // Start of scan: no frame header was found before the image data.
    if (marker === 0xda) return null;
    offset += 2 + length;
  }
  return null;
}

/** Why a photo the page says it took with the camera is refused, or null. */
export function cameraPhotoProblem(
  bytes: Uint8Array,
  purpose: "id_front" | "selfie"
): CameraPhotoProblem | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    return "not_jpeg";
  const facts = readJpegFacts(bytes);
  if (!facts) return "unreadable";
  if (facts.exif) return "has_exif";
  if (purpose === "id_front" && Math.max(facts.width, facts.height) < MIN_ID_LONG_EDGE)
    return "too_small";
  return null;
}

/** What the member is told for each refusal. */
export const CAMERA_PHOTO_MESSAGES: Record<CameraPhotoProblem | "camera_required", string> = {
  camera_required:
    "Take the photo with your camera on this page. Photos from your gallery or files can't be used.",
  not_jpeg:
    "Take the photo with your camera on this page. Photos from your gallery or files can't be used.",
  has_exif:
    "Take the photo with your camera on this page. Photos from your gallery or files can't be used.",
  unreadable: "We couldn't read that photo. Please take it again.",
  too_small:
    "This camera's picture is too small to read your ID. Continue on your phone to take a sharper photo.",
};
