import { describe, it, expect } from "vitest";
import { readMediaDimensions } from "./media-metadata";

describe("readMediaDimensions", () => {
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
});
