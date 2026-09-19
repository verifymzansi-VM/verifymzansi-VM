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
  it.each([{ faceCount: 0 }, { faceOk: false, trackingOk: false }])(
    "blocks capture immediately and resets after sustained tracking loss: %s",
    (patch) => {
      const s = session();
      s.centre();
      s.blink();
      s.turn();
      expect(s.frame(patch).livenessPassed).toBe(false);
      expect(s.frame(patch, 1200).completedSteps).toBe(0);
      expect(s.centre().completedSteps).toBe(0);
    }
  );
  it("resets immediately when a second face appears", () => {
    const s = session();
    s.centre();
    s.blink();
    expect(s.frame({ faceCount: 2 }).completedSteps).toBe(0);
  });
  it("keeps the completed blink while the right turn moves outside the photo guide", () => {
    const s = session(0.9);
    s.centre();
    expect(s.blink().completedSteps).toBe(1);
    // The user's reported sequence: the face shifts during the requested turn.
    const turned = { yaw: -0.22, faceOk: false, trackingOk: true };
    expect(s.frame(turned).instruction).toMatch(/right/);
    expect(s.frame(turned).completedSteps).toBe(1);
    expect(s.frame(turned).livenessPassed).toBe(false);
    expect(s.centre()).toMatchObject({ completedSteps: 2, livenessPassed: true });
  });
  it("preserves progress through a brief lost landmark during the turn", () => {
    const s = session(0.9);
    s.centre();
    s.blink();
    expect(s.frame({ faceCount: 0 }).livenessPassed).toBe(false);
    expect(s.frame({ faceCount: 0 }, 500).completedSteps).toBe(1);
    expect(s.turn(-0.22).livenessPassed).toBe(true);
  });
  it("does not complete a blink across a gap in face tracking", () => {
    const s = session();
    s.centre();
    s.frame({ eyesClosed: true });
    s.frame({ faceCount: 0 });
    expect(s.centre().completedSteps).toBe(0);
    expect(s.blink().completedSteps).toBe(1);
  });
  it("requires centering after the turn, without asking for the blink again", () => {
    const s = session(0.9);
    s.centre();
    s.blink();
    for (let i = 0; i < 3; i++) s.frame({ yaw: -0.22, faceOk: false, trackingOk: true });
    for (let i = 0; i < 5; i++) {
      expect(s.frame({ faceOk: false, trackingOk: true })).toMatchObject({
        completedSteps: 1,
        livenessPassed: false,
      });
    }
    expect(s.centre().livenessPassed).toBe(true);
    expect(s.frame({ yaw: -0.13 }).livenessPassed).toBe(false);
    expect(s.frame().livenessPassed).toBe(true);
  });
  it("measures a small turn relative to the user's initial neutral pose", () => {
    const s = session(0.9);
    for (let i = 0; i < 3; i++) s.frame({ yaw: 0.06 });
    s.blink();
    for (let i = 0; i < 3; i++) s.frame({ yaw: -0.1 });
    expect(s.centre().livenessPassed).toBe(true);
  });
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
