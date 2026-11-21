import { describe, expect, it } from "vitest";
import {
  analyseFrame,
  cameraProblem,
  isInAppBrowser,
  isPhoneOrTablet,
  qualityHint,
  scaledSize,
  shouldRetryWithPlainerSettings,
} from "./camera-capture-helpers";

/** An RGBA frame of `width` x `height` filled by `pixel(x, y)` (grey levels). */
function frame(width: number, height: number, pixel: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const v = pixel(x, y);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  return data;
}

describe("camera error mapping", () => {
  it.each([
    ["NotAllowedError", "blocked"],
    ["SecurityError", "blocked"],
    ["NotFoundError", "none"],
    ["MediaDevicesUnavailable", "none"],
    ["OverconstrainedError", "none"],
    ["NotReadableError", "busy"],
    ["TimeoutError", "busy"],
    ["AbortError", "failed"],
    ["", "failed"],
  ])("%s is shown as %s", (name, kind) => {
    expect(cameraProblem(name)).toBe(kind);
  });

  it("retries unsupported settings and missing cameras with plainer settings only", () => {
    expect(shouldRetryWithPlainerSettings("OverconstrainedError")).toBe(true);
    expect(shouldRetryWithPlainerSettings("NotFoundError")).toBe(true);
    expect(shouldRetryWithPlainerSettings("NotAllowedError")).toBe(false);
    expect(shouldRetryWithPlainerSettings("NotReadableError")).toBe(false);
  });
});

describe("browser checks", () => {
  it("recognises in-app browsers that often block cameras", () => {
    expect(isInAppBrowser("Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 300.0")).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 (Linux; Android 14; wv) [FBAN/FB4A;FBAV/450.0]")).toBe(true);
    expect(
      isInAppBrowser(
        "Mozilla/5.0 (Linux; Android 14; K; wv) AppleWebKit Version/4.0 Chrome WhatsApp"
      )
    ).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36")).toBe(
      false
    );
    expect(
      isInAppBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36")
    ).toBe(false);
  });

  it("tells phones from computers", () => {
    expect(isPhoneOrTablet("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile/15E148")).toBe(true);
    expect(isPhoneOrTablet("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130")).toBe(false);
  });
});

describe("live quality hints", () => {
  it("asks for light, then less glare, then stillness, and is quiet for a good frame", () => {
    const dark = frame(40, 30, (x) => (x % 2 ? 20 : 40));
    expect(qualityHint(analyseFrame(dark, 40, 30))).toBe("Too dark: move to better light");
    const glare = frame(40, 30, (x, y) => (x < 10 && y < 10 ? 255 : x % 2 ? 90 : 150));
    expect(qualityHint(analyseFrame(glare, 40, 30))).toBe("Too much glare: tilt the card a little");
    const flat = frame(40, 30, () => 140);
    expect(qualityHint(analyseFrame(flat, 40, 30))).toBe("Hold still");
    const good = frame(40, 30, (x) => (x % 2 ? 90 : 170));
    expect(qualityHint(analyseFrame(good, 40, 30))).toBeNull();
  });

  it("measures an empty frame as nothing", () => {
    expect(analyseFrame([], 0, 0)).toEqual({ brightness: 0, glare: 0, sharpness: 0 });
  });
});

describe("photo size", () => {
  it("caps the long edge and never enlarges", () => {
    expect(scaledSize(3840, 2160, 2000)).toEqual({ width: 2000, height: 1125 });
    expect(scaledSize(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
    expect(scaledSize(640, 480, 2000)).toEqual({ width: 640, height: 480 });
  });
});
