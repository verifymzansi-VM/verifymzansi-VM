"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { Camera, Loader2, RefreshCw, ShieldCheck, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  facingMode: "user" | "environment";
  disabled?: boolean;
  cameraStartTimeoutMs?: number;
  telemetryContext?: string;
  /** Called when camera is unavailable and user falls back to file upload */
  onFallback?: () => void;
}

type CameraState = "idle" | "streaming" | "captured" | "error";
const DEFAULT_CAMERA_START_TIMEOUT_MS = 15_000;
const BLOCKED_FOR_SITE_MESSAGE =
  "Camera is blocked for this site. Your browser may not show the camera prompt again until you allow camera access in site settings. Please enable camera permission, then try again, or use the file upload below.";

interface PermissionLookupResult {
  state: PermissionState | null;
  supported: boolean;
  queryFailed: boolean;
}

export function CameraCapture({
  onCapture,
  facingMode,
  disabled = false,
  cameraStartTimeoutMs = DEFAULT_CAMERA_START_TIMEOUT_MS,
  telemetryContext,
  onFallback,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [capturedUrl, setCapturedUrl] = useState<string>("");
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);

  const permissionDescription =
    telemetryContext === "selfie"
      ? "We need to access your camera to capture your selfie. Your photo will be used only for identity verification."
      : telemetryContext === "id_doc"
        ? "We need to access your camera to capture your ID document photo. Your photo will be used only for identity verification."
        : "We need to access your camera to take a photo. Your photo will be used only for identity verification.";

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
            mediaDevicesAvailable: Boolean(navigator.mediaDevices?.getUserMedia),
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
      const status = await navigator.permissions.query({ name: "camera" as PermissionName });
      return { state: status.state, supported: true, queryFailed: false };
    } catch {
      return { state: null, supported: true, queryFailed: true };
    }
  }, []);

  const getUserMediaWithTimeout = useCallback(
    (constraints: MediaStreamConstraints) => {
      return new Promise<MediaStream>((resolve, reject) => {
        let settled = false;
        const timeoutHandle = setTimeout(() => {
          settled = true;
          const timeoutError = new Error("Camera start timed out.");
          timeoutError.name = "TimeoutError";
          reject(timeoutError);
        }, cameraStartTimeoutMs);

        navigator.mediaDevices
          .getUserMedia(constraints)
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
    if (isStartingCamera) {
      return;
    }

    // Guard: mediaDevices API requires a secure context (HTTPS)
    if (!navigator.mediaDevices?.getUserMedia) {
      reportCameraInitFailure("MediaDevicesUnavailable", null);
      setErrorMessage(
        "Camera is not available. Please make sure you are using HTTPS and a modern browser, or use the file upload below."
      );
      setState("error");
      return;
    }

    try {
      setIsStartingCamera(true);
      setState("idle");
      setErrorMessage("");
      stopStream();

      // Pre-check permission for diagnostics only. We still call getUserMedia
      // so the browser always receives a camera access request after user consent.
      await getPermissionState();

      // Try with full constraints first, then progressively relax
      let stream: MediaStream | null = null;
      const constraintSets: MediaStreamConstraints[] = [
        { video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode } },
        { video: true },
      ];

      for (const constraints of constraintSets) {
        try {
          stream = await getUserMediaWithTimeout(constraints);
          break;
        } catch (innerErr) {
          const innerName = innerErr instanceof Error ? innerErr.name : "";
          // Only retry on constraint-related failures
          if (innerName !== "OverconstrainedError" && innerName !== "ConstraintNotSatisfiedError") {
            throw innerErr;
          }
          // Continue to next (relaxed) constraint set
        }
      }

      if (!stream) {
        throw new DOMException("No compatible camera configuration found.", "NotFoundError");
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Explicit play() — mobile browsers often ignore autoPlay attribute
        try {
          await videoRef.current.play();
        } catch {
          // AbortError / NotAllowedError from play() is non-fatal if
          // autoPlay eventually kicks in; we proceed to streaming state.
        }
      }
      setState("streaming");
    } catch (err) {
      stopStream();
      const name = err instanceof Error ? err.name : "";
      const permissionLookup =
        name === "NotAllowedError"
          ? await getPermissionState()
          : {
              state: null,
              supported: Boolean(navigator.permissions?.query),
              queryFailed: false,
            };
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
      setIsStartingCamera(false);
    }
  }, [
    facingMode,
    getPermissionState,
    getUserMediaWithTimeout,
    isStartingCamera,
    reportCameraInitFailure,
    stopStream,
  ]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  // Attach the stream to the <video> element once it mounts.
  // The video element is conditionally rendered (only when state === "streaming"),
  // so srcObject must be set after the re-render, not inline in startCamera().
  useEffect(() => {
    if (state === "streaming" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [state]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Mirror for front camera
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `capture-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        const url = URL.createObjectURL(blob);
        setCapturedUrl(url);
        stopStream();
        setState("captured");
        onCapture(file);
      },
      "image/jpeg",
      0.92
    );
  }, [facingMode, stopStream, onCapture]);

  const retake = useCallback(() => {
    if (capturedUrl) {
      URL.revokeObjectURL(capturedUrl);
      setCapturedUrl("");
    }
    setShowPermissionDialog(true);
  }, [capturedUrl]);

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

  const permissionDialog = (
    <Dialog open={showPermissionDialog} onOpenChange={setShowPermissionDialog}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/40">
            <ShieldCheck className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <DialogTitle className="text-center">Camera Access Required</DialogTitle>
          <DialogDescription className="text-center">{permissionDescription}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              // Keep the getUserMedia request in the same user interaction that
              // confirmed camera access while removing the dialog focus-trap first.
              flushSync(() => {
                setShowPermissionDialog(false);
              });
              void startCamera();
            }}
          >
            <Camera className="mr-2 h-4 w-4" />
            Allow Camera
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setShowPermissionDialog(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (state === "error") {
    return (
      <div className="space-y-3">
        {permissionDialog}
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          <VideoOff className="h-4 w-4 shrink-0" />
          <p>{errorMessage}</p>
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
          variant="outline"
          onClick={() => setShowPermissionDialog(true)}
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
          disabled={disabled}
          className="gap-1"
        >
          <RefreshCw className="h-4 w-4" />
          Retake
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {permissionDialog}
      {state === "idle" && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowPermissionDialog(true)}
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

      {state === "streaming" && (
        <>
          <div className="relative overflow-hidden rounded-md border">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
            />
          </div>
          <Button
            type="button"
            onClick={takePhoto}
            disabled={disabled}
            variant="trust-verified"
            className="w-full gap-2"
          >
            <Camera className="h-4 w-4" />
            Take Photo
          </Button>
        </>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
