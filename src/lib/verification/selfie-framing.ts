/** Match the centred, cropped preview and the 300x400 oval at 80% of its viewport. */
export function assessSelfieFraming(
  points: Array<{ x: number; y: number }>,
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number
) {
  if (!points.length || !sourceWidth || !sourceHeight || !viewportWidth || !viewportHeight)
    return { faceOk: false, instruction: "Keep the camera active to continue." };
  const scale = Math.max(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  const offsetX = (sourceWidth * scale - viewportWidth) / 2;
  const offsetY = (sourceHeight * scale - viewportHeight) / 2;
  const xs = points.map((p) => p.x * sourceWidth * scale - offsetX);
  const ys = points.map((p) => p.y * sourceHeight * scale - offsetY);
  const left = Math.min(...xs),
    right = Math.max(...xs);
  const top = Math.min(...ys),
    bottom = Math.max(...ys);
  const guideScale = Math.min((viewportWidth * 0.8) / 300, (viewportHeight * 0.8) / 400);
  const guideWidth = 294 * guideScale,
    guideHeight = 394 * guideScale;
  if (right - left > guideWidth || bottom - top > guideHeight)
    return { faceOk: false, instruction: "Move a little further away to fit your whole face." };
  if (right - left < guideWidth * 0.45 || bottom - top < guideHeight * 0.45)
    return { faceOk: false, instruction: "Move a little closer to fill the oval." };
  if (
    Math.abs((left + right) / 2 - viewportWidth / 2) > guideWidth * 0.15 ||
    Math.abs((top + bottom) / 2 - viewportHeight / 2) > guideHeight * 0.15 ||
    left < 0 ||
    top < 0 ||
    right > viewportWidth ||
    bottom > viewportHeight ||
    points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x <= 0.02 ||
        p.x >= 0.98 ||
        p.y <= 0.02 ||
        p.y >= 0.98
    )
  )
    return { faceOk: false, instruction: "Centre your whole face inside the oval." };
  return { faceOk: true, instruction: "" };
}
