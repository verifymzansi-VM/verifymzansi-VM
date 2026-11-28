"use client";

import { useEffect, useState } from "react";
import { VideoProgressLine } from "@/components/ui/video-seek-bar";

const ACTIVE_VIDEO = "video[data-vm-active-video]";
const EVENTS = ["loadedmetadata", "durationchange", "timeupdate", "seeked", "emptied"] as const;

function activeVideo() {
  return document.querySelector<HTMLVideoElement>(ACTIVE_VIDEO);
}

/**
 * The quiet progress line for the video on screen. Only that post mounts a
 * <video>; this follows it by listening on the page, so a retry or a new
 * element after a swipe is picked up without wiring through the stage.
 */
export function VideoModeSeek() {
  const [time, setTime] = useState({ current: 0, duration: 0 });

  useEffect(() => {
    const read = () => {
      const video = activeVideo();
      const duration = video && Number.isFinite(video.duration) ? video.duration : 0;
      const current = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
      setTime((previous) =>
        previous.current === current && previous.duration === duration
          ? previous
          : { current, duration }
      );
    };
    const onMediaEvent = (event: Event) => {
      if (event.target instanceof Element && event.target.matches(ACTIVE_VIDEO)) read();
    };
    read();
    // Media events do not bubble; the capture phase still sees them.
    for (const type of EVENTS) document.addEventListener(type, onMediaEvent, true);
    return () => {
      for (const type of EVENTS) document.removeEventListener(type, onMediaEvent, true);
    };
  }, []);

  const seek = (next: number) => {
    const video = activeVideo();
    if (!video || !(time.duration > 0)) return;
    const clamped = Math.min(Math.max(next, 0), time.duration);
    video.currentTime = clamped;
    setTime((previous) => ({ ...previous, current: clamped }));
  };

  return (
    <div data-vm-control>
      <VideoProgressLine currentTime={time.current} duration={time.duration} onSeek={seek} />
    </div>
  );
}
