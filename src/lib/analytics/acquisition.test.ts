import { describe, expect, it } from "vitest";
import { buildAcquisitionTouch, parseAcquisitionCookie } from "./acquisition";

const now = new Date("2026-09-25T10:00:00Z");

describe("acquisition touch", () => {
  it("captures a partner referral code in upper case", () => {
    const touch = buildAcquisitionTouch("?ref=thando1", "/", "", now);
    expect(touch).toMatchObject({ partnerCode: "THANDO1", landingPath: "/" });
  });

  it("captures UTM campaigns and classifies paid traffic", () => {
    const touch = buildAcquisitionTouch(
      "?utm_source=facebook&utm_medium=cpc&utm_campaign=launch",
      "/pricing",
      "https://l.facebook.com/",
      now
    );
    expect(touch).toMatchObject({ source: "PAID_CAMPAIGN", campaignId: "launch" });
    expect(touch?.utm).toEqual({
      utm_source: "facebook",
      utm_medium: "cpc",
      utm_campaign: "launch",
    });
  });

  it("ignores direct visits and malformed codes", () => {
    expect(buildAcquisitionTouch("", "/", "", now)).toBeNull();
    expect(buildAcquisitionTouch("?ref=<script>", "/", "", now)).toBeNull();
  });

  it("round-trips through the cookie value", () => {
    const touch = buildAcquisitionTouch("?org=city-of-xyz", "/", "", now);
    expect(parseAcquisitionCookie(encodeURIComponent(JSON.stringify(touch)))).toEqual(touch);
    expect(parseAcquisitionCookie("not json")).toBeNull();
  });
});
