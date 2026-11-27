/** Height the title (at most 2 lines) and price take, with the gap above them. */
const CAPTION_PX = 88;
/** Space kept clear above Details (and Book or Tickets). */
const CLEARANCE_PX = 8;

/**
 * Where the title and price go when a video does not fill the screen (a
 * landscape or shorter video with black space under it): just below the
 * picture, in px from the top. `floor` is the top of the Details row (it
 * already counts the phone's bottom safe area), so the title never overlaps
 * Details or Book. Null when the black space is too small or the video's size
 * is not known yet; the title then sits at the bottom, over the video.
 */
export function captionTop(
  stageWidth: number,
  stageHeight: number,
  videoWidth: number,
  videoHeight: number,
  floor: number
): number | null {
  if (!(stageWidth > 0 && stageHeight > 0 && videoWidth > 0 && videoHeight > 0)) return null;
  const shown = videoHeight * Math.min(stageWidth / videoWidth, stageHeight / videoHeight);
  const pictureBottom = (stageHeight + shown) / 2;
  if (pictureBottom + CAPTION_PX + CLEARANCE_PX > floor) return null;
  return Math.round(pictureBottom + 12);
}
