"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  facingMode: "user" | "environment";
  disabled?: boolean;
  /** Called when camera is unavailable and user falls back to file upload */
  onFallback?: () => void;
}

type CameraState = "idle" | "streaming" | "captured" | "error";

export function CameraCapture({
  onCapture,
  facingMode,
  disabled = false,
  onFallback,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [capturedUrl, setCapturedUrl] = useState<string>("");

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    // Guard: mediaDevices API requires a secure context (HTTPS)
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage(
        "Camera is not available. Please make sure you are using HTTPS and a modern browser, or use the file upload below."
      );
      setState("error");
      return;
    }

    try {
      setState("idle");
      setErrorMessage("");

      // Try with full constraints first, then progressively relax
      let stream: MediaStream | null = null;
      const constraintSets: MediaStreamConstraints[] = [
        { video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode } },
        { video: true },
      ];

      for (const constraints of constraintSets) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
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
      if (name === "NotAllowedError") {
        setErrorMessage(
          "Camera access was denied. Please allow camera access in your browser settings, or use the file upload below."
        );
      } else if (name === "SecurityError") {
        setErrorMessage(
          "Camera access requires a secure connection (HTTPS). Please use the file upload below."
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
    }
  }, [facingMode, stopStream]);

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
    startCamera();
  }, [capturedUrl, startCamera]);

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
          <p>{errorMessage}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={startCamera}
          disabled={disabled}
          className="w-full gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Try Again
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
      {state === "idle" && (
        <Button
          type="button"
          variant="outline"
          onClick={startCamera}
          disabled={disabled}
          className="w-full gap-2"
        >
          <Camera className="h-4 w-4" />
          Open Camera
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
