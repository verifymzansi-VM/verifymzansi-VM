import { describe, expect, it } from "vitest";
import { VIDEO_LENGTH_UNKNOWN_MESSAGE, videoLengthRefusalMessage } from "./video-length-refusal";

describe("videoLengthRefusalMessage", () => {
  it("names the video's length and the post kind's limit", () => {
    expect(
      videoLengthRefusalMessage({ code: "22023", details: "video_too_long", hint: "90/60" })
    ).toBe("Your video is 1 min 30 s; the limit is 1 minute");
    expect(
      videoLengthRefusalMessage({ code: "22023", details: "video_too_long", hint: "121/120" })
    ).toBe("Your video is 2 min 1 s; the limit is 2 minutes");
  });

  it("falls back to a plain message when the hint is missing or unexpected", () => {
    for (const hint of [null, "", "90/45", "abc/60", "1/60/2"])
      expect(videoLengthRefusalMessage({ code: "22023", details: "video_too_long", hint })).toBe(
        "Your video is longer than this post allows. Please choose a shorter video."
      );
  });

  it("asks for the video again when its length was never stored", () => {
    expect(videoLengthRefusalMessage({ code: "22023", details: "video_length_unknown" })).toBe(
      VIDEO_LENGTH_UNKNOWN_MESSAGE
    );
    expect(VIDEO_LENGTH_UNKNOWN_MESSAGE).toMatch(/upload the video again/);
  });

  it("ignores every other refusal", () => {
    expect(videoLengthRefusalMessage(null)).toBeNull();
    expect(
      videoLengthRefusalMessage({ code: "22023", details: "contact_channels_required" })
    ).toBeNull();
    expect(
      videoLengthRefusalMessage({ code: "PT409", details: "video_too_long", hint: "90/60" })
    ).toBeNull();
  });
});
