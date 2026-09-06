import { describe, expect, it } from "vitest";
import { createFaceChallenge, type FaceFrame } from "./face-challenge";

const neutral: FaceFrame = { faceCount: 1, faceOk: true, yaw: 0, eyesClosed: false };
function session(random = 0.1) {
  const challenge = createFaceChallenge(random);
  let time = 100;
  const frame = (patch: Partial<FaceFrame> = {}, advance = 100) => {
    time += advance;
    return challenge.update({ ...neutral, ...patch }, time);
  };
  const centre = () => {
    frame();
    frame();
    return frame();
  };
  const blink = () => {
    frame({ eyesClosed: true });
    frame();
    return centre();
  };
  const turn = (yaw = 0.25) => {
    frame({ yaw });
    frame({ yaw });
    frame({ yaw });
    return centre();
  };
  return { frame, centre, blink, turn };
}

describe("browser face challenge", () => {
  it("never passes a stationary face", () => {
    const s = session();
    for (let i = 0; i < 500; i++) expect(s.frame().livenessPassed).toBe(false);
  });
  it.each([0.1, 0.3, 0.6, 0.9])("requires both movements and a neutral finish (%s)", (random) => {
    const s = session(random);
    const first = s.centre().challenge;
    const yaw = random < 0.5 ? 0.25 : -0.25;
    const halfway = first === "blink" ? s.blink() : s.turn(yaw);
    expect(halfway.livenessPassed).toBe(false);
    expect(halfway.completedSteps).toBe(1);
    const end = first === "blink" ? s.turn(yaw) : s.blink();
    expect(end.livenessPassed).toBe(true);
    expect(end.completedSteps).toBe(2);
  });
  it("does not accept a face already turned at the start", () => {
    const s = session(0.3);
    for (let i = 0; i < 20; i++) expect(s.frame({ yaw: 0.25 }).completedSteps).toBe(0);
  });
  it("rejects the wrong turn direction", () => {
    const s = session();
    s.centre();
    s.blink();
    expect(s.turn(-0.25).livenessPassed).toBe(false);
  });
  it.each([{ faceCount: 0 }, { faceCount: 2 }, { faceOk: false }])(
    "resets when framing is lost: %s",
    (patch) => {
      const s = session();
      s.centre();
      s.blink();
      s.turn();
      expect(s.frame(patch).livenessPassed).toBe(false);
      expect(s.centre().completedSteps).toBe(0);
    }
  );
  it("expires a completed challenge after five seconds", () => {
    const s = session();
    s.centre();
    s.blink();
    s.turn();
    expect(s.frame({}, 5100).livenessPassed).toBe(false);
  });
  it("waits for open eyes without making a natural blink restart both movements", () => {
    const s = session();
    s.centre();
    s.blink();
    s.turn();
    expect(s.frame({ eyesClosed: true }).livenessPassed).toBe(false);
    expect(s.frame().livenessPassed).toBe(true);
  });
  it("expires partial progress after 45 seconds", () => {
    const s = session();
    s.centre();
    s.blink();
    expect(s.frame({}, 46_000).completedSteps).toBe(0);
  });
});
