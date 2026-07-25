"use client";

import { useRef, useState, useEffect } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";
import { useGlobalMute } from "@/hooks/use-global-mute";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useDataSaver } from "@/hooks/use-data-saver";

interface BusinessPromoVideoProps {
  videoUrl: string;
  thumbnailUrl?: string;
  businessName: string;
}

export function BusinessPromoVideo({
  videoUrl,
  thumbnailUrl,
  businessName,
}: BusinessPromoVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { isMuted, toggleMute } = useGlobalMute(videoRef);
  const [isPlaying, setIsPlaying] = useState(false);
  const manager = useVideoPlaybackManager();
  const reducedMotion = useReducedMotion();
  const dataSaver = useDataSaver();
  const autoplayBlocked = reducedMotion || dataSaver;

  // Register with global playback manager so this video participates in
  // single-video arbitration (pauses when a card video claims priority).
  // When the user prefers reduced motion or data saving, visibility is
  // reported as 0 so the manager never auto-plays this video — the manual
  // play affordance is shown instead.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    manager.register(el);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !autoplayBlocked) {
          manager.updateVisibility(el, entry.intersectionRatio);
        } else {
          el.pause();
          manager.updateVisibility(el, 0);
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      manager.unregister(el);
    };
  }, [manager, autoplayBlocked]);

  function handlePlay() {
    const el = videoRef.current;
    if (!el) return;
    // Claim singleton priority so any other playing video pauses first.
    manager.requestPriority(el);
    el.play();
    setIsPlaying(true);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Play className="w-4 h-4 text-muted-foreground" />
          Promo Video
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Fixed 16:9 frame — reserves space before metadata loads, so
            playback never causes a layout shift. Letterboxed on black. */}
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            poster={thumbnailUrl}
            preload="metadata"
            muted
            loop
            playsInline
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            className="h-full w-full object-contain"
            aria-label={`${businessName} promo video`}
          />

          {/* Play overlay — shown when paused */}
          {!isPlaying && (
            <button
              type="button"
              onClick={handlePlay}
              className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity hover:bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-inset"
              aria-label={`Play ${businessName} promo video`}
            >
              <div className="rounded-full bg-white/90 p-3 shadow-lg">
                <Play className="h-6 w-6 text-black fill-black" />
              </div>
            </button>
          )}

          {/* Mute/Unmute button — 44px touch target */}
          <button
            type="button"
            onClick={toggleMute}
            className="absolute bottom-3 right-3 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
