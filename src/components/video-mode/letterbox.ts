/** Room the title, price and Details need under a video before they leave the picture. */
const CAPTION_ROOM_PX = 150;

/**
 * Where the title and price go when a video does not fill the screen (a
 * landscape or shorter video with black space under it): just below the
 * picture, in px from the top. Null when the video fills the screen or its size
 * is not known yet; the title then sits at the bottom, over the video.
 */
export function captionTop(
  stageWidth: number,
  stageHeight: number,
  videoWidth: number,
  videoHeight: number
): number | null {
  if (!(stageWidth > 0 && stageHeight > 0 && videoWidth > 0 && videoHeight > 0)) return null;
  const shown = videoHeight * Math.min(stageWidth / videoWidth, stageHeight / videoHeight);
  const below = (stageHeight - shown) / 2;
  return below >= CAPTION_ROOM_PX ? Math.round((stageHeight + shown) / 2 + 12) : null;
}
