import { describe, expect, it } from "vitest";
import { computeLaplacianVariance } from "./blur-detection";

function makeUniformPixels(width: number, height: number, value = 128): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = value; // R
    data[i * 4 + 1] = value; // G
    data[i * 4 + 2] = value; // B
    data[i * 4 + 3] = 255; // A
  }
  return data;
}

function makeSharpEdgePixels(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Alternating black/white checkerboard
      const val = (x + y) % 2 === 0 ? 255 : 0;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe("computeLaplacianVariance", () => {
  it("returns low score for uniform (blurry) image", () => {
    const data = makeUniformPixels(100, 100);
    const score = computeLaplacianVariance(data, 100, 100);
    expect(score).toBeLessThan(1);
  });

  it("returns high score for sharp edge image", () => {
    const data = makeSharpEdgePixels(100, 100);
    const score = computeLaplacianVariance(data, 100, 100);
    expect(score).toBeGreaterThan(100);
  });

  it("returns Infinity for tiny images", () => {
    const data = new Uint8ClampedArray(2 * 2 * 4);
    const score = computeLaplacianVariance(data, 2, 2);
    expect(score).toBe(Infinity);
  });
});
