import { MAX_EVENT_VIDEO_SECONDS, MAX_VIDEO_SECONDS } from "@/lib/media/video-length";
import { MAX_VIDEO_ORIGINAL_BYTES } from "@/lib/media/upload-policy";

/** Photo size limit the uploader checks (src/components/ui/media-upload.tsx). */
const PHOTO_LIMIT_MB = 5;

/** The media limits in one line, e.g. "Photos up to 5 MB · Video up to 2 min, up to 300 MB". */
export function mediaLimitsText(kind: "event" | "other"): string {
  const minutes = (kind === "event" ? MAX_EVENT_VIDEO_SECONDS : MAX_VIDEO_SECONDS) / 60;
  const videoMb = Math.round(MAX_VIDEO_ORIGINAL_BYTES / (1024 * 1024));
  return `Photos up to ${PHOTO_LIMIT_MB} MB · Video up to ${minutes} min, up to ${videoMb} MB`;
}

/** The one media-limits line every posting form shows next to its upload button. */
export function MediaLimitsLine({ kind = "other" }: { kind?: "event" | "other" }) {
  return (
    <p className="text-xs font-medium text-muted-foreground" data-media-limits>
      {mediaLimitsText(kind)}
    </p>
  );
}
