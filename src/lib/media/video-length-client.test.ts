/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { checkPickedVideoLength } from "./video-length-client";
import { syntheticMp4, syntheticWebm } from "@/test/synthetic-video";

const picked = (bytes: Uint8Array, name: string, type: string) =>
  new File([bytes.slice().buffer], name, { type });

describe("checkPickedVideoLength (the phone check at pick)", () => {
  it("refuses a readable video over the form's limit with its real length", async () => {
    expect(await checkPickedVideoLength(picked(syntheticMp4(121), "a.mp4", "video/mp4"), 120)).toBe(
      "Your video is 2 min 1 s; the limit is 2 minutes"
    );
    expect(await checkPickedVideoLength(picked(syntheticMp4(119), "a.mp4", "video/mp4"), 120)).toBe(
      null
    );
    expect(
      await checkPickedVideoLength(picked(syntheticWebm(61), "e.webm", "video/webm"), 60)
    ).toBe("Your video is 1 min 1 s; the limit is 1 minute");
  });

  it("accepts a MediaRecorder WebM with no duration, so it can be converted and measured", async () => {
    expect(
      await checkPickedVideoLength(picked(syntheticWebm(null), "rec.webm", "video/webm"), 120)
    ).toBeNull();
  });

  it("accepts a fragmented MP4 for conversion (it is measured once converted)", async () => {
    expect(
      await checkPickedVideoLength(
        picked(syntheticMp4(30, { fragmented: true }), "frag.mp4", "video/mp4"),
        120
      )
    ).toBeNull();
  });
});
