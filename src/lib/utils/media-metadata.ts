export interface MediaDimensions {
  width: number;
  height: number;
}

export async function readMediaDimensions(file: File): Promise<MediaDimensions | null> {
  if (typeof window === "undefined") {
    return null;
  }

  // JSDOM does not reliably load blob-backed media, so skip probing in tests.
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) {
    return null;
  }

  if (file.type.startsWith("video/")) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";

      const cleanup = () => {
        URL.revokeObjectURL(url);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 8000);

      video.addEventListener(
        "loadedmetadata",
        () => {
          clearTimeout(timer);
          const width = video.videoWidth;
          const height = video.videoHeight;
          cleanup();
          if (width > 0 && height > 0) {
            resolve({ width, height });
            return;
          }
          resolve(null);
        },
        { once: true }
      );

      video.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          cleanup();
          resolve(null);
        },
        { once: true }
      );

      video.src = url;
    });
  }

  if (file.type.startsWith("image/")) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new window.Image();

      const cleanup = () => {
        URL.revokeObjectURL(url);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 8000);

      image.addEventListener(
        "load",
        () => {
          clearTimeout(timer);
          const width = image.naturalWidth;
          const height = image.naturalHeight;
          cleanup();
          if (width > 0 && height > 0) {
            resolve({ width, height });
            return;
          }
          resolve(null);
        },
        { once: true }
      );

      image.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          cleanup();
          resolve(null);
        },
        { once: true }
      );

      image.src = url;
    });
  }

  return null;
}
