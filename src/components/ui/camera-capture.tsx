"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Circle,
  Flashlight,
  Glasses,
  IdCard,
  Loader2,
  RefreshCw,
  ScanFace,
  Smartphone,
  Sun,
  VideoOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFaceLiveness } from "./use-face-liveness";
import { SelfieCameraDialog } from "./selfie-camera-dialog";
import { SelfieFaceGuide } from "./selfie-face-guide";
import {
  analyseFrame,
  cameraProblem,
  isInAppBrowser,
  isPhoneOrTablet,
  PHOTO_LIMITS,
  QUALITY_LIMITS,
  qualityHint,
  scaledSize,
  shouldRetryWithPlainerSettings,
  type CameraProblem,
  type FrameQuality,
} from "./camera-capture-helpers";

interface CameraCaptureProps {
  onCapture: (file: File, meta?: CaptureMeta) => void;
  facingMode: "user" | "environment";
  disabled?: boolean;
  cameraStartTimeoutMs?: number;
  telemetryContext?: string;
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
  /**
   * Offered when this device's camera cannot be used: take the photos on a
   * phone instead. Not shown on a phone or tablet.
   */
  onContinueOnPhone?: () => void;
  /** Tells the page whether the ID photo is being checked (picture 01b). */
  onReviewChange?: (reviewing: boolean) => void;
  /**
   * Asks the server for a capture token when the camera starts; the photo
   * must be sent within 10 minutes of it. Null or an error stops the camera.
   */
  getCaptureToken?: () => Promise<string | null>;
}

export interface CaptureMeta {
  /** True when the in-browser liveness challenge was completed. */
  livenessPassed: boolean;
  /** The capture token issued when this camera started (getCaptureToken). */
  captureToken?: string;
}

type CameraState = "idle" | "streaming" | "review" | "captured" | "error";
const DEFAULT_CAMERA_START_TIMEOUT_MS = 15_000;
const PERMISSION_QUERY_TIMEOUT_MS = 1_000;
const HINT_INTERVAL_MS = 600;

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

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

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
  ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null {
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

const PROBLEM_TEXT: Record<CameraProblem, (subject: string) => { title: string; body: string }> = {
  blocked: (subject) => ({
    title: "Your camera is blocked for VerifyMzansi.",
    body: `We need your camera to ${subject}. Photos from your gallery can't be used.`,
  }),
  none: (subject) => ({
    title: "We can't find a camera on this device.",
    body: `We need a camera to ${subject}. Continue on your phone, or try again.`,
  }),
  busy: () => ({
    title: "Your camera didn't start.",
    body: "Close other apps or tabs using the camera, then try again.",
  }),
  failed: () => ({
    title: "We couldn't start your camera.",
    body: "Please try again.",
  }),
};

const BLOCKED_STEPS = [
  {
    title: "Android (Chrome)",
    text: "Tap the icon left of the web address, then Permissions, then Camera: Allow.",
  },
  {
    title: "iPhone (Safari)",
    text: "Tap “aA” in the address bar, then Website Settings, then Camera: Allow.",
  },
  {
    title: "Inside WhatsApp, Facebook or Instagram",
    text: "Open this page in Chrome or Safari instead: tap ⋮ or the share icon, then “Open in browser”.",
  },
];

export function CameraCapture({
  onCapture,
  facingMode,
  disabled = false,
  cameraStartTimeoutMs = DEFAULT_CAMERA_START_TIMEOUT_MS,
  telemetryContext,
  requireLiveness = false,
  documentGuide = false,
  onReset,
  onContinueOnPhone,
  onReviewChange,
  getCaptureToken,
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
  const reviewFileRef = useRef<File | null>(null);
  const captureTokenRef = useRef<string | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  // A message other than the problem's own title and text (an interruption).
  const [customMessage, setCustomMessage] = useState<string | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string>("");
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [documentFormat, setDocumentFormat] = useState<"card" | "book">("card");
  const [manualCapture, setManualCapture] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [photoQuality, setPhotoQuality] = useState<FrameQuality | null>(null);
  const [inAppBrowser, setInAppBrowser] = useState(false);
  const [onPhone, setOnPhone] = useState(true);

  const {
    status: livenessStatus,
    start: startLiveness,
    stop: stopLiveness,
    reset: resetLiveness,
    canCapture: canCaptureLiveFrame,
  } = useFaceLiveness();

  // Read the browser once after mounting (not during render, so the server
  // and the first client render match).
  useEffect(() => {
    queueMicrotask(() => {
      setInAppBrowser(isInAppBrowser(navigator.userAgent));
      setOnPhone(isPhoneOrTablet(navigator.userAgent));
    });
  }, []);

  useEffect(() => {
    onReviewChange?.(state === "review");
  }, [state, onReviewChange]);

  // A failed model load requires an explicit manual-review choice.
  const livenessActive = requireLiveness && livenessStatus.supported;
  const captureAllowed =
    !requireLiveness ||
    livenessStatus.livenessPassed ||
    (!livenessStatus.supported && manualCapture);
  const subject = documentGuide ? "photograph your ID" : "take your selfie";
  const showPhoneOption = Boolean(onContinueOnPhone) && !onPhone;

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

      // Lazy-load Sentry so the monitoring SDK stays out of this page's
      // critical bundle; telemetry must never block the camera error screen.
      void import("@sentry/nextjs")
        .then((Sentry) => {
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
              inAppBrowser: isInAppBrowser(navigator.userAgent),
              mediaDevicesAvailable: Boolean(getCameraRequest()),
              platform: uaData?.platform ?? navigator.platform ?? "unknown",
              mobile: uaData?.mobile ?? isPhoneOrTablet(navigator.userAgent),
            });
            Sentry.captureMessage("camera_init_failed", "warning");
          });
        })
        .catch(() => {
          // Telemetry should never block the camera error screen.
        });
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
    setTorchAvailable(false);
    setTorchOn(false);
    setHint(null);
  }, []);

  const showProblem = useCallback((kind: CameraProblem, message?: string) => {
    setProblem(kind);
    setCustomMessage(message ?? null);
    setState("error");
  }, []);

  const startCamera = useCallback(async () => {
    if (startingRef.current || disabled) {
      return;
    }

    // Camera APIs need a secure connection and a current browser.
    if (!getCameraRequest()) {
      reportCameraInitFailure("MediaDevicesUnavailable", null);
      showProblem("none");
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
      setCustomMessage(null);
      setProblem(null);
      setManualCapture(false);
      onReset?.();
      stopStream();
      resetLiveness();

      // Try with full constraints first, then progressively relax (silently).
      let stream: MediaStream | null = null;
      // Keep the camera's native field of view. Requesting a portrait width/height
      // pair can make the browser crop a landscape sensor before we even preview it.
      const videoConstraints: MediaTrackConstraints & { resizeMode?: ConstrainDOMString } =
        requireLiveness
          ? { facingMode, width: { ideal: 1280 }, resizeMode: { ideal: "none" } }
          : documentGuide
            ? { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } };
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
          if (!shouldRetryWithPlainerSettings(innerName)) {
            throw innerErr;
          }
        }
      }

      if (!stream) {
        throw new DOMException("No compatible camera configuration found.", "NotFoundError");
      }

      captureTokenRef.current = null;
      if (getCaptureToken) {
        let token: string | null = null;
        try {
          token = await getCaptureToken();
        } catch {
          token = null;
        }
        if (session !== sessionRef.current || !token) {
          stream.getTracks().forEach((track) => track.stop());
          if (session === sessionRef.current)
            showProblem("failed", "We couldn't prepare the camera. Please try again.");
          return;
        }
        captureTokenRef.current = token;
      }
      streamRef.current = stream;
      const [track] = stream.getVideoTracks?.() ?? [];
      const capabilities = track?.getCapabilities?.() as TorchCapabilities | undefined;
      setTorchAvailable(Boolean(documentGuide && capabilities?.torch));
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
      reportCameraInitFailure(
        name || "UnknownCameraError",
        permissionLookup.state,
        permissionLookup
      );
      showProblem(cameraProblem(name));
    } finally {
      if (session === sessionRef.current) {
        startingRef.current = false;
        setIsStartingCamera(false);
      }
    }
  }, [
    facingMode,
    requireLiveness,
    documentGuide,
    getPermissionState,
    getUserMediaWithTimeout,
    disabled,
    reportCameraInitFailure,
    stopStream,
    stopLiveness,
    resetLiveness,
    onReset,
    showProblem,
    getCaptureToken,
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
        showProblem("failed", "Camera playback was interrupted. Please try again.");
      });
      if (requireLiveness) void startLiveness(video);
    },
    [requireLiveness, startLiveness, stopStream, stopLiveness, showProblem]
  );

  useEffect(() => {
    if (state !== "streaming") return;
    const interrupt = () => {
      sessionRef.current += 1;
      stopStream();
      stopLiveness();
      setIsCapturing(false);
      capturingRef.current = false;
      showProblem("failed", "Camera was interrupted. Please try again.");
    };
    const tracks = streamRef.current?.getTracks() ?? [];
    tracks.forEach((track) => track.addEventListener?.("ended", interrupt));
    window.addEventListener("pagehide", closeCamera);
    return () => {
      tracks.forEach((track) => track.removeEventListener?.("ended", interrupt));
      window.removeEventListener("pagehide", closeCamera);
    };
  }, [state, closeCamera, stopStream, stopLiveness, showProblem]);

  // Live hints for the ID photo: light, glare and stillness. They never block
  // the shutter; they are announced politely to screen readers.
  useEffect(() => {
    if (state !== "streaming" || !documentGuide) return;
    const sample = document.createElement("canvas");
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      const { width, height } = scaledSize(video.videoWidth, video.videoHeight, 160);
      sample.width = width;
      sample.height = height;
      const ctx = sample.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      try {
        ctx.drawImage(video, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        setHint(qualityHint(analyseFrame(pixels, width, height)));
      } catch {
        // A frame that cannot be read gives no hint.
      }
    }, HINT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [state, documentGuide]);

  const toggleTorch = useCallback(async () => {
    const [track] = streamRef.current?.getVideoTracks?.() ?? [];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

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

    // The saved photo: the camera's own pixels, long edge capped, as a JPEG
    // drawn on a canvas (it carries no EXIF or location data).
    const { width, height } = scaledSize(
      video.videoWidth,
      video.videoHeight,
      documentGuide ? PHOTO_LIMITS.idLongEdge : PHOTO_LIMITS.selfieLongEdge
    );
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
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
      ctx.drawImage(video, 0, 0, width, height);
      let quality: FrameQuality | null = null;
      if (documentGuide) {
        try {
          const sample = scaledSize(width, height, 320);
          const small = document.createElement("canvas");
          small.width = sample.width;
          small.height = sample.height;
          const smallCtx = small.getContext("2d", { willReadFrequently: true });
          smallCtx?.drawImage(canvas, 0, 0, sample.width, sample.height);
          const pixels = smallCtx?.getImageData(0, 0, sample.width, sample.height).data;
          quality = pixels ? analyseFrame(pixels, sample.width, sample.height) : null;
        } catch {
          quality = null;
        }
      }
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
          if (documentGuide) {
            // The ID photo is checked by the member before it is used (01b).
            reviewFileRef.current = file;
            setPhotoQuality(quality);
            setState("review");
            return;
          }
          setState("captured");
          onCapture(file, {
            livenessPassed: requireLiveness ? livenessStatus.livenessPassed : false,
            captureToken: captureTokenRef.current ?? undefined,
          });
        },
        "image/jpeg",
        PHOTO_LIMITS.jpegQuality
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
    documentGuide,
    livenessStatus,
    captureAllowed,
    livenessActive,
    canCaptureLiveFrame,
  ]);

  // Capture while the fresh, centred frame is eligible; no race to reach a shutter.
  useEffect(() => {
    if (state !== "streaming" || !requireLiveness || !livenessStatus.livenessPassed || captureError)
      return;
    // takePhoto sets capture state; defer it past the synchronous effect body
    // to avoid a cascading render (react-hooks/set-state-in-effect).
    queueMicrotask(() => takePhoto());
  }, [state, requireLiveness, livenessStatus.livenessPassed, takePhoto, captureError]);

  const retake = useCallback(() => {
    if (capturedUrl) {
      URL.revokeObjectURL(capturedUrl);
      setCapturedUrl("");
    }
    reviewFileRef.current = null;
    setPhotoQuality(null);
    resetLiveness();
    void startCamera();
  }, [capturedUrl, startCamera, resetLiveness]);

  const usePhoto = useCallback(() => {
    const file = reviewFileRef.current;
    if (!file) return;
    setState("captured");
    onCapture(file, { livenessPassed: false, captureToken: captureTokenRef.current ?? undefined });
  }, [onCapture]);

  // Cleanup captured object URL
  useEffect(() => {
    return () => {
      if (capturedUrl) {
        URL.revokeObjectURL(capturedUrl);
      }
    };
  }, [capturedUrl]);

  if (state === "error") {
    const text = problem ? PROBLEM_TEXT[problem](subject) : null;
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-brand-gold-300/70 bg-brand-gold-50 p-3.5 text-sm leading-6 text-brand-gold-900 dark:border-brand-gold-400/25 dark:bg-brand-gold-400/10 dark:text-brand-gold-100"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gold-100 dark:bg-brand-gold-400/15"
          >
            <VideoOff className="h-4 w-4" />
          </span>
          <div className="min-w-0 space-y-1">
            {customMessage || !text ? (
              <p>{customMessage ?? "We couldn't start your camera. Please try again."}</p>
            ) : (
              <>
                <p className="font-semibold">{text.title}</p>
                <p>{text.body}</p>
              </>
            )}
          </div>
        </div>
        {problem === "blocked" && (
          <ul className="space-y-3">
            {(inAppBrowser
              ? [BLOCKED_STEPS[2], BLOCKED_STEPS[0], BLOCKED_STEPS[1]]
              : BLOCKED_STEPS
            ).map((item) => (
              <li key={item.title} className="rounded-2xl border border-border bg-card p-3.5">
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{item.text}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2.5">
          <Button
            type="button"
            ref={openButtonRef}
            variant={problem === "none" && showPhoneOption ? "outline" : "trust-verified"}
            size="lg"
            onClick={() => void startCamera()}
            disabled={disabled || isStartingCamera}
            className={cn("w-full", problem === "none" && showPhoneOption && "order-2")}
          >
            {isStartingCamera ? (
              <Loader2
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            {isStartingCamera ? "Trying..." : "Try the camera again"}
          </Button>
          {showPhoneOption && (
            <Button
              type="button"
              variant={problem === "none" ? "trust-verified" : "outline"}
              size="lg"
              onClick={onContinueOnPhone}
              disabled={disabled}
              className="w-full"
            >
              <Smartphone className="h-4 w-4" aria-hidden="true" />
              Continue on your phone
            </Button>
          )}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Still stuck? See{" "}
          <Link
            href="/help/verification"
            className="font-semibold text-foreground underline underline-offset-2"
          >
            verification help
          </Link>
          .
        </p>
      </div>
    );
  }

  if (state === "review" && capturedUrl) {
    const checks: { label: string; ok: boolean | null }[] = [
      { label: "All four corners in view", ok: null },
      {
        label: "Sharp enough to read",
        ok: photoQuality ? photoQuality.sharpness >= QUALITY_LIMITS.blurry : null,
      },
      {
        label: "No strong glare",
        ok: photoQuality ? photoQuality.glare <= QUALITY_LIMITS.glare : null,
      },
    ];
    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capturedUrl} alt="Your ID photo" className="max-h-80 w-full object-contain" />
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand-green-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Photo taken
          </span>
        </div>
        <ul className="space-y-1.5 text-sm">
          {checks.map(({ label, ok }) => (
            <li key={label} className="flex items-center gap-2 text-foreground/85">
              {ok === false ? (
                <AlertTriangle
                  className="h-4 w-4 shrink-0 text-brand-gold-700 dark:text-brand-gold-300"
                  aria-hidden="true"
                />
              ) : ok ? (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-brand-green-700 dark:text-brand-gold-300"
                  aria-hidden="true"
                />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span>
                {ok === false
                  ? label === "Sharp enough to read"
                    ? "Looks blurry: retake it"
                    : "Strong glare: retake it"
                  : label}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-5 text-muted-foreground">
          Can you read your name and ID number in the photo? If not, retake it.
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={retake}
            ref={openButtonRef}
            disabled={disabled}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retake
          </Button>
          <Button
            type="button"
            variant="trust-verified"
            size="lg"
            onClick={usePhoto}
            disabled={disabled}
          >
            Use this photo
          </Button>
        </div>
      </div>
    );
  }

  if (state === "captured" && capturedUrl) {
    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capturedUrl} alt="Captured photo" className="max-h-80 w-full object-contain" />
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand-green-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Photo captured
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={retake}
          ref={openButtonRef}
          disabled={disabled}
          className="h-11 w-full sm:w-auto"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
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
          <Loader2 className="h-8 w-8 animate-spin motion-reduce:animate-none" aria-hidden />
          <p className="text-center text-sm">
            Opening camera... Allow camera access when prompted.
          </p>
        </div>
      )}
      {state === "streaming" && (
        <>
          <div
            ref={streamContainerRef}
            className={
              requireLiveness
                ? "relative min-h-[180px] flex-1 overflow-hidden bg-black [@media(max-height:500px)]:min-h-0 [@media(max-height:500px)]:h-full"
                : "relative scroll-mt-32 overflow-hidden rounded-2xl border border-border bg-black"
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
                <span className="absolute left-3 top-2 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-semibold text-white">
                  {documentFormat === "card" ? "Smart ID card, front" : "ID book, photo page"}
                </span>
              </div>
            )}
            {documentGuide && (
              <p
                className={cn(
                  "absolute inset-x-0 bottom-2 mx-auto flex w-fit max-w-[90%] items-center gap-1.5 rounded-full bg-brand-gold-50 px-3 py-1 text-xs font-medium text-brand-gold-900 shadow-sm",
                  !hint && "sr-only"
                )}
                role="status"
                aria-live="polite"
              >
                {hint && <Sun className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                {hint ?? ""}
              </p>
            )}
            {requireLiveness && (
              <SelfieFaceGuide videoRef={videoRef} passed={livenessStatus.livenessPassed} />
            )}
          </div>
          <div
            className={
              requireLiveness
                ? "shrink-0 space-y-3 bg-[#07130f] px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] [@media(max-height:500px)]:min-h-0 [@media(max-height:500px)]:overflow-y-auto"
                : "space-y-3"
            }
          >
            {livenessActive && (
              <div className="mx-auto max-w-md text-center">
                <div className="mb-3 flex justify-center gap-2" aria-hidden="true">
                  {[0, 1].map((step) => (
                    <span
                      key={step}
                      className={cn(
                        "h-1.5 w-16 rounded-full transition-colors duration-300",
                        livenessStatus.completedSteps > step ? "bg-brand-green-400" : "bg-white/20"
                      )}
                    />
                  ))}
                </div>
                <p className="text-xs font-semibold text-brand-green-300">
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
                <p className="mt-1 text-xs text-white/70">
                  Keep your face inside the oval in even light.
                </p>
              </div>
            )}
            {requireLiveness && !livenessStatus.supported && (
              <div
                className="rounded-2xl border border-brand-gold-300/40 bg-brand-gold-400/10 p-3.5 text-xs leading-5 text-brand-gold-100"
                role="status"
              >
                <p>
                  The live face check could not run. Retry first, or take a photo for manual review.
                  A photo alone cannot confirm liveness.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
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
                    variant="outline"
                    className="h-11 border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                    disabled={disabled || manualCapture}
                    onClick={() => setManualCapture(true)}
                  >
                    Use manual review
                  </Button>
                </div>
              </div>
            )}
            <div className="flex gap-2.5">
              {torchAvailable && (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  aria-pressed={torchOn}
                  aria-label={torchOn ? "Turn the light off" : "Turn the light on"}
                  onClick={() => void toggleTorch()}
                  disabled={disabled}
                  className="w-12 shrink-0 px-0"
                >
                  <Flashlight className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
              <Button
                type="button"
                ref={takePhotoButtonRef}
                onClick={takePhoto}
                disabled={disabled || !captureAllowed || isCapturing}
                variant="trust-verified"
                size="lg"
                className="w-full"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                {isCapturing
                  ? "Saving photo..."
                  : requireLiveness && !captureAllowed
                    ? "Complete liveness check"
                    : manualCapture
                      ? "Take photo for manual review"
                      : "Take photo"}
              </Button>
            </div>
            {documentGuide && (
              <p className="text-xs leading-5 text-muted-foreground">
                Lay the card on a dark, flat surface in good light. Fill the frame and keep all four
                corners in view.
              </p>
            )}
            {captureError && (
              <p
                role="alert"
                className={cn(
                  "text-center text-sm",
                  requireLiveness ? "text-brand-red-300" : "text-destructive"
                )}
              >
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
      {documentGuide && state === "idle" && !isStartingCamera && (
        <fieldset className="space-y-2" disabled={disabled}>
          <legend className="mb-2 text-sm font-medium text-foreground">
            Which ID do you have?
          </legend>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            {(["card", "book"] as const).map((format) => (
              <Button
                key={format}
                type="button"
                variant="ghost"
                aria-pressed={documentFormat === format}
                onClick={() => setDocumentFormat(format)}
                className={cn(
                  "h-11 rounded-lg",
                  documentFormat === format
                    ? "bg-card text-foreground shadow-sm hover:bg-card"
                    : "text-muted-foreground"
                )}
              >
                {format === "card" ? "Smart ID card" : "Green ID book"}
              </Button>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {documentFormat === "card" ? "Photo side up." : "Open at the photo page."} Fit all four
            corners in the guide and avoid glare.
          </p>
        </fieldset>
      )}
      {state === "idle" && inAppBrowser && (
        <p
          role="note"
          className="rounded-2xl border border-brand-gold-300/70 bg-brand-gold-50 p-3.5 text-xs leading-5 text-brand-gold-900 dark:border-brand-gold-400/25 dark:bg-brand-gold-400/10 dark:text-brand-gold-100"
        >
          You&apos;re inside an app such as WhatsApp, Facebook or Instagram, which may block the
          camera. If it doesn&apos;t open, open this page in Chrome or Safari: tap ⋮ or the share
          icon, then &ldquo;Open in browser&rdquo;.
        </p>
      )}
      {state === "idle" && (
        <div className="rounded-2xl border-2 border-dashed border-border bg-muted/30 p-4 sm:p-5">
          {requireLiveness ? (
            <ul className="mb-4 space-y-2.5 text-sm text-foreground/85">
              {[
                { icon: Sun, text: "Good, even light" },
                {
                  icon: Glasses,
                  text: "No sunglasses or hats",
                },
                { icon: ScanFace, text: "Follow two short moves. We snap the photo." },
              ].map(({ icon: TipIcon, text }) => (
                <li key={text} className="flex items-start gap-2.5">
                  <TipIcon
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-green-700 dark:text-brand-gold-300"
                    aria-hidden="true"
                  />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mb-4 flex items-center gap-3 text-sm text-muted-foreground">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card text-brand-green-700 dark:text-brand-gold-300"
              >
                {documentGuide ? <IdCard className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
              </span>
              <span>
                {documentGuide
                  ? "Lay your ID flat in good light."
                  : "Use your camera to take the photo."}
              </span>
            </div>
          )}
          <Button
            type="button"
            ref={openButtonRef}
            variant="trust-verified"
            size="lg"
            onClick={() => void startCamera()}
            disabled={disabled || isStartingCamera}
            className="w-full"
          >
            {isStartingCamera ? (
              <Loader2
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Camera className="h-4 w-4" aria-hidden="true" />
            )}
            {isStartingCamera ? "Opening camera..." : "Open camera"}
          </Button>
        </div>
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
