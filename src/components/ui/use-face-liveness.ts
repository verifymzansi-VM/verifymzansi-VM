"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client-side liveness + face-quality gate for KYC selfie capture.
 *
 * Uses MediaPipe FaceLandmarker (open-source, runs fully in the browser via
 * WASM — no server calls, no recurring cost) to:
 *  1. Confirm exactly one face is present, large enough, and roughly centered.
 *  2. Run a randomized active-liveness challenge (blink OR head turn) so a
 *     static photo / screen replay cannot satisfy the capture.
 *
 * If the model cannot load (old device, WASM blocked, offline), the hook
 * reports `supported: false` so the caller can gracefully fall back to a
 * plain capture instead of locking the user out.
 */

export type LivenessChallenge = "blink" | "turn_left" | "turn_right";

export type LivenessPhase =
  | "idle"
  | "loading"
  | "ready" // model loaded, waiting for a valid face
  | "challenge" // face present, waiting for the challenge motion
  | "passed" // challenge completed — capture allowed
  | "unsupported"; // model failed to load — caller should allow plain capture

export interface LivenessStatus {
  phase: LivenessPhase;
  /** The challenge the user must perform (only meaningful in `challenge`). */
  challenge: LivenessChallenge | null;
  /** Human-readable instruction for the current phase. */
  instruction: string;
  /** True when a single, well-framed face is currently detected. */
  faceOk: boolean;
  /** Number of faces currently detected. */
  faceCount: number;
  /** True once the active-liveness challenge has been completed. */
  livenessPassed: boolean;
  /** False when the model could not load and liveness cannot be verified. */
  supported: boolean;
}

interface FaceLandmarkerLike {
  detectForVideo(
    videoFrame: HTMLVideoElement,
    timestamp: number
  ): {
    faceLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
    faceBlendshapes?: Array<{
      categories: Array<{ categoryName: string; score: number }>;
    }>;
  };
  close(): void;
}

interface FaceLandmarkerModule {
  FaceLandmarker: {
    createFromOptions(
      wasmFileset: unknown,
      options: Record<string, unknown>
    ): Promise<FaceLandmarkerLike>;
  };
  FilesetResolver: {
    forVisionTasks(basePath: string): Promise<unknown>;
  };
}

// ── Tuning constants ─────────────────────────────────────────
/** Min face bounding-box width as a fraction of frame width. */
const MIN_FACE_WIDTH_RATIO = 0.18;
/** Max horizontal/vertical offset of face centre from frame centre. */
const MAX_CENTER_OFFSET_RATIO = 0.28;
/** Eye aspect-ratio below this counts as "closed". */
const EYE_CLOSED_THRESHOLD = 0.21;
/** Consecutive closed frames required to register a blink. */
const BLINK_CLOSED_FRAMES = 2;
/** Head yaw (normalized) beyond this counts as a turn. */
const HEAD_TURN_THRESHOLD = 0.055;
/** Consecutive turned frames required to register a head turn. */
const TURN_FRAMES = 3;
/** How often (ms) we run detection on the live video. */
const DETECT_INTERVAL_MS = 120;
/** Give up loading the model after this long and mark unsupported. */
const MODEL_LOAD_TIMEOUT_MS = 20_000;

// MediaPipe FaceMesh landmark indices for the eye contours.
const LEFT_EYE = [33, 160, 158, 133, 153, 144] as const;
const RIGHT_EYE = [362, 385, 387, 263, 373, 380] as const;
// Nose tip + left/right cheek for a cheap yaw estimate.
const NOSE_TIP = 1;
const LEFT_CHEEK = 234;
const RIGHT_CHEEK = 454;

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Eye aspect ratio — low when the eye is closed. */
function eyeAspectRatio(
  landmarks: Array<{ x: number; y: number; z: number }>,
  idx: readonly number[]
): number {
  const [p1, p2, p3, p4, p5, p6] = idx.map((i) => landmarks[i]);
  const vertical = dist(p2, p6) + dist(p3, p5);
  const horizontal = 2 * dist(p1, p4);
  if (horizontal === 0) return 1;
  return vertical / horizontal;
}

function pickChallenge(): LivenessChallenge {
  const options: LivenessChallenge[] = ["blink", "turn_left", "turn_right"];
  return options[Math.floor(Math.random() * options.length)];
}

function instructionFor(
  phase: LivenessPhase,
  challenge: LivenessChallenge | null,
  faceOk: boolean,
  faceCount: number
): string {
  switch (phase) {
    case "loading":
      return "Loading face check…";
    case "ready":
      if (faceCount === 0) return "Position your face in the frame.";
      if (faceCount > 1) return "Only one person may be in the frame.";
      if (!faceOk) return "Move closer and centre your face.";
      return "Hold still…";
    case "challenge":
      if (challenge === "blink") return "Now blink your eyes.";
      if (challenge === "turn_left") return "Now slowly turn your head to the left.";
      return "Now slowly turn your head to the right.";
    case "passed":
      return "Liveness confirmed — you can take the photo.";
    case "unsupported":
      return "";
    default:
      return "";
  }
}

/**
 * Drives the liveness state machine against a live <video> element.
 * Call `start(video)` once the camera stream is attached; call `stop()` on
 * teardown or when the user retakes.
 */
export function useFaceLiveness() {
  const landmarkerRef = useRef<FaceLandmarkerLike | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Incremented on every start/stop/reset so an in-flight async model load
  // from a previous session can detect it has been superseded and bail out
  // instead of leaking a detection interval on a dead video element.
  const generationRef = useRef(0);

  const challengeRef = useRef<LivenessChallenge | null>(null);
  const closedFramesRef = useRef(0);
  const turnFramesRef = useRef(0);
  const wasOpenRef = useRef(false);

  const [status, setStatus] = useState<LivenessStatus>({
    phase: "idle",
    challenge: null,
    instruction: "",
    faceOk: false,
    faceCount: 0,
    livenessPassed: false,
    supported: true,
  });

  const setPhase = useCallback((phase: LivenessPhase, patch: Partial<LivenessStatus> = {}) => {
    setStatus((prev) => {
      const challenge = patch.challenge !== undefined ? patch.challenge : prev.challenge;
      const faceOk = patch.faceOk !== undefined ? patch.faceOk : prev.faceOk;
      const faceCount = patch.faceCount !== undefined ? patch.faceCount : prev.faceCount;
      return {
        ...prev,
        ...patch,
        phase,
        challenge,
        faceOk,
        faceCount,
        instruction: instructionFor(phase, challenge, faceOk, faceCount),
      };
    });
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    videoRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    challengeRef.current = null;
    closedFramesRef.current = 0;
    turnFramesRef.current = 0;
    wasOpenRef.current = false;
    setStatus({
      phase: "idle",
      challenge: null,
      instruction: "",
      faceOk: false,
      faceCount: 0,
      livenessPassed: false,
      supported: true,
    });
  }, [stop]);

  const evaluateFrame = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    let result;
    try {
      result = landmarker.detectForVideo(video, performance.now());
    } catch {
      return; // transient detection error — skip frame
    }

    const faces = result.faceLandmarks ?? [];
    const faceCount = faces.length;

    setStatus((prev) => {
      // Already passed — nothing more to do.
      if (prev.phase === "passed" || prev.phase === "unsupported") return prev;

      if (faceCount !== 1) {
        challengeRef.current = null;
        return {
          ...prev,
          phase: "ready",
          faceCount,
          faceOk: false,
          instruction: instructionFor("ready", null, false, faceCount),
        };
      }

      const landmarks = faces[0];
      const xs = landmarks.map((l) => l.x);
      const ys = landmarks.map((l) => l.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const faceWidth = maxX - minX;
      const faceHeight = maxY - minY;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const faceOk =
        faceWidth >= MIN_FACE_WIDTH_RATIO &&
        Math.abs(centerX - 0.5) <= MAX_CENTER_OFFSET_RATIO &&
        Math.abs(centerY - 0.5) <= MAX_CENTER_OFFSET_RATIO &&
        faceHeight > 0;

      if (!faceOk) {
        challengeRef.current = null;
        return {
          ...prev,
          phase: "ready",
          faceCount,
          faceOk: false,
          instruction: instructionFor("ready", null, false, faceCount),
        };
      }

      // Face is well-framed — ensure a challenge is active.
      if (!challengeRef.current) {
        challengeRef.current = pickChallenge();
        closedFramesRef.current = 0;
        turnFramesRef.current = 0;
        wasOpenRef.current = false;
      }
      const challenge = challengeRef.current;

      let passed = false;

      if (challenge === "blink") {
        const leftEar = eyeAspectRatio(landmarks, LEFT_EYE);
        const rightEar = eyeAspectRatio(landmarks, RIGHT_EYE);
        const avgEar = (leftEar + rightEar) / 2;
        const closed = avgEar < EYE_CLOSED_THRESHOLD;

        if (closed) {
          closedFramesRef.current += 1;
        } else {
          // A blink = eyes were closed for enough frames, then reopened.
          if (closedFramesRef.current >= BLINK_CLOSED_FRAMES && wasOpenRef.current) {
            passed = true;
          }
          closedFramesRef.current = 0;
        }
        if (!closed) wasOpenRef.current = true;
      } else {
        // Head turn: compare nose-tip x to the midpoint of the cheeks.
        const nose = landmarks[NOSE_TIP];
        const leftCheek = landmarks[LEFT_CHEEK];
        const rightCheek = landmarks[RIGHT_CHEEK];
        const cheekMidX = (leftCheek.x + rightCheek.x) / 2;
        const yaw = nose.x - cheekMidX; // + = turned toward right cheek

        const turned =
          challenge === "turn_left" ? yaw < -HEAD_TURN_THRESHOLD : yaw > HEAD_TURN_THRESHOLD;

        if (turned) {
          turnFramesRef.current += 1;
          if (turnFramesRef.current >= TURN_FRAMES) passed = true;
        } else {
          turnFramesRef.current = 0;
        }
      }

      if (passed) {
        return {
          ...prev,
          phase: "passed",
          challenge,
          faceCount,
          faceOk: true,
          livenessPassed: true,
          instruction: instructionFor("passed", challenge, true, faceCount),
        };
      }

      return {
        ...prev,
        phase: "challenge",
        challenge,
        faceCount,
        faceOk: true,
        instruction: instructionFor("challenge", challenge, true, faceCount),
      };
    });
  }, []);

  const start = useCallback(
    async (video: HTMLVideoElement) => {
      stop();
      const generation = ++generationRef.current;
      videoRef.current = video;
      setPhase("loading", { supported: true });

      // Lazy-load the library so it never blocks the base camera flow.
      let mod: FaceLandmarkerModule;
      try {
        mod = (await import("@mediapipe/tasks-vision")) as unknown as FaceLandmarkerModule;
      } catch {
        setPhase("unsupported", { supported: false });
        return;
      }

      // Bail out if stop()/reset() ran while the module was importing.
      if (generation !== generationRef.current) return;

      try {
        const loadPromise = (async () => {
          const fileset = await mod.FilesetResolver.forVisionTasks(WASM_BASE);
          return mod.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
            runningMode: "VIDEO",
            numFaces: 2, // detect a 2nd face so we can reject "multiple people"
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false,
          });
        })();

        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("model load timeout")), MODEL_LOAD_TIMEOUT_MS)
        );

        landmarkerRef.current = await Promise.race([loadPromise, timeout]);
      } catch {
        // GPU delegate can fail on some devices — retry on CPU once.
        try {
          const fileset = await mod.FilesetResolver.forVisionTasks(WASM_BASE);
          landmarkerRef.current = await mod.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            numFaces: 2,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false,
          });
        } catch {
          setPhase("unsupported", { supported: false });
          return;
        }
      }

      // Bail out if stop()/reset() ran while the model was loading — otherwise
      // we'd start a detection interval on a video that is no longer active.
      if (generation !== generationRef.current) {
        try {
          landmarkerRef.current?.close();
        } catch {
          // ignore
        }
        landmarkerRef.current = null;
        return;
      }

      setPhase("ready", { faceCount: 0, faceOk: false });
      intervalRef.current = setInterval(evaluateFrame, DETECT_INTERVAL_MS);
    },
    [evaluateFrame, setPhase, stop]
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stop();
      if (landmarkerRef.current) {
        try {
          landmarkerRef.current.close();
        } catch {
          // ignore
        }
        landmarkerRef.current = null;
      }
    };
  }, [stop]);

  return { status, start, stop, reset };
}
