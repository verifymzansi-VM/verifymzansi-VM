/** A cover frame taken from a video file in the browser. */

/**
 * Extract a poster frame from a video at a given seek time.
 * Returns a JPEG File (or null if extraction fails). Used where no frame
 * picker is on screen: the upload hook, and a submit made before the picker
 * had a frame (video-fast-upload.ts).
 */
export function extractVideoFrame(file: File, seekTimeSec: number = 1): Promise<File | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 15_000);

    video.addEventListener("loadedmetadata", () => {
      const dur = video.duration;
      // Seek to the earlier of seekTimeSec or 10% of duration
      const target = Number.isFinite(dur)
        ? Math.min(seekTimeSec, dur * 0.1, dur - 0.01)
        : seekTimeSec;
      video.currentTime = Math.max(0, target);
    });

    video.addEventListener(
      "seeked",
      () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx || canvas.width === 0 || canvas.height === 0) {
            clearTimeout(timer);
            cleanup();
            resolve(null);
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => {
              clearTimeout(timer);
              cleanup();
              if (!blob) {
                resolve(null);
                return;
              }
              const posterName = file.name.replace(/\.[^.]+$/, "_poster.jpg");
              resolve(new File([blob], posterName, { type: "image/jpeg" }));
            },
            "image/jpeg",
            0.85
          );
        } catch {
          clearTimeout(timer);
          cleanup();
          resolve(null);
        }
      },
      { once: true }
    );

    video.addEventListener("error", () => {
      clearTimeout(timer);
      cleanup();
      resolve(null);
    });

    video.src = url;
  });
}
