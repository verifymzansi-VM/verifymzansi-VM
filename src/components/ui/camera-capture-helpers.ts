/**
 * Pure helpers for the verification camera: how a camera error is shown, the
 * in-app browser check, the live quality hints and the photo size. Kept apart
 * from the component so they can be tested without a camera.
 */

/** What the member is shown when the camera cannot start. */
export type CameraProblem = "blocked" | "none" | "busy" | "failed";

/**
 * - blocked: the browser or the member refused the camera (per-browser steps);
 * - none: no camera, or no camera API here (continue on a phone);
 * - busy: another app holds the camera, or it took too long to start;
 * - failed: anything else.
 * OverconstrainedError never reaches this: the component first retries with
 * plainer settings, silently.
 */
export function cameraProblem(errorName: string): CameraProblem {
  switch (errorName) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "blocked";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "MediaDevicesUnavailable":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "none";
    case "NotReadableError":
    case "TrackStartError":
    case "TimeoutError":
      return "busy";
    default:
      return "failed";
  }
}

/** Errors worth one more try with plainer camera settings. */
export function shouldRetryWithPlainerSettings(errorName: string): boolean {
  return [
    "OverconstrainedError",
    "ConstraintNotSatisfiedError",
    "NotFoundError",
    "DevicesNotFoundError",
  ].includes(errorName);
}

/** WhatsApp, Facebook, Instagram and similar in-app browsers often block cameras. */
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|TikTok|musical_ly|; wv\)/i.test(
    userAgent
  );
}

export function isPhoneOrTablet(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

export type FrameQuality = {
  /** Average brightness, 0 to 255. */
  brightness: number;
  /** Share of nearly white pixels, 0 to 1. */
  glare: number;
  /** Average difference between neighbouring pixels: higher is sharper. */
  sharpness: number;
};

/** Brightness, glare and sharpness of an RGBA frame (a small sample is enough). */
export function analyseFrame(rgba: ArrayLike<number>, width: number, height: number): FrameQuality {
  const count = width * height;
  if (!count) return { brightness: 0, glare: 0, sharpness: 0 };
  const luma = new Float32Array(count);
  let sum = 0;
  let blown = 0;
  for (let i = 0; i < count; i += 1) {
    const value = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    luma[i] = value;
    sum += value;
    if (value >= 250) blown += 1;
  }
  let edges = 0;
  let pairs = 0;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x + 1 < width; x += 1) {
      edges += Math.abs(luma[y * width + x + 1] - luma[y * width + x]);
      pairs += 1;
    }
  for (let y = 0; y + 1 < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      edges += Math.abs(luma[(y + 1) * width + x] - luma[y * width + x]);
      pairs += 1;
    }
  return { brightness: sum / count, glare: blown / count, sharpness: pairs ? edges / pairs : 0 };
}

export const QUALITY_LIMITS = { dark: 60, glare: 0.04, blurry: 4 } as const;

/** One short live hint, or null when the frame looks fine. Hints never block a photo. */
export function qualityHint(quality: FrameQuality): string | null {
  if (quality.brightness < QUALITY_LIMITS.dark) return "Too dark: move to better light";
  if (quality.glare > QUALITY_LIMITS.glare) return "Too much glare: tilt the card a little";
  if (quality.sharpness < QUALITY_LIMITS.blurry) return "Hold still";
  return null;
}

/** The size a photo is saved at: the long edge at most `maxEdge`, never enlarged. */
export function scaledSize(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Long edge of the saved ID photo and selfie, and the JPEG quality. */
export const PHOTO_LIMITS = { idLongEdge: 2000, selfieLongEdge: 1280, jpegQuality: 0.85 } as const;
