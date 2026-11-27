import { describe, expect, it } from "vitest";
import { captionTop } from "./letterbox";

describe("captionTop", () => {
  it("puts the title in the black space under a landscape video", () => {
    // 16:9 on a 375 x 812 phone: the picture is 211 px tall, centred.
    expect(captionTop(375, 812, 1920, 1080)).toBe(Math.round((812 + 210.9375) / 2 + 12));
  });

  it("keeps the title over a video that fills the screen", () => {
    expect(captionTop(375, 812, 1080, 1920)).toBeNull();
    expect(captionTop(375, 812, 1080, 2340)).toBeNull();
  });

  it("keeps the title over the video when the black space is too small", () => {
    // 1080 x 1500 on a 375 x 812 phone leaves 146 px under the picture.
    expect(captionTop(375, 812, 1080, 1500)).toBeNull();
    // 4:5 leaves 172 px: enough.
    expect(captionTop(375, 812, 1080, 1350)).not.toBeNull();
  });

  it("waits until the video's size is known", () => {
    expect(captionTop(375, 812, 0, 0)).toBeNull();
    expect(captionTop(0, 0, 1920, 1080)).toBeNull();
  });
});
