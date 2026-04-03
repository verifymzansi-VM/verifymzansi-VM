import { useEffect } from "react";
import { useVideoMuteStore } from "@/stores/video-mute-store";

/**
 * Hook that bridges the global mute store with a `<video>` element.
 *
 * - Reads `isMuted` / `toggleMute` from the zustand persist store.
 * - Syncs `videoRef.current.muted` imperatively via useEffect so the HTML
 *   `muted` attribute can stay hardcoded (required for autoplay policy).
 *
 * Usage:
 * ```tsx
 * const { isMuted, toggleMute } = useGlobalMute(videoRef);
 * <video ref={videoRef} muted … />   // always render muted for autoplay
 * <MuteButton isMuted={isMuted} onToggle={toggleMute} />
 * ```
 */
export function useGlobalMute(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const isMuted = useVideoMuteStore((s) => s.isMuted);
  const toggleMute = useVideoMuteStore((s) => s.toggleMute);
  const setMuted = useVideoMuteStore((s) => s.setMuted);

  useEffect(() => {
    const el = videoRef.current;
    if (el) {
      el.muted = isMuted;
    }
  }, [isMuted, videoRef]);

  return { isMuted, toggleMute, setMuted } as const;
}
