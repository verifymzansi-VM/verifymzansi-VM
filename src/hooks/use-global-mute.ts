import { useEffect } from "react";
import { useVideoMuteStore } from "@/stores/video-mute-store";

/**
 * Hook that bridges the global mute store with a `<video>` element.
 *
 * - Reads `isMuted` / `toggleMute` from the zustand persist store.
 * - Syncs `videoRef.current.muted` through a synchronous store subscription so the HTML
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
    if (!el) return;
    el.muted = useVideoMuteStore.getState().isMuted;
    // Run inside the mute button's user gesture, including for other mounted
    // cards. Deferring unmute to a React effect can pause playback in Safari.
    // Audio changes must never call play/pause or claim playback priority.
    return useVideoMuteStore.subscribe((state, previous) => {
      if (state.isMuted !== previous.isMuted) el.muted = state.isMuted;
    });
  }, [videoRef]);

  return { isMuted, toggleMute, setMuted } as const;
}
