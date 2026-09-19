/** The actual camera image inside an uncropped, centred preview. */
export function getSelfiePreviewRect(
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number
) {
  if (
    ![sourceWidth, sourceHeight, viewportWidth, viewportHeight].every(
      (n) => Number.isFinite(n) && n > 0
    )
  )
    return null;
  const scale = Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  const width = sourceWidth * scale,
    height = sourceHeight * scale;
  return {
    width,
    height,
    left: (viewportWidth - width) / 2,
    top: (viewportHeight - height) / 2,
    scale,
  };
}

/** Match the oval inside the full camera image, including any letterboxing. */
export function assessSelfieFraming(
  points: Array<{ x: number; y: number }>,
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number
) {
  const preview = getSelfiePreviewRect(sourceWidth, sourceHeight, viewportWidth, viewportHeight);
  if (
    !points.length ||
    !preview ||
    points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    return { faceOk: false, trackingOk: false, instruction: "Keep your whole face in view." };
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const left = Math.min(...xs),
    right = Math.max(...xs);
  const top = Math.min(...ys),
    bottom = Math.max(...ys);
  // Tracking has a wider envelope than the still-photo guide. Turning changes
  // the face's bounding box and must not itself restart the completed blink.
  const trackingOk =
    left > 0.005 &&
    right < 0.995 &&
    top > 0.005 &&
    bottom < 0.995 &&
    right - left >= 0.08 &&
    bottom - top >= 0.12 &&
    Math.abs((left + right) / 2 - 0.5) < 0.35 &&
    Math.abs((top + bottom) / 2 - 0.5) < 0.35;
  if (left <= 0.005 || right >= 0.995 || top <= 0.005 || bottom >= 0.995)
    return { faceOk: false, trackingOk, instruction: "Bring your whole face back into view." };
  const guideScale = Math.min((preview.width * 0.8) / 300, (preview.height * 0.8) / 400);
  const guideWidth = 294 * guideScale,
    guideHeight = 394 * guideScale;
  const faceWidth = (right - left) * preview.width,
    faceHeight = (bottom - top) * preview.height;
  if (faceWidth > guideWidth || faceHeight > guideHeight)
    return {
      faceOk: false,
      trackingOk,
      instruction: "Move a little further away to fit your whole face.",
    };
  if (faceWidth < guideWidth * 0.4 || faceHeight < guideHeight * 0.45)
    return { faceOk: false, trackingOk, instruction: "Move a little closer to fill the oval." };
  if (!trackingOk)
    return { faceOk: false, trackingOk, instruction: "Bring your whole face back into view." };
  if (
    Math.abs((left + right) / 2 - 0.5) * preview.width > guideWidth * 0.2 ||
    Math.abs((top + bottom) / 2 - 0.5) * preview.height > guideHeight * 0.2
  )
    return { faceOk: false, trackingOk, instruction: "Centre your whole face inside the oval." };
  return { faceOk: true, trackingOk, instruction: "" };
}
