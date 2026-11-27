/**
 * A video-only post (item 84, part D): when the poster adds a video but no
 * photo, the cover frame they picked from the video becomes the first photo.
 * It uses one photo place, and the server's "at least one photo" rule is met
 * by a real uploaded image, so nothing changes on the server.
 */

/** Shown at the top of the media step where the photo-or-video rule applies. */
export const PHOTO_OR_VIDEO_RULE = "Add at least one photo or video.";

/** A video with no photo needs a cover image, which becomes the first photo. */
export const VIDEO_COVER_NEEDED = "Add a photo, or a cover image for the video.";

/**
 * The photo list to save: the photos as given, or the video's cover frame
 * alone when there are no photos but there is a video with a cover.
 */
export function photosWithVideoCover(
  photos: readonly string[],
  hasVideo: boolean,
  coverUrl: string | null | undefined
): string[] {
  const kept = photos.filter(Boolean);
  if (kept.length > 0 || !hasVideo || !coverUrl) return kept;
  return [coverUrl];
}
