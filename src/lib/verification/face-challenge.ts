/** Browser challenge evidence only; never a server attestation or automatic approval. */
export type FaceChallenge = "blink" | "turn_left" | "turn_right";
export interface FaceFrame {
  faceCount: number;
  faceOk: boolean;
  eyesClosed: boolean;
  /** Nose offset divided by cheek width; independent of distance from camera. */
  yaw: number;
}

export function createFaceChallenge(random: number) {
  const turn: FaceChallenge = random < 0.5 ? "turn_left" : "turn_right";
  const sequence: FaceChallenge[] =
    random < 0.25 || random >= 0.75 ? ["blink", turn] : [turn, "blink"];
  let step = 0;
  let stage: "centre" | "action" | "return" | "passed" = "centre";
  let heldFrames = 0;
  let eyesWereOpen = false;
  let actionSeen = false;
  let startedAt = 0;
  let passedAt = 0;

  function reset() {
    step = 0;
    stage = "centre";
    heldFrames = 0;
    eyesWereOpen = false;
    actionSeen = false;
    startedAt = 0;
    passedAt = 0;
  }

  function update(frame: FaceFrame, now: number) {
    if (
      !frame.faceOk ||
      frame.faceCount !== 1 ||
      (startedAt > 0 && now - startedAt > 45_000) ||
      (stage === "passed" && now - passedAt > 5_000)
    )
      reset();

    const valid = frame.faceOk && frame.faceCount === 1;
    const centred = valid && Math.abs(frame.yaw) < 0.08 && !frame.eyesClosed;
    if (stage === "passed" && Math.abs(frame.yaw) >= 0.08) reset();

    if (valid && stage !== "passed") {
      if (!startedAt) startedAt = now;
      if (stage === "centre" || stage === "return") {
        heldFrames = centred ? heldFrames + 1 : 0;
        if (heldFrames >= 3) {
          heldFrames = 0;
          if (stage === "return") step += 1;
          if (step === sequence.length) {
            stage = "passed";
            passedAt = now;
          } else {
            stage = "action";
            eyesWereOpen = true;
            actionSeen = false;
          }
        }
      } else if (sequence[step] === "blink") {
        if (frame.eyesClosed && eyesWereOpen) actionSeen = true;
        if (!frame.eyesClosed && actionSeen) {
          stage = "return";
          heldFrames = 0;
        }
      } else {
        // Camera pixels are unmirrored: turning to your left moves the nose right.
        const turned = sequence[step] === "turn_left" ? frame.yaw > 0.16 : frame.yaw < -0.16;
        heldFrames = turned ? heldFrames + 1 : 0;
        if (heldFrames >= 3) {
          stage = "return";
          heldFrames = 0;
        }
      }
    }

    const passed = stage === "passed";
    let instruction = "Look straight at the camera and hold still.";
    if (!valid)
      instruction =
        frame.faceCount > 1
          ? "Only one person may be in the frame."
          : frame.faceCount === 0
            ? "Position your face in the oval."
            : "Move closer and centre your whole face.";
    else if (passed)
      instruction = frame.eyesClosed
        ? "Open your eyes for the photo."
        : "Challenge complete. Keep looking at the camera and take your photo.";
    else if (stage === "return") instruction = "Look straight at the camera again and hold still.";
    else if (stage === "action")
      instruction =
        sequence[step] === "blink"
          ? "Close both eyes briefly, then open them."
          : sequence[step] === "turn_left"
            ? "Slowly turn your head to your left."
            : "Slowly turn your head to your right.";

    return {
      phase: passed ? ("passed" as const) : valid ? ("challenge" as const) : ("ready" as const),
      challenge: sequence[Math.min(step, 1)],
      instruction,
      completedSteps: step,
      faceOk: valid,
      faceCount: frame.faceCount,
      livenessPassed: passed && centred,
      supported: true,
    };
  }
  return { update, reset };
}
