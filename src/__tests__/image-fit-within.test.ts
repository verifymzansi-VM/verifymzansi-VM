import { describe, expect, it } from "vitest";
import { MAX_IMAGE_DIMENSION, fitWithin } from "@/hooks/use-media-upload";

describe("fitWithin client-side photo resize geometry", () => {
  it("keeps photos that already fit", () => {
    expect(fitWithin(2560, 1920)).toEqual({ width: 2560, height: 1920, scaled: false });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
  });

  it("shrinks the longest side to the limit and keeps the ratio", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2560, height: 1920, scaled: true });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1920, height: 2560, scaled: true });
  });

  it("never produces a zero-pixel side", () => {
    expect(fitWithin(100000, 10).height).toBe(1);
  });

  it("uses 2560 as the client resize target", () => {
    expect(MAX_IMAGE_DIMENSION).toBe(2560);
  });
});
