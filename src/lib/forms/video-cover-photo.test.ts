import { describe, expect, it } from "vitest";
import { photosWithVideoCover } from "./video-cover-photo";

describe("photosWithVideoCover", () => {
  it("makes the video's cover frame photo 1 of a video-only post", () => {
    expect(photosWithVideoCover([], true, "https://cdn/media/cover")).toEqual([
      "https://cdn/media/cover",
    ]);
  });

  it("keeps the poster's own photos when there are any", () => {
    expect(photosWithVideoCover(["https://cdn/media/a"], true, "https://cdn/media/cover")).toEqual([
      "https://cdn/media/a",
    ]);
  });

  it("adds nothing without a video or without a cover", () => {
    expect(photosWithVideoCover([], false, "https://cdn/media/cover")).toEqual([]);
    expect(photosWithVideoCover([], true, null)).toEqual([]);
    expect(photosWithVideoCover([""], true, undefined)).toEqual([]);
  });
});
