import { describe, expect, it } from "vitest";
import { assessSelfieFraming, getSelfiePreviewRect } from "./selfie-framing";

const face = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top },
  { x: right, y: bottom },
];

describe("selfie preview framing", () => {
  it("accepts a centred face in a portrait camera preview", () => {
    expect(assessSelfieFraming(face(0.3, 0.3, 0.7, 0.7), 720, 960, 360, 480).faceOk).toBe(true);
  });
  it("keeps a shifted face tracked without allowing an off-centre photo", () => {
    expect(assessSelfieFraming(face(0.08, 0.3, 0.33, 0.7), 1280, 720, 360, 480).faceOk).toBe(false);
    expect(assessSelfieFraming(face(0.08, 0.3, 0.33, 0.7), 1280, 720, 360, 480).trackingOk).toBe(
      true
    );
  });
  it("shows the entire landscape camera feed on a portrait phone, without zoom cropping", () => {
    expect(getSelfiePreviewRect(1280, 720, 360, 640)).toEqual({
      width: 360,
      height: 202.5,
      left: 0,
      top: 218.75,
      scale: 0.28125,
    });
  });
  it("shows the full portrait camera feed in a wide viewport", () => {
    expect(getSelfiePreviewRect(720, 960, 640, 360)).toEqual({
      width: 270,
      height: 360,
      left: 185,
      top: 0,
      scale: 0.375,
    });
  });
  it("gives the same framing decision when the phone rotates", () => {
    const points = face(0.3, 0.3, 0.7, 0.7);
    expect(assessSelfieFraming(points, 720, 960, 360, 640)).toEqual(
      assessSelfieFraming(points, 720, 960, 640, 360)
    );
  });
  it("asks an oversized face to move further away, not closer", () => {
    expect(assessSelfieFraming(face(0.1, 0.1, 0.9, 0.9), 720, 960, 360, 480).instruction).toMatch(
      /further/
    );
  });
  it("asks a distant face to move closer", () => {
    expect(
      assessSelfieFraming(face(0.45, 0.45, 0.55, 0.55), 720, 960, 360, 480).instruction
    ).toMatch(/closer/);
  });
  it("uses the resized guide in landscape", () => {
    expect(assessSelfieFraming(face(0.4, 0.3, 0.6, 0.7), 1280, 720, 640, 360).faceOk).toBe(true);
  });
  it("rejects invalid landmarks and a missing video frame", () => {
    expect(assessSelfieFraming([{ x: NaN, y: 0.5 }], 720, 960, 360, 480).faceOk).toBe(false);
    expect(assessSelfieFraming([], 0, 0, 360, 480).faceOk).toBe(false);
  });
});
