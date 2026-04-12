import { afterEach, describe, expect, it, vi } from "vitest";
import { readMediaDimensions } from "./media-metadata";

describe("readMediaDimensions", () => {
  const originalUserAgent = navigator.userAgent;
  const originalCreateElement = document.createElement.bind(document);
  const originalImage = window.Image;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window.navigator, "userAgent", {
      value: originalUserAgent,
      configurable: true,
    });
    window.Image = originalImage;
  });

  it("returns null in jsdom environment (test harness)", async () => {
    const file = new File(["fake-image"], "photo.jpg", { type: "image/jpeg" });
    const result = await readMediaDimensions(file);
    // jsdom is detected and returns null immediately
    expect(result).toBeNull();
  });

  it("returns null for video files in jsdom", async () => {
    const file = new File(["fake-video"], "clip.mp4", { type: "video/mp4" });
    const result = await readMediaDimensions(file);
    expect(result).toBeNull();
  });

  it("returns image dimensions outside jsdom when image metadata loads", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0",
      configurable: true,
    });

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    class MockImage extends EventTarget {
      naturalWidth = 1280;
      naturalHeight = 720;

      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
    }

    window.Image = MockImage as never;

    const file = new File(["fake-image"], "photo.jpg", { type: "image/jpeg" });
    const result = await readMediaDimensions(file);

    expect(result).toEqual({ width: 1280, height: 720 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image");
  });

  it("returns video dimensions outside jsdom when metadata loads", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0",
      configurable: true,
    });

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    class MockVideo extends EventTarget {
      preload = "";
      videoWidth = 1920;
      videoHeight = 1080;

      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
      }
    }

    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName === "video") {
        return new MockVideo() as never;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const file = new File(["fake-video"], "clip.mp4", { type: "video/mp4" });
    const result = await readMediaDimensions(file);

    expect(result).toEqual({ width: 1920, height: 1080 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:video");
  });

  it("returns null when video metadata loads with zero dimensions", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0",
      configurable: true,
    });

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video-zero");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    class MockVideoZero extends EventTarget {
      preload = "";
      videoWidth = 0;
      videoHeight = 0;

      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
      }
    }

    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName === "video") {
        return new MockVideoZero() as never;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const file = new File(["fake-video"], "clip.mp4", { type: "video/mp4" });
    const result = await readMediaDimensions(file);

    expect(result).toBeNull();
  });

  it("returns null when video element emits error", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0",
      configurable: true,
    });

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video-error");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    class MockVideoError extends EventTarget {
      preload = "";

      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("error")));
      }
    }

    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName === "video") {
        return new MockVideoError() as never;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const file = new File(["fake-video"], "clip.mp4", { type: "video/mp4" });
    const result = await readMediaDimensions(file);

    expect(result).toBeNull();
  });

  it("returns null when image load emits error", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0",
      configurable: true,
    });

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image-error");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    class MockImageError extends EventTarget {
      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("error")));
      }
    }

    window.Image = MockImageError as never;

    const file = new File(["fake-image"], "photo.jpg", { type: "image/jpeg" });
    const result = await readMediaDimensions(file);

    expect(result).toBeNull();
  });

  it("returns null when non-image and non-video files are passed", async () => {
    const file = new File(["plain"], "notes.txt", { type: "text/plain" });
    const result = await readMediaDimensions(file);
    expect(result).toBeNull();
  });
});
