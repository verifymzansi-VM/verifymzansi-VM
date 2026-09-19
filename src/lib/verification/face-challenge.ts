/** Browser challenge evidence only; never a server attestation or automatic approval. */
export type FaceChallenge = "blink" | "turn_left" | "turn_right";
export interface FaceFrame {
  faceCount: number;
  faceOk: boolean;
  /** A single face remains safely visible, even while it moves outside the capture guide. */
  trackingOk?: boolean;
  framingInstruction?: string;
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
  let lostSince: number | null = null;
  let neutralYaw = 0;
  let neutralSamples: number[] = [];

  function reset() {
    step = 0;
    stage = "centre";
    heldFrames = 0;
    eyesWereOpen = false;
    actionSeen = false;
    startedAt = 0;
    passedAt = 0;
    lostSince = null;
    neutralYaw = 0;
    neutralSamples = [];
  }

  function update(frame: FaceFrame, now: number) {
    if (
      frame.faceCount > 1 ||
      (startedAt > 0 && now - startedAt > 45_000) ||
      (stage === "passed" && now - passedAt > 5_000)
    )
      reset();

    const valid = frame.faceCount === 1 && (frame.trackingOk ?? frame.faceOk);
    if (!valid) {
      // A turn can briefly hide landmarks. Pause without discarding completed
      // movements, but never accept an action across a missing observation.
      lostSince ??= now;
      heldFrames = 0;
      neutralSamples = [];
      actionSeen = false;
      if (now - lostSince >= 1_200) reset();
    } else {
      lostSince = null;
    }
    const centred =
      valid &&
      frame.faceOk &&
      !frame.eyesClosed &&
      Math.abs(frame.yaw - neutralYaw) < (stage === "centre" ? 0.12 : 0.1);

    if (valid && stage !== "passed") {
      if (!startedAt) startedAt = now;
      if (stage === "centre" || stage === "return") {
        heldFrames = centred ? heldFrames + 1 : 0;
        if (stage === "centre") {
          neutralSamples = centred ? [...neutralSamples, frame.yaw] : [];
        }
        if (heldFrames >= 3) {
          if (stage === "centre") {
            neutralYaw = neutralSamples.reduce((sum, yaw) => sum + yaw, 0) / neutralSamples.length;
          }
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
        const relativeYaw = frame.yaw - neutralYaw;
        const turned = sequence[step] === "turn_left" ? relativeYaw > 0.14 : relativeYaw < -0.14;
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
            : frame.framingInstruction || "Bring your whole face back into view.";
    else if (!frame.faceOk && (stage === "centre" || stage === "return" || passed))
      instruction = frame.framingInstruction || "Centre your whole face inside the oval.";
    else if (passed)
      instruction = frame.eyesClosed
        ? "Open your eyes for the photo."
        : !centred
          ? "Look straight at the camera again."
          : "Hold still. Taking your photo automatically.";
    else if (stage === "return") instruction = "Look straight at the camera again and hold still.";
    else if (stage === "action")
      instruction =
        sequence[step] === "blink"
          ? "Close both eyes for a moment, then open them."
          : sequence[step] === "turn_left"
            ? "Turn a little to your left. Keep both eyes visible."
            : "Turn a little to your right. Keep both eyes visible.";

    return {
      phase: passed ? ("passed" as const) : valid ? ("challenge" as const) : ("ready" as const),
      challenge: sequence[Math.min(step, 1)],
      instruction,
      completedSteps: step,
      faceOk: valid && frame.faceOk,
      faceCount: frame.faceCount,
      livenessPassed: passed && centred,
      supported: true,
    };
  }
  return { update, reset };
}
