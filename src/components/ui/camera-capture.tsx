"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { Camera, Loader2, RefreshCw, ScanFace, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFaceLiveness } from "./use-face-liveness";
import { SelfieCameraDialog } from "./selfie-camera-dialog";
import { SelfieFaceGuide } from "./selfie-face-guide";

interface CameraCaptureProps {
  onCapture: (file: File, meta?: CaptureMeta) => void;
  facingMode: "user" | "environment";
  disabled?: boolean;
  cameraStartTimeoutMs?: number;
  telemetryContext?: string;
  /** Called when camera is unavailable and user falls back to file upload */
  onFallback?: () => void;
  /**
   * When true, an in-browser active-liveness challenge (blink / head turn)
   * must be completed before the "Take Photo" button is enabled. Use for the
   * selfie step. If the model cannot load, the user can explicitly choose a
   * plain photo for manual review; it is never labelled as a passed check.
   */
  requireLiveness?: boolean;
  documentGuide?: boolean;
  /** Clear the previous submission when a new capture starts. */
  onReset?: () => void;
}

export interface CaptureMeta {
  /** True when the in-browser liveness challenge was completed. */
  livenessPassed: boolean;
}

type CameraState = "idle" | "streaming" | "captured" | "error";
const DEFAULT_CAMERA_START_TIMEOUT_MS = 15_000;
const PERMISSION_QUERY_TIMEOUT_MS = 1_000;
const BLOCKED_FOR_SITE_MESSAGE =
  "Camera is blocked for this site. Your browser may not show the camera prompt again until you allow camera access in site settings. Please enable camera permission, then try again, or use the file upload below.";

interface PermissionLookupResult {
  state: PermissionState | null;
  supported: boolean;
  queryFailed: boolean;
}

type LegacyGetUserMedia = (
  constraints: MediaStreamConstraints,
  onSuccess: (stream: MediaStream) => void,
  onError: (error: unknown) => void
) => void;

type CameraNavigator = Navigator & {
  getUserMedia?: LegacyGetUserMedia;
  webkitGetUserMedia?: LegacyGetUserMedia;
  mozGetUserMedia?: LegacyGetUserMedia;
  msGetUserMedia?: LegacyGetUserMedia;
};

function shouldTryRelaxedCameraConstraints(errorName: string): boolean {
  return [
    "OverconstrainedError",
    "ConstraintNotSatisfiedError",
    "NotFoundError",
    "DevicesNotFoundError",
  ].includes(errorName);
}

function getCameraErrorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  if (error && typeof error === "object" && "name" in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }

  return "";
}

function getCameraRequest():
  | ((constraints: MediaStreamConstraints) => Promise<MediaStream>)
  | null {
  if (navigator.mediaDevices?.getUserMedia) {
    return (constraints) => navigator.mediaDevices.getUserMedia(constraints);
  }

  const cameraNavigator = navigator as CameraNavigator;
  const legacyGetUserMedia =
    cameraNavigator.getUserMedia ??
    cameraNavigator.webkitGetUserMedia ??
    cameraNavigator.mozGetUserMedia ??
    cameraNavigator.msGetUserMedia;

  if (!legacyGetUserMedia) {
    return null;
  }

  return (constraints) =>
    new Promise<MediaStream>((resolve, reject) => {
      legacyGetUserMedia.call(navigator, constraints, resolve, reject);
    });
}

export function CameraCapture({
  onCapture,
  facingMode,
  disabled = false,
  cameraStartTimeoutMs = DEFAULT_CAMERA_START_TIMEOUT_MS,
  telemetryContext,
  onFallback,
  requireLiveness = false,
  documentGuide = false,
  onReset,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef(0);
  const startingRef = useRef(false);
  const capturingRef = useRef(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const streamContainerRef = useRef<HTMLDivElement>(null);
  const takePhotoButtonRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [capturedUrl, setCapturedUrl] = useState<string>("");
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [documentFormat, setDocumentFormat] = useState<"card" | "book">("card");
  const [manualCapture, setManualCapture] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState("");

  const {
    status: livenessStatus,
    start: startLiveness,
    stop: stopLiveness,
    reset: resetLiveness,
    canCapture: canCaptureLiveFrame,
  } = useFaceLiveness();

  // A failed model load requires an explicit manual-review choice.
  const livenessActive = requireLiveness && livenessStatus.supported;
  const captureAllowed =
    !requireLiveness ||
    livenessStatus.livenessPassed ||
    (!livenessStatus.supported && manualCapture);

  const reportCameraInitFailure = useCallback(
    (
      errorName: string,
      permissionState: PermissionState | null,
      permissionLookup?: PermissionLookupResult
    ) => {
      const uaData = (
        navigator as Navigator & {
          userAgentData?: { platform?: string; mobile?: boolean };
        }
      ).userAgentData;

      let topLevelFrame: boolean | "unknown" = "unknown";
      try {
        topLevelFrame = window.top === window.self;
      } catch {
        topLevelFrame = "unknown";
      }

      try {
        Sentry.withScope((scope) => {
          scope.setTag("feature", "verification_camera");
          scope.setTag("camera_error", errorName || "unknown");
          scope.setContext("camera_init", {
            errorName: errorName || "unknown",
            permissionState: permissionState ?? "unknown",
            permissionApiSupported:
              permissionLookup?.supported ?? Boolean(navigator.permissions?.query),
            permissionQueryFailed: permissionLookup?.queryFailed ?? false,
            telemetryContext: telemetryContext ?? "unknown",
            facingMode,
            isSecureContext,
            topLevelFrame,
            mediaDevicesAvailable: Boolean(getCameraRequest()),
            platform: uaData?.platform ?? navigator.platform ?? "unknown",
            mobile: uaData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
          });
          Sentry.captureMessage("camera_init_failed", "warning");
        });
      } catch {
        // Telemetry should never block camera fallback UX.
      }
    },
    [facingMode, telemetryContext]
  );

  const getPermissionState = useCallback(async (): Promise<PermissionLookupResult> => {
    if (!navigator.permissions?.query) {
      return { state: null, supported: false, queryFailed: false };
    }

    try {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error("Camera permission lookup timed out."));
        }, PERMISSION_QUERY_TIMEOUT_MS);
      });
      const status = await Promise.race([
        navigator.permissions.query({ name: "camera" as PermissionName }),
        timeoutPromise,
      ]).finally(() => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      });
      return { state: status.state, supported: true, queryFailed: false };
    } catch {
      return { state: null, supported: true, queryFailed: true };
    }
  }, []);

  const getUserMediaWithTimeout = useCallback(
    (constraints: MediaStreamConstraints) => {
      return new Promise<MediaStream>((resolve, reject) => {
        const requestCamera = getCameraRequest();
        if (!requestCamera) {
          const unavailableError = new Error("Camera API is unavailable.");
          unavailableError.name = "MediaDevicesUnavailable";
          reject(unavailableError);
          return;
        }

        let settled = false;
        const timeoutHandle = setTimeout(() => {
          settled = true;
          const timeoutError = new Error("Camera start timed out.");
          timeoutError.name = "TimeoutError";
          reject(timeoutError);
        }, cameraStartTimeoutMs);

        let cameraPromise: Promise<MediaStream>;
        try {
          cameraPromise = requestCamera(constraints);
        } catch (error) {
          clearTimeout(timeoutHandle);
          settled = true;
          reject(error);
          return;
        }

        cameraPromise
          .then((stream) => {
            clearTimeout(timeoutHandle);
            if (settled) {
              // If timeout already rejected this attempt, immediately release
              // the late stream to avoid camera lock on the device.
              for (const track of stream.getTracks()) {
                track.stop();
              }
              return;
            }
            settled = true;
            resolve(stream);
          })
          .catch((error: unknown) => {
            clearTimeout(timeoutHandle);
            if (settled) return;
            settled = true;
            reject(error);
          });
      });
    },
    [cameraStartTimeoutMs]
  );

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (startingRef.current || disabled) {
      return;
    }

    // Guard: camera APIs require a secure context in modern browsers.
    if (!getCameraRequest()) {
      reportCameraInitFailure("MediaDevicesUnavailable", null);
      setErrorMessage(
        "Camera is not available. Please make sure you are using HTTPS and a modern browser, or use the file upload below."
      );
      setState("error");
      return;
    }

    const session = ++sessionRef.current;
    startingRef.current = true;
    capturingRef.current = false;
    setIsCapturing(false);
    setCaptureError("");
    try {
      setIsStartingCamera(true);
      setState("idle");
      setErrorMessage("");
      setManualCapture(false);
      onReset?.();
      stopStream();
      resetLiveness();

      // Try with full constraints first, then progressively relax
      let stream: MediaStream | null = null;
      // Keep the camera's native field of view. Requesting a portrait width/height
      // pair can make the browser crop a landscape sensor before we even preview it.
      const videoConstraints: MediaTrackConstraints & { resizeMode?: ConstrainDOMString } = {
        facingMode,
        width: { ideal: 1280 },
        ...(requireLiveness ? { resizeMode: { ideal: "none" } } : { height: { ideal: 720 } }),
      };
      const constraintSets: MediaStreamConstraints[] = [
        { video: videoConstraints },
        { video: { facingMode } },
        { video: true },
      ];

      for (const constraints of constraintSets) {
        try {
          stream = await getUserMediaWithTimeout(constraints);
          if (session !== sessionRef.current) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          break;
        } catch (innerErr) {
          if (session !== sessionRef.current) return;
          const innerName = getCameraErrorName(innerErr);
          if (!shouldTryRelaxedCameraConstraints(innerName)) {
            throw innerErr;
          }
        }
      }

      if (!stream) {
        throw new DOMException("No compatible camera configuration found.", "NotFoundError");
      }

      streamRef.current = stream;
      setState("streaming");
    } catch (err) {
      if (session !== sessionRef.current) return;
      stopStream();
      stopLiveness();
      const name = getCameraErrorName(err);
      const permissionLookup =
        name === "NotAllowedError"
          ? await getPermissionState()
          : {
              state: null,
              supported: Boolean(navigator.permissions?.query),
              queryFailed: false,
            };
      if (session !== sessionRef.current) return;
      const permissionState = permissionLookup.state;

      reportCameraInitFailure(name || "UnknownCameraError", permissionState, permissionLookup);

      if (name === "NotAllowedError") {
        if (permissionState === "denied") {
          setErrorMessage(BLOCKED_FOR_SITE_MESSAGE);
        } else {
          setErrorMessage(
            "Camera access was denied. Please allow camera access in your browser settings, or use the file upload below."
          );
        }
      } else if (name === "SecurityError") {
        setErrorMessage(
          "Camera access requires a secure connection (HTTPS). Please use the file upload below."
        );
      } else if (name === "TimeoutError") {
        setErrorMessage(
          "Camera took too long to start. Please close other apps using the camera and try again, or use the file upload below."
        );
      } else if (name === "NotFoundError" || name === "NotReadableError") {
        setErrorMessage("No camera found on this device. Please use the file upload below.");
      } else if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
        setErrorMessage(
          "Your camera does not support the required settings. Please use the file upload below."
        );
      } else if (name === "AbortError") {
        setErrorMessage("Camera was interrupted. Please try again or use the file upload below.");
      } else {
        setErrorMessage("Could not start camera. Please use the file upload below.");
      }
      setState("error");
    } finally {
      if (session === sessionRef.current) {
        startingRef.current = false;
        setIsStartingCamera(false);
      }
    }
  }, [
    facingMode,
    requireLiveness,
    getPermissionState,
    getUserMediaWithTimeout,
    disabled,
    reportCameraInitFailure,
    stopStream,
    stopLiveness,
    resetLiveness,
    onReset,
  ]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      sessionRef.current += 1;
      startingRef.current = false;
      stopStream();
    };
  }, [stopStream]);

  const closeCamera = useCallback(() => {
    sessionRef.current += 1;
    startingRef.current = false;
    capturingRef.current = false;
    stopStream();
    resetLiveness();
    setIsStartingCamera(false);
    setIsCapturing(false);
    setState("idle");
  }, [stopStream, resetLiveness]);

  // Portal content mounts after the parent effects. Attach directly when the video mounts.
  const attachVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      videoRef.current = video;
      if (!video || !streamRef.current) return;
      const session = sessionRef.current;
      video.srcObject = streamRef.current;
      void video.play().catch(() => {
        if (session !== sessionRef.current) return;
        stopStream();
        stopLiveness();
        setErrorMessage("Camera playback was interrupted. Please try again.");
        setState("error");
      });
      if (requireLiveness) void startLiveness(video);
    },
    [requireLiveness, startLiveness, stopStream, stopLiveness]
  );

  useEffect(() => {
    if (state !== "streaming") return;
    const interrupt = () => {
      sessionRef.current += 1;
      stopStream();
      stopLiveness();
      setIsCapturing(false);
      capturingRef.current = false;
      setErrorMessage("Camera was interrupted. Please try again.");
      setState("error");
    };
    const tracks = streamRef.current?.getTracks() ?? [];
    tracks.forEach((track) => track.addEventListener?.("ended", interrupt));
    window.addEventListener("pagehide", closeCamera);
    return () => {
      tracks.forEach((track) => track.removeEventListener?.("ended", interrupt));
      window.removeEventListener("pagehide", closeCamera);
    };
  }, [state, closeCamera, stopStream, stopLiveness]);

  // Bring the camera frame into view as soon as streaming starts so the user
  // never has to scroll to find it (the "Open Camera" button can sit low on
  // the page, and the video + capture button render below the fold).
  // block:"start" + scroll-margin keeps the frame right under the sticky
  // header — block:"center" gets clamped when the capture card sits near the
  // bottom of a short page, leaving the frame cut off.
  // The scroll must wait for loadedmetadata: before that the video has zero
  // height, so the browser clamps the scroll to a too-short page and the
  // expanded frame ends up below the fold.
  useEffect(() => {
    if (state !== "streaming" || requireLiveness) return;

    const container = streamContainerRef.current;
    const video = videoRef.current;
    if (!container) return;

    const scrollToFrame = () => {
      container.scrollIntoView({ behavior: "smooth", block: "start" });
      // Move keyboard/screen-reader focus to the capture control without an
      // extra scroll jump.
      takePhotoButtonRef.current?.focus({ preventScroll: true });
    };

    if (video && video.readyState < 1) {
      video.addEventListener("loadedmetadata", scrollToFrame, { once: true });
      return () => video.removeEventListener("loadedmetadata", scrollToFrame);
    }

    scrollToFrame();
  }, [state, requireLiveness]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || disabled || capturingRef.current || document.hidden) return;

    // Guard against capturing before the stream has produced a frame —
    // otherwise a blank 0x0 image would be uploaded as the "photo".
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
      return;
    }

    // When liveness is active, only allow capture once the challenge passed.
    if (!captureAllowed || (livenessActive && !canCaptureLiveFrame())) {
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCaptureError("Could not prepare your photo. Close the camera and try again.");
      return;
    }

    const session = sessionRef.current;
    capturingRef.current = true;
    setIsCapturing(true);
    setCaptureError("");

    try {
      // Mirror only the preview. Save original camera pixels for ID comparison.
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (session !== sessionRef.current) return;
          capturingRef.current = false;
          setIsCapturing(false);
          if (!blob || blob.size === 0) {
            setCaptureError("Could not save your photo. Please try taking it again.");
            return;
          }
          const file = new File([blob], `capture-${Date.now()}.jpg`, {
            type: "image/jpeg",
          });
          const url = URL.createObjectURL(blob);
          setCapturedUrl(url);
          stopStream();
          stopLiveness();
          setState("captured");
          onCapture(file, {
            livenessPassed: requireLiveness ? livenessStatus.livenessPassed : false,
          });
        },
        "image/jpeg",
        0.92
      );
    } catch {
      capturingRef.current = false;
      setIsCapturing(false);
      setCaptureError("Could not save your photo. Please try taking it again.");
    }
  }, [
    disabled,
    stopStream,
    stopLiveness,
    onCapture,
    requireLiveness,
    livenessStatus,
    captureAllowed,
    livenessActive,
    canCaptureLiveFrame,
  ]);

  // Capture while the fresh, centred frame is eligible; no race to reach a shutter.
  useEffect(() => {
    if (state !== "streaming" || !requireLiveness || !livenessStatus.livenessPassed || captureError)
      return;
    takePhoto();
  }, [state, requireLiveness, livenessStatus.livenessPassed, takePhoto, captureError]);

  const retake = useCallback(() => {
    if (capturedUrl) {
      URL.revokeObjectURL(capturedUrl);
      setCapturedUrl("");
    }
    resetLiveness();
    void startCamera();
  }, [capturedUrl, startCamera, resetLiveness]);

  const handleFileFallback = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onCapture(file);
        onFallback?.();
      }
    },
    [onCapture, onFallback]
  );

  // Cleanup captured object URL
  useEffect(() => {
    return () => {
      if (capturedUrl) {
        URL.revokeObjectURL(capturedUrl);
      }
    };
  }, [capturedUrl]);

  if (state === "error") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          <VideoOff className="h-4 w-4 shrink-0" />
          <p role="alert">{errorMessage}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          No camera prompt? Open{" "}
          <Link href="/help/verification" className="underline">
            verification help
          </Link>{" "}
          for desktop and mobile permission reset steps.
        </p>
        <Button
          type="button"
          ref={openButtonRef}
          variant="outline"
          onClick={() => void startCamera()}
          disabled={disabled || isStartingCamera}
          className="w-full gap-2"
        >
          {isStartingCamera ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isStartingCamera ? "Trying..." : "Try Again"}
        </Button>
        <div className="space-y-2">
          {requireLiveness && (
            <p className="text-xs text-muted-foreground">
              Uploading a file does not complete the live face check. A moderator may ask you to try
              again on another device.
            </p>
          )}
          <Input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled}
            onChange={handleFileFallback}
          />
        </div>
      </div>
    );
  }

  if (state === "captured" && capturedUrl) {
    return (
      <div className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={capturedUrl}
          alt="Captured photo"
          className="max-h-80 w-full rounded-md border object-contain"
        />
        <Button
          type="button"
          variant="outline"
          onClick={retake}
          ref={openButtonRef}
          disabled={disabled}
          className="gap-1"
        >
          <RefreshCw className="h-4 w-4" />
          Retake
        </Button>
      </div>
    );
  }

  const cameraContent = (
    <>
      {isStartingCamera && (
        <div
          className="col-span-2 flex flex-1 flex-col items-center justify-center gap-4 p-6"
          role="status"
        >
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
          <p>Opening camera... Allow camera access when prompted.</p>
        </div>
      )}
      {state === "streaming" && (
        <>
          <div
            ref={streamContainerRef}
            className={
              requireLiveness
                ? "relative min-h-[180px] flex-1 overflow-hidden bg-black [@media(max-height:500px)]:min-h-0 [@media(max-height:500px)]:h-full"
                : "relative scroll-mt-24 overflow-hidden rounded-xl border bg-black"
            }
          >
            <video
              ref={attachVideo}
              autoPlay
              playsInline
              muted
              className={`${requireLiveness ? "absolute inset-0 h-full w-full object-contain" : "w-full"} ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
            />
            {documentGuide && (
              <div className="pointer-events-none absolute inset-0 p-6" aria-hidden="true">
                <svg
                  className="h-full w-full overflow-visible"
                  viewBox={documentFormat === "card" ? "0 0 856 540" : "0 0 540 750"}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <rect
                    x="2"
                    y="2"
                    width={documentFormat === "card" ? 852 : 536}
                    height={documentFormat === "card" ? 536 : 746}
                    rx="20"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <span className="absolute left-3 top-2 rounded bg-black/80 px-2 py-0.5 text-[10px] font-medium text-white">
                  {documentFormat === "card" ? "SMART ID · FRONT" : "ID BOOK · PHOTO PAGE"}
                </span>
              </div>
            )}
            {requireLiveness && (
              <SelfieFaceGuide videoRef={videoRef} passed={livenessStatus.livenessPassed} />
            )}
          </div>
          <div
            className={
              requireLiveness
                ? "shrink-0 space-y-3 bg-slate-950 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] [@media(max-height:500px)]:min-h-0 [@media(max-height:500px)]:overflow-y-auto"
                : "space-y-3"
            }
          >
            {livenessActive && (
              <div className="mx-auto max-w-md text-center">
                <div className="mb-3 flex justify-center gap-2" aria-hidden="true">
                  {[0, 1].map((step) => (
                    <span
                      key={step}
                      className={`h-1.5 w-16 rounded-full ${livenessStatus.completedSteps > step ? "bg-emerald-400" : "bg-slate-600"}`}
                    />
                  ))}
                </div>
                <p className="text-xs uppercase tracking-wider text-emerald-300">
                  {livenessStatus.phase === "loading"
                    ? "Getting ready"
                    : `Movement ${Math.min((livenessStatus.completedSteps ?? 0) + 1, 2)} of 2`}
                </p>
                <p
                  className="mt-2 flex min-h-12 items-center justify-center gap-2 text-base font-medium"
                  role="status"
                  aria-live="polite"
                >
                  <ScanFace className="h-5 w-5 shrink-0" aria-hidden />
                  {livenessStatus.instruction}
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  Keep your face inside the oval in even light.
                </p>
              </div>
            )}
            {requireLiveness && !livenessStatus.supported && (
              <div
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                role="status"
              >
                <p>
                  The live face check could not run. Retry first, or take a photo for manual review.
                  A photo alone cannot confirm liveness.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      setManualCapture(false);
                      if (videoRef.current) void startLiveness(videoRef.current);
                    }}
                  >
                    Retry face check
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled || manualCapture}
                    onClick={() => setManualCapture(true)}
                  >
                    Use manual review
                  </Button>
                </div>
              </div>
            )}
            <Button
              type="button"
              ref={takePhotoButtonRef}
              onClick={takePhoto}
              disabled={disabled || !captureAllowed || isCapturing}
              variant="trust-verified"
              className="w-full gap-2"
            >
              <Camera className="h-4 w-4" />
              {isCapturing
                ? "Saving photo..."
                : requireLiveness && !captureAllowed
                  ? "Complete Liveness Check"
                  : manualCapture
                    ? "Take Photo for Manual Review"
                    : "Take Photo"}
            </Button>
            {captureError && (
              <p role="alert" className="text-center text-sm text-red-300">
                {captureError}
              </p>
            )}
          </div>
        </>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      {documentGuide && (
        <fieldset className="space-y-2" disabled={disabled}>
          <legend className="mb-2 text-sm font-medium">South African ID format</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["card", "book"] as const).map((format) => (
              <Button
                key={format}
                type="button"
                variant={documentFormat === format ? "default" : "outline"}
                aria-pressed={documentFormat === format}
                onClick={() => setDocumentFormat(format)}
              >
                {format === "card" ? "Smart ID card" : "Green ID book"}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {documentFormat === "card"
              ? "Use the front of your Smart ID card, with your photo and details visible."
              : "Open your green ID book to the page with your photo and personal details."}{" "}
            Fit all four corners inside the guide. Avoid glare and keep every detail readable.
          </p>
        </fieldset>
      )}
      {requireLiveness && state === "idle" && (
        <p className="text-sm text-muted-foreground">
          Use good light, remove sunglasses and keep your whole face visible. Follow two short
          movements, then look straight at the camera. We will take your photo automatically. Your
          selfie will be reviewed with your ID.
        </p>
      )}
      {state === "idle" && (
        <Button
          type="button"
          ref={openButtonRef}
          variant="outline"
          onClick={() => void startCamera()}
          disabled={disabled || isStartingCamera}
          className="w-full gap-2"
        >
          {isStartingCamera ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          {isStartingCamera ? "Opening Camera..." : "Open Camera"}
        </Button>
      )}

      {requireLiveness && (state === "streaming" || isStartingCamera) ? (
        <SelfieCameraDialog
          onClose={closeCamera}
          onRestoreFocus={() => openButtonRef.current?.focus()}
        >
          {cameraContent}
        </SelfieCameraDialog>
      ) : (
        cameraContent
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
