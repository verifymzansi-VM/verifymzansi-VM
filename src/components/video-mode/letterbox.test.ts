import { describe, expect, it } from "vitest";
import { captionBottom, captionTop } from "./letterbox";

// A 375 x 812 phone: Details is 44 px tall, 28 px above the bottom edge (plus the safe area).
const DETAILS_TOP = 812 - 28 - 44;
const DETAILS_TOP_IPHONE = DETAILS_TOP - 34;

describe("captionTop", () => {
  it("puts the title in the black space under a landscape video", () => {
    // 16:9: the picture is 211 px tall, centred, ending at 511.
    expect(captionTop(375, 812, 1920, 1080, DETAILS_TOP)).toBe(
      Math.round((812 + 210.9375) / 2 + 12)
    );
    expect(captionTop(375, 812, 1920, 1080, DETAILS_TOP_IPHONE)).not.toBeNull();
  });

  it("keeps the title over a video that fills the screen", () => {
    expect(captionTop(375, 812, 1080, 1920, DETAILS_TOP)).toBeNull();
    expect(captionTop(375, 812, 1080, 2340, DETAILS_TOP)).toBeNull();
  });

  it("4:5 fits under the picture only when the title stays clear of Details", () => {
    // The picture ends at 640; the title and price need 88 px plus 8 px of clearance.
    const top = captionTop(375, 812, 1080, 1350, DETAILS_TOP);
    expect(top).toBe(652);
    expect(top! - 12 + 88 + 8).toBeLessThanOrEqual(DETAILS_TOP);
    // With a 34 px home-indicator safe area Details sits higher: back over the video.
    expect(captionTop(375, 812, 1080, 1350, DETAILS_TOP_IPHONE)).toBeNull();
  });

  it("3:4 keeps the title over the video (it would overlap Details)", () => {
    expect(captionTop(375, 812, 1080, 1440, DETAILS_TOP)).toBeNull();
    expect(captionTop(375, 812, 1080, 1440, DETAILS_TOP_IPHONE)).toBeNull();
  });

  it("waits until the video's size is known", () => {
    expect(captionTop(375, 812, 0, 0, DETAILS_TOP)).toBeNull();
    expect(captionTop(0, 0, 1920, 1080, DETAILS_TOP)).toBeNull();
  });
});

describe("captionBottom", () => {
  it("sits the title just above Details on one row", () => {
    expect(captionBottom(812, DETAILS_TOP)).toBe(28 + 44 + 12);
  });

  it.each([
    // Details and 'Book appointment' wrap at 360 px; Details and 'Get tickets' at 320 px.
    { width: 360, height: 780 },
    { width: 320, height: 568 },
  ])("moves the title up with a row that wraps onto two lines at $width px", ({ height }) => {
    const twoRows = 44 + 8 + 44;
    const detailsTop = height - 28 - twoRows;
    const bottom = captionBottom(height, detailsTop);
    // The title's lower edge stays 12 px above the top of the wrapped row.
    expect(height - bottom).toBe(detailsTop - 12);
    expect(bottom).toBeGreaterThan(captionBottom(height, height - 28 - 44));
  });
});
