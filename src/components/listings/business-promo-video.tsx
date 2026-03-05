"use client";

import { useRef, useState } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  function toggleMute() {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  }

  function handlePlay() {
    if (videoRef.current) {
      videoRef.current.play();
      setIsPlaying(true);
    }
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
        <div className="relative rounded-xl overflow-hidden bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            poster={thumbnailUrl}
            autoPlay
            muted
            loop
            playsInline
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            className="w-full max-h-[400px] object-contain"
            aria-label={`${businessName} promo video`}
          />

          {/* Play overlay — shown when paused and no autoplay */}
          {!isPlaying && (
            <button
              type="button"
              onClick={handlePlay}
              className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity hover:bg-black/40"
              aria-label="Play video"
            >
              <div className="rounded-full bg-white/90 p-3 shadow-lg">
                <Play className="h-6 w-6 text-black fill-black" />
              </div>
            </button>
          )}

          {/* Mute/Unmute button */}
          <button
            type="button"
            onClick={toggleMute}
            className="absolute bottom-3 right-3 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors backdrop-blur-sm"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
