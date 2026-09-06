"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createFaceChallenge, type FaceChallenge } from "@/lib/verification/face-challenge";

export type LivenessChallenge = FaceChallenge;
export type LivenessPhase = "idle" | "loading" | "ready" | "challenge" | "passed" | "unsupported";
export interface LivenessStatus {
  phase: LivenessPhase;
  challenge: LivenessChallenge | null;
  instruction: string;
  faceOk: boolean;
  faceCount: number;
  livenessPassed: boolean;
  supported: boolean;
  completedSteps: number;
}
type Landmark = { x: number; y: number; z: number };
interface FaceLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestamp: number): { faceLandmarks?: Landmark[][] };
  close(): void;
}
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const initialStatus: LivenessStatus = {
  phase: "idle",
  challenge: null,
  instruction: "",
  faceOk: false,
  faceCount: 0,
  livenessPassed: false,
  supported: true,
  completedSteps: 0,
};

function eyeRatio(points: Landmark[], indices: number[], aspect: number) {
  const [a, b, c, d, e, f] = indices.map((i) => points[i]);
  const distance = (p: Landmark, q: Landmark) => Math.hypot((p.x - q.x) * aspect, p.y - q.y);
  return (distance(b, f) + distance(c, e)) / Math.max(0.001, 2 * distance(a, d));
}

/** Local motion checks only; every selfie still requires a human decision. */
export function useFaceLiveness() {
  const [status, setStatus] = useState<LivenessStatus>(initialStatus);
  const generationRef = useRef(0);
  const modelRef = useRef<FaceLandmarkerLike | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestFrameAt = useRef(0);
  const latestPassed = useRef(false);

  const stop = useCallback(() => {
    generationRef.current += 1;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    modelRef.current?.close();
    modelRef.current = null;
    latestPassed.current = false;
  }, []);
  const reset = useCallback(() => {
    stop();
    setStatus(initialStatus);
  }, [stop]);
  const canCapture = useCallback(
    () =>
      latestPassed.current && performance.now() - latestFrameAt.current < 500 && !document.hidden,
    []
  );

  const start = useCallback(
    async (video: HTMLVideoElement) => {
      stop();
      const generation = generationRef.current;
      setStatus({
        ...initialStatus,
        phase: "loading",
        instruction: "Preparing your live face check…",
      });
      const isCurrent = () => generation === generationRef.current;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let expired = false;
      const load = async () => {
        const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        for (const delegate of ["GPU", "CPU"] as const) {
          if (!isCurrent() || expired) throw new Error("Camera session ended");
          try {
            const model = await FaceLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: MODEL_URL, delegate },
              runningMode: "VIDEO",
              numFaces: 2,
              outputFaceBlendshapes: false,
              outputFacialTransformationMatrixes: false,
            });
            if (!isCurrent() || expired) {
              model.close();
              throw new Error("Camera session ended");
            }
            return model;
          } catch (error) {
            if (delegate === "CPU" || !isCurrent() || expired) throw error;
          }
        }
        throw new Error("Face check unavailable");
      };
      try {
        const model = await Promise.race([
          load(),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              expired = true;
              reject(new Error("Face check load timed out"));
            }, 25_000);
          }),
        ]);
        if (!isCurrent()) {
          model.close();
          return;
        }
        modelRef.current = model;
        const challenge = createFaceChallenge(
          crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
        );
        let lastVideoTime = -1;
        let errors = 0;
        setStatus({
          ...initialStatus,
          phase: "ready",
          instruction: "Position your face in the oval.",
        });
        timerRef.current = setInterval(() => {
          const now = performance.now();
          if (
            document.hidden ||
            video.paused ||
            video.readyState < 2 ||
            !video.videoWidth ||
            video.currentTime === lastVideoTime
          ) {
            if (document.hidden || now - latestFrameAt.current > 500) {
              challenge.reset();
              latestPassed.current = false;
              setStatus({
                ...initialStatus,
                phase: "ready",
                instruction: "Keep the camera active to continue your face check.",
              });
            }
            return;
          }
          lastVideoTime = video.currentTime;
          try {
            const faces = model.detectForVideo(video, now).faceLandmarks ?? [];
            const points = faces[0];
            let faceOk = false,
              yaw = 0,
              eyesClosed = false;
            if (faces.length === 1 && points?.length >= 455) {
              const xs = points.map((p) => p.x),
                ys = points.map((p) => p.y);
              const minX = Math.min(...xs),
                maxX = Math.max(...xs);
              const minY = Math.min(...ys),
                maxY = Math.max(...ys);
              faceOk =
                maxX - minX >= 0.18 &&
                maxX - minX <= 0.8 &&
                minX > 0.02 &&
                maxX < 0.98 &&
                minY > 0.02 &&
                maxY < 0.98 &&
                Math.abs((minX + maxX) / 2 - 0.5) < 0.22 &&
                Math.abs((minY + maxY) / 2 - 0.5) < 0.22;
              yaw =
                (points[1].x - (points[234].x + points[454].x) / 2) /
                Math.max(0.001, Math.abs(points[454].x - points[234].x));
              const aspect = video.videoWidth / video.videoHeight;
              eyesClosed =
                eyeRatio(points, [33, 160, 158, 133, 153, 144], aspect) < 0.21 &&
                eyeRatio(points, [362, 385, 387, 263, 373, 380], aspect) < 0.21;
            }
            const next = challenge.update(
              { faceCount: faces.length, faceOk, yaw, eyesClosed },
              now
            );
            latestFrameAt.current = now;
            latestPassed.current = next.livenessPassed;
            errors = 0;
            setStatus(next);
          } catch {
            challenge.reset();
            latestPassed.current = false;
            errors += 1;
            setStatus({
              ...initialStatus,
              phase: "ready",
              instruction: "Face check interrupted. Keep looking at the camera.",
            });
            if (errors >= 10) {
              stop();
              setStatus({ ...initialStatus, phase: "unsupported", supported: false });
            }
          }
        }, 100);
      } catch {
        if (isCurrent()) setStatus({ ...initialStatus, phase: "unsupported", supported: false });
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    },
    [stop]
  );
  useEffect(() => () => stop(), [stop]);
  return { status, start, stop, reset, canCapture };
}
