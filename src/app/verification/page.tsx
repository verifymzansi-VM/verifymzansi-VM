"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock3,
  FileCheck,
  Loader2,
  MapPin,
  Phone,
  ShieldCheck,
  Navigation,
  AlertTriangle,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { PageHeader } from "@/components/layout/page-header";
import { VerificationProgress } from "@/components/trust/verification-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  validateSaIdChecksum,
  extractDobFromSaId,
  extractGenderFromSaId,
  isUnder18FromSaId,
} from "@/lib/utils/sa-id-validation";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { formatPhone } from "@/lib/utils/format";
import type {
  VerificationStepType,
  LocationConfidence,
  VerificationStatus,
  AccountVerificationStatus,
} from "@/types/enums";
import { GPS_REQUEST_TIMEOUT_MS } from "@/lib/constants/verification";
import {
  VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE,
  VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
  isVerificationEmailConfirmationRequired,
} from "@/lib/constants/verification-email-confirmation";
import { LocationSelector } from "@/components/ui/location-selector";
import { CameraCapture } from "@/components/ui/camera-capture";
import { isValidSaPhone, sanitizeSaPhoneInput } from "@/lib/utils/phone";

type WizardStep = "phone" | "id_doc" | "selfie" | "location" | "complete";
type UploadReceipt = { name: string; sizeBytes: number; uploadedAtIso: string };
type StepStatusEntry = {
  step_type: VerificationStepType;
  status: VerificationStatus;
  reviewed_at?: string | null;
  reason_code?: string | null;
  reason_note?: string | null;
  risk_level?: string | null;
  submitted_at?: string | null;
  location_method?: string | null;
  location_province?: string | null;
  location_city?: string | null;
  location_town?: string | null;
  gps_mismatch?: {
    province: boolean;
    city: boolean;
  } | null;
  gps_resolved_province?: string | null;
  gps_resolved_city?: string | null;
  gps_confidence?: string | null;
};

const STEP_ORDER: Exclude<WizardStep, "complete">[] = ["phone", "id_doc", "selfie", "location"];
const REVIEWABLE_STEP_ORDER: VerificationStepType[] = ["phone", "id_doc", "selfie", "location"];
const STEP_STATUS_PRIORITY: Record<VerificationStatus, number> = {
  rejected: 4,
  needs_resubmission: 3,
  pending: 2,
  approved: 1,
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_DOC_TYPES = [...ALLOWED_IMAGE_TYPES, "application/pdf"];
const OTP_RESEND_COOLDOWN_SECONDS = 30;
const OTP_EXPIRY_SECONDS = 300; // 5 minutes
const EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION =
  "Check your inbox for the confirmation link, then return here to continue. You can still verify your phone while waiting.";
const VERIFICATION_TEMPORARILY_UNAVAILABLE_DESCRIPTION =
  "Verification is temporarily unavailable right now. Please try again later.";
const GPS_TARGET_ACCURACY_METERS = 50;
const GPS_WATCH_SETTLE_MS = 4000;

type VerificationApiResponse = {
  success?: boolean;
  persisted?: boolean;
  warning?: string;
  verified?: boolean;
  stepStatus?: VerificationStatus;
  confidence?: LocationConfidence;
  resolvedProvince?: string | null;
  resolvedCity?: string | null;
  mismatch?: {
    province: boolean;
    city: boolean;
  } | null;
  error?: string;
  code?: string;
  detail?: string;
  retryAfter?: number;
  requestId?: string;
};

type OtpSendResponse = VerificationApiResponse;

const STEP_COPY: Record<Exclude<WizardStep, "complete">, string> = {
  phone: "Enter your SA mobile number. We'll send a verification code via SMS.",
  id_doc: "Enter your 13-digit SA ID and take a clear photo of your ID. Max 5 MB.",
  selfie: "Take a live selfie using your camera. Max 5 MB.",
  location:
    "Select your province and city, save it, then optionally use GPS to confirm your device location matches what you selected.",
};

const GEOLOCATION_PERMISSION_DENIED = 1;

function isBetterGpsFix(
  nextPosition: GeolocationPosition,
  currentBest: GeolocationPosition | null
): boolean {
  if (!currentBest) return true;

  const nextAccuracy = nextPosition.coords.accuracy;
  const currentAccuracy = currentBest.coords.accuracy;
  if (nextAccuracy !== currentAccuracy) {
    return nextAccuracy < currentAccuracy;
  }

  return nextPosition.timestamp > currentBest.timestamp;
}

function isGeolocationPermissionDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === GEOLOCATION_PERMISSION_DENIED
  );
}

async function requestDeviceGpsPosition(): Promise<GeolocationPosition> {
  if (!navigator.geolocation) {
    throw new Error("GPS is not supported in this browser");
  }

  if (navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({ name: "geolocation" });
      if (permission.state === "denied") {
        const deniedError = new Error("GPS permission denied") as Error & { code?: number };
        deniedError.code = GEOLOCATION_PERMISSION_DENIED;
        throw deniedError;
      }
    } catch (error) {
      if (isGeolocationPermissionDenied(error)) {
        throw error;
      }
    }
  }

  const options: PositionOptions = {
    enableHighAccuracy: true,
    timeout: GPS_REQUEST_TIMEOUT_MS,
    maximumAge: 0,
  };

  return new Promise<GeolocationPosition>((resolve, reject) => {
    let settled = false;
    let watchId: number | null = null;
    let bestPosition: GeolocationPosition | null = null;

    const cleanup = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      window.clearTimeout(timeoutId);
      window.clearTimeout(settleId);
    };

    const finish = (position: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(position);
    };

    const fail = (error: GeolocationPositionError | Error) => {
      if (settled) return;
      if (bestPosition) {
        finish(bestPosition);
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const acceptPosition = (position: GeolocationPosition) => {
      if (isBetterGpsFix(position, bestPosition)) {
        bestPosition = position;
      }

      if (position.coords.accuracy <= GPS_TARGET_ACCURACY_METERS) {
        finish(position);
      }
    };

    const timeoutId = window.setTimeout(() => {
      fail(new Error("GPS request timed out"));
    }, GPS_REQUEST_TIMEOUT_MS);

    const settleId = window.setTimeout(
      () => {
        if (bestPosition) {
          finish(bestPosition);
        }
      },
      Math.min(GPS_WATCH_SETTLE_MS, GPS_REQUEST_TIMEOUT_MS)
    );

    navigator.geolocation.getCurrentPosition(acceptPosition, fail, options);

    if (navigator.geolocation.watchPosition) {
      watchId = navigator.geolocation.watchPosition(acceptPosition, fail, options);
    }
  });
}

class SubmissionError extends Error {
  code?: string;
  requestId?: string;

  constructor(message: string, code?: string, requestId?: string) {
    super(message);
    this.name = "SubmissionError";
    this.code = code;
    this.requestId = requestId;
  }
}

function appendRequestId(message: string, requestId?: string): string {
  if (!requestId) return message;
  return `${message} Ref: ${requestId}`;
}

function mapUploadFailureMessage(label: string, error: unknown, code?: string): string {
  const normalizedLabel = label.charAt(0).toUpperCase() + label.slice(1);

  switch (code) {
    case "kyc_v2_disabled":
      return "Verification is temporarily unavailable. Please try again later.";
    case "storage_unavailable":
    case "storage_failed":
      return `${normalizedLabel} upload is temporarily unavailable. Please try again in a moment.`;
    case "config_missing":
      return `${normalizedLabel} upload is unavailable because secure verification storage is not configured.`;
    case "encryption_failed":
      return `${normalizedLabel} could not be encrypted securely. Please contact support.`;
    case "artifact_record_failed":
      return `${normalizedLabel} upload reached the server but could not be recorded. Please retry.`;
    case VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE:
      return VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE;
    default: {
      const message = error instanceof Error ? error.message : String(error ?? "").trim();
      if (!message) {
        return `Failed to upload ${label}.`;
      }
      if (/^not found$/i.test(message)) {
        return "Verification is temporarily unavailable. Please try again later.";
      }
      if (/failed to upload document/i.test(message)) {
        return `Failed to upload ${label}. Please try again.`;
      }
      return message;
    }
  }
}

/** Map rejection reason codes to human-readable guidance. */
const REJECTION_GUIDANCE: Record<string, string> = {
  blurry_image: "Image too blurry. Retake in good lighting with a steady hand.",
  mismatch: "Details don't match your document. Check your name and ID number.",
  expired_document: "Document expired. Upload a valid, unexpired document.",
  incomplete_info: "Document cut off. Retake showing all edges clearly.",
  fraudulent: "Submission could not be verified. Contact support if this is an error.",
  wrong_document_type: "Wrong document type. Upload an SA ID card, book, or passport.",
  not_sa_document: "Only SA documents accepted. Upload an SA ID book, card, or passport.",
  location_mismatch: "GPS doesn't match your province. Verify your location.",
  high_risk_override: "Flagged for admin review. No action needed from you.",
  other: "Needs attention. See the admin note above for instructions.",
  insufficient_face_visibility:
    "Face not visible. Retake without sunglasses or hats, facing camera.",
};

function formatReasonCode(reasonCode: string | null | undefined): string | null {
  if (!reasonCode) return null;
  return (
    REJECTION_GUIDANCE[reasonCode] ??
    reasonCode
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function formatStatusLabel(status: VerificationStatus): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "pending":
      return "Pending Review";
    case "rejected":
      return "Rejected";
    case "needs_resubmission":
      return "Needs resubmission";
    default:
      return status;
  }
}

function getStatusBannerClasses(status: VerificationStatus): string {
  switch (status) {
    case "approved":
      return "border-brand-green/30 bg-brand-green-50 text-brand-green-900";
    case "pending":
      return "border-brand-gold/30 bg-brand-gold-50 text-brand-gold-900";
    case "rejected":
    case "needs_resubmission":
      return "border-destructive/30 bg-destructive/5 text-destructive";
    default:
      return "border-warm-200/70 bg-background text-foreground";
  }
}

function shouldReplaceStepStatus(
  current: VerificationStatus | undefined,
  next: VerificationStatus
) {
  return !current || STEP_STATUS_PRIORITY[next] > STEP_STATUS_PRIORITY[current];
}

function buildStepStatusMap(statusSteps: StepStatusEntry[]) {
  const stepStatusMap = new Map<VerificationStepType, VerificationStatus>();

  for (const entry of statusSteps) {
    if (shouldReplaceStepStatus(stepStatusMap.get(entry.step_type), entry.status)) {
      stepStatusMap.set(entry.step_type, entry.status);
    }
  }

  return stepStatusMap;
}

function buildServerStepMap(statusSteps: StepStatusEntry[]) {
  const stepStatusMap = new Map<VerificationStepType, StepStatusEntry>();

  for (const entry of statusSteps) {
    if (shouldReplaceStepStatus(stepStatusMap.get(entry.step_type)?.status, entry.status)) {
      stepStatusMap.set(entry.step_type, entry);
    }
  }

  return stepStatusMap;
}

function getInitialWizardStep({
  statusSteps,
  phoneDone,
  allSubmitted,
  accountVerificationStatus,
}: {
  statusSteps: StepStatusEntry[];
  phoneDone: boolean;
  allSubmitted: boolean;
  accountVerificationStatus: AccountVerificationStatus | null;
}): WizardStep {
  const stepStatusMap = buildStepStatusMap(statusSteps);
  const needsAttention = REVIEWABLE_STEP_ORDER.find((stepType) => {
    const status = stepStatusMap.get(stepType);
    return status === "rejected" || status === "needs_resubmission";
  });

  if (needsAttention) {
    return needsAttention;
  }

  if (accountVerificationStatus === "verified") {
    return "complete";
  }

  const nonPhoneSubmitted = REVIEWABLE_STEP_ORDER.filter((stepType) => stepType !== "phone").every(
    (stepType) => {
      const status = stepStatusMap.get(stepType);
      return status === "approved" || status === "pending";
    }
  );

  if (
    phoneDone &&
    nonPhoneSubmitted &&
    (allSubmitted || accountVerificationStatus === "pending_review")
  ) {
    return "complete";
  }

  if (!phoneDone) {
    return "phone";
  }

  const nextMissing = REVIEWABLE_STEP_ORDER.find((stepType) => {
    if (stepType === "phone") return false;
    return !stepStatusMap.has(stepType);
  });

  return nextMissing ?? "complete";
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLocationSummary(
  town?: string | null,
  city?: string | null,
  province?: string | null
): string {
  return [town, city, province].filter(Boolean).join(", ");
}

function validateFile(file: File | null, allowPdf = false): string | null {
  if (!file) return "Please select a file";
  if (file.size === 0) return "Selected file is empty";
  if (file.size > MAX_FILE_SIZE_BYTES) return "File must be under 5MB";
  const allowedTypes = allowPdf ? ALLOWED_DOC_TYPES : ALLOWED_IMAGE_TYPES;
  if (!allowedTypes.includes(file.type)) {
    return allowPdf ? "Use JPG, PNG, WebP, or PDF" : "Use JPG, PNG, or WebP";
  }
  return null;
}

function getCompletionCtaLabel(completionHref: string): string {
  if (completionHref === "/dashboard") {
    return "Go to Dashboard";
  }

  if (completionHref.startsWith("/post/")) {
    return "Return to Posting";
  }

  return "Continue";
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  if (seconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}

function buildOtpSupportMessage(
  payload: VerificationApiResponse,
  retryAfterSeconds: number,
  formattedPhone: string
): string {
  if (payload.code === "hourly_limit_reached" || payload.code === "rate_limited") {
    return retryAfterSeconds > 0
      ? `Too many code requests were made for this number. Wait ${formatCountdown(retryAfterSeconds)} before resending.`
      : "Too many code requests were made for this number. Please wait before resending.";
  }

  if (payload.code === "sms_delivery_failed") {
    return `We could not hand your code to the SMS provider. Confirm ${formattedPhone} is correct, wait a minute, then resend.`;
  }

  if (payload.code === "unauthorized") {
    return "Your session expired before the code request completed. Sign in again, then retry.";
  }

  return `SMS delivery can take up to 60 seconds. If nothing arrives, confirm ${formattedPhone} and resend once the timer ends.`;
}

export default function VerificationPage() {
  const [step, setStep] = useState<WizardStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [otpRetryAfterSeconds, setOtpRetryAfterSeconds] = useState(0);
  const [otpExpirySeconds, setOtpExpirySeconds] = useState(0);
  const [otpSupportMessage, setOtpSupportMessage] = useState<string | null>(null);
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState(false);
  const [verificationUnavailable, setVerificationUnavailable] = useState(false);

  const [idNumber, setIdNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [idFile, setIdFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [idCaptureMethod, setIdCaptureMethod] = useState<"camera" | "file_upload">("camera");
  const [selfieCaptureMethod, setSelfieCaptureMethod] = useState<"camera" | "file_upload">(
    "camera"
  );
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [locationTown, setLocationTown] = useState("");

  // Session-driven state
  const [_sessionId, setSessionId] = useState<string | null>(null);
  const [_sessionLoading, setSessionLoading] = useState(true);
  const [_useV2Flow, setUseV2Flow] = useState(false);
  const [serverSteps, setServerSteps] = useState<StepStatusEntry[]>([]);
  const [accountVerificationStatus, setAccountVerificationStatus] =
    useState<AccountVerificationStatus | null>(null);

  // GPS state
  const [gpsStatus, setGpsStatus] = useState<
    "idle" | "requesting" | "success" | "denied" | "error"
  >("idle");
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lon: number; accuracy: number } | null>(
    null
  );
  const [gpsConfidence, setGpsConfidence] = useState<LocationConfidence | null>(null);
  const [gpsProvince, setGpsProvince] = useState<string | null>(null);
  const [gpsFeatureAvailable, setGpsFeatureAvailable] = useState(true);
  const [gpsApproved, setGpsApproved] = useState(false);

  // Manual location state
  const [manualSubmitted, setManualSubmitted] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [gpsMismatch, setGpsMismatch] = useState<{ province: boolean; city: boolean } | null>(null);

  // SA ID validation feedback
  const [idDob, setIdDob] = useState<string | null>(null);
  const [idGender, setIdGender] = useState<string | null>(null);
  const [idChecksumValid, setIdChecksumValid] = useState<boolean | null>(null);
  const [idAgeError, setIdAgeError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isUploadingId, setIsUploadingId] = useState(false);
  const [isUploadingSelfie, setIsUploadingSelfie] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<VerificationStepType[]>([]);
  const [uploadReceipts, setUploadReceipts] = useState<{
    id_doc?: UploadReceipt;
    selfie?: UploadReceipt;
  }>({});

  const { toast } = useToast();
  const searchParams = useSearchParams();
  const formattedPhone = useMemo(() => formatPhone(phone), [phone]);
  const rawReturnUrl = searchParams.get("returnUrl");
  const completionHref = useMemo(
    () => (rawReturnUrl ? sanitizeReturnUrl(rawReturnUrl) : "/dashboard"),
    [rawReturnUrl]
  );

  const idFileError = validateFile(idFile, false);
  const selfieFileError = validateFile(selfieFile);
  const normalizedFirstName = firstName.trim();
  const normalizedLastName = lastName.trim();
  const firstNameError =
    normalizedFirstName.length === 0
      ? "First name as shown on your ID is required"
      : normalizedFirstName.length > 100
        ? "First name cannot exceed 100 characters"
        : null;
  const lastNameError =
    normalizedLastName.length === 0
      ? "Surname as shown on your ID is required"
      : normalizedLastName.length > 100
        ? "Surname cannot exceed 100 characters"
        : null;
  const isPhoneValid = isValidSaPhone(phone);
  const isOtpValid = otp.length === 6;
  const isIdFormReady =
    /^\d{13}$/.test(idNumber) &&
    !idFileError &&
    !idAgeError &&
    idChecksumValid !== false &&
    !firstNameError &&
    !lastNameError;
  const isSelfieFormReady = !selfieFileError;
  const serverStepMap = useMemo(() => buildServerStepMap(serverSteps), [serverSteps]);
  const persistedPhoneVerified = ["approved", "pending"].includes(
    serverStepMap.get("phone")?.status ?? ""
  );
  const persistedIdUploaded = ["approved", "pending"].includes(
    serverStepMap.get("id_doc")?.status ?? ""
  );
  const persistedSelfieUploaded = ["approved", "pending"].includes(
    serverStepMap.get("selfie")?.status ?? ""
  );
  const isPhoneReady = phoneVerified || persistedPhoneVerified || completedSteps.includes("phone");
  const isIdReady = persistedIdUploaded || isIdFormReady;
  const isSelfieReady = persistedSelfieUploaded || isSelfieFormReady;
  const persistedLocationSubmitted = ["approved", "pending"].includes(
    serverStepMap.get("location")?.status ?? ""
  );
  const persistedLocationStep = serverStepMap.get("location");
  const locationSaved = persistedLocationSubmitted || manualSubmitted;
  const persistedGpsMismatch = persistedLocationStep?.gps_mismatch ?? null;
  const persistedGpsVerified =
    persistedLocationStep?.status === "approved" &&
    (persistedLocationStep.location_method === "gps" ||
      persistedLocationStep.location_method === "manual_with_gps") &&
    !persistedGpsMismatch?.province &&
    !persistedGpsMismatch?.city;
  const locationVerified = persistedGpsVerified || gpsApproved;
  const isLocationReady = locationSaved;
  const locationSummary = formatLocationSummary(locationTown, city, province);
  const allStepsResolved = useMemo(
    () =>
      REVIEWABLE_STEP_ORDER.every((stepType) => {
        const status = serverStepMap.get(stepType)?.status;
        return status === "approved" || status === "pending";
      }),
    [serverStepMap]
  );
  const reviewAttentionStep = useMemo(
    () =>
      REVIEWABLE_STEP_ORDER.find((stepType) => {
        const status = serverStepMap.get(stepType)?.status;
        return status === "rejected" || status === "needs_resubmission";
      }) ?? null,
    [serverStepMap]
  );
  const verificationInAdminReview =
    !reviewAttentionStep && accountVerificationStatus === "pending_review" && allStepsResolved;
  const verificationSubmissionBlocked =
    emailConfirmationRequired || verificationUnavailable || verificationInAdminReview;
  const blockedSubmissionTitle = verificationInAdminReview
    ? "Verification already submitted"
    : "Confirm your email first";
  const blockedSubmissionDescription = verificationInAdminReview
    ? "Your verification is pending admin review. You can edit only if admin asks you to resubmit."
    : EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION;

  const applyEmailConfirmationBlocker = useCallback((payload?: VerificationApiResponse | null) => {
    if (!isVerificationEmailConfirmationRequired(payload)) {
      return false;
    }

    setEmailConfirmationRequired(true);
    return true;
  }, []);

  const syncVerificationStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/verification/status");
      if (!res.ok) {
        if (res.status === 404) {
          setServerSteps([]);
          setAccountVerificationStatus("incomplete");
          return null;
        }
        throw new Error("Failed to load verification status");
      }

      const payload = await res.json();
      const nextSteps = Array.isArray(payload.steps)
        ? (payload.steps as StepStatusEntry[]).filter((stepEntry) =>
            REVIEWABLE_STEP_ORDER.includes(stepEntry.step_type)
          )
        : [];

      setServerSteps(nextSteps);
      setAccountVerificationStatus(
        (payload.accountVerificationStatus ??
          payload.overallStatus ??
          null) as AccountVerificationStatus | null
      );

      const nextLocationStep = nextSteps.find((entry) => entry.step_type === "location");
      if (nextLocationStep) {
        setProvince(nextLocationStep.location_province ?? "");
        setCity(nextLocationStep.location_city ?? "");
        setLocationTown(nextLocationStep.location_town ?? "");
        setManualSubmitted(
          nextLocationStep.status === "approved" || nextLocationStep.status === "pending"
        );

        const gpsBackedLocation =
          nextLocationStep.location_method === "gps" ||
          nextLocationStep.location_method === "manual_with_gps";

        setGpsMismatch(nextLocationStep.gps_mismatch ?? null);
        setGpsProvince(nextLocationStep.gps_resolved_province ?? null);
        setGpsConfidence(
          (nextLocationStep.gps_confidence as LocationConfidence | null | undefined) ?? null
        );
        setGpsApproved(
          nextLocationStep.status === "approved" &&
            gpsBackedLocation &&
            !nextLocationStep.gps_mismatch?.province &&
            !nextLocationStep.gps_mismatch?.city
        );
      }

      const approvedSteps = nextSteps
        .filter((entry) => entry.status === "approved" || entry.status === "pending")
        .map((entry) => entry.step_type);
      setCompletedSteps(approvedSteps);
      setPhoneVerified(
        (previouslyVerified) =>
          previouslyVerified ||
          nextSteps.some(
            (entry) =>
              entry.step_type === "phone" &&
              (entry.status === "approved" || entry.status === "pending")
          )
      );

      // Hydrate upload receipts from server so they survive page refresh
      setUploadReceipts((prev) => {
        const next = { ...prev };
        for (const entry of nextSteps) {
          if (
            (entry.step_type === "id_doc" || entry.step_type === "selfie") &&
            (entry.status === "approved" || entry.status === "pending") &&
            !next[entry.step_type]
          ) {
            next[entry.step_type] = {
              name: entry.step_type === "id_doc" ? "ID document" : "Selfie",
              sizeBytes: 0,
              uploadedAtIso: entry.submitted_at ?? new Date().toISOString(),
            };
          }
        }
        return next;
      });

      return {
        steps: nextSteps,
        accountStatus: (payload.accountVerificationStatus ??
          payload.overallStatus ??
          null) as AccountVerificationStatus | null,
      };
    } catch {
      return null;
    }
  }, []);

  // Try to start a v2 session on mount
  useEffect(() => {
    let cancelled = false;
    async function initSession() {
      let sessionData: {
        completedSteps?: VerificationStepType[];
        pendingSteps?: VerificationStepType[];
        requiredSteps?: VerificationStepType[];
        finalizedAt?: string | null;
        phoneVerifiedAt?: string | null;
      } | null = null;

      try {
        const res = await fetch("/api/verification/session/start", {
          method: "POST",
          headers: withCsrfHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          sessionData = data;
          if (!cancelled) {
            setSessionId(data.sessionId);
            setUseV2Flow(true);
            // Restore completed steps from server
            if (data.completedSteps?.length > 0) {
              setCompletedSteps(data.completedSteps);
            }
            if (
              data.phoneVerifiedAt ||
              data.completedSteps?.includes("phone") ||
              data.pendingSteps?.includes("phone")
            ) {
              setPhoneVerified(true);
            }
          }
        } else if (res.status === 403) {
          const data = (await res.json().catch(() => ({}))) as VerificationApiResponse;
          if (!cancelled) {
            applyEmailConfirmationBlocker(data);
          }
        } else if (res.status === 410) {
          // Session expired — toast and fall back to legacy
          if (!cancelled) {
            toast({
              title: "Session expired",
              description: "Your previous session expired. Starting fresh.",
              variant: "destructive",
            });
          }
        } else if (res.status === 404) {
          if (!cancelled) {
            setVerificationUnavailable(true);
          }
        }
      } catch (err) {
        // Session start failed — fall back to legacy
        console.warn("[Verification] v2 session init failed", err);
      } finally {
        const statusSnapshot = await syncVerificationStatus();

        if (!cancelled) {
          const phoneDone =
            Boolean(sessionData?.phoneVerifiedAt) ||
            sessionData?.completedSteps?.includes("phone") ||
            sessionData?.pendingSteps?.includes("phone") ||
            Boolean(
              statusSnapshot?.steps.some(
                (entry) =>
                  entry.step_type === "phone" &&
                  (entry.status === "approved" || entry.status === "pending")
              )
            );
          const allSubmitted =
            (sessionData?.completedSteps?.length ?? 0) + (sessionData?.pendingSteps?.length ?? 0) >=
              (sessionData?.requiredSteps?.length ?? 4) && Boolean(sessionData?.finalizedAt);

          setStep(
            getInitialWizardStep({
              statusSteps: statusSnapshot?.steps ?? [],
              phoneDone,
              allSubmitted,
              accountVerificationStatus: statusSnapshot?.accountStatus ?? null,
            })
          );
        }
        if (!cancelled) setSessionLoading(false);
      }
    }
    initSession();
    return () => {
      cancelled = true;
    };
  }, [applyEmailConfirmationBlocker, syncVerificationStatus, toast]);

  // SA ID number validation effect
  useEffect(() => {
    if (idNumber.length === 13 && /^\d{13}$/.test(idNumber)) {
      const valid = validateSaIdChecksum(idNumber);
      queueMicrotask(() => {
        setIdChecksumValid(valid);
        if (valid) {
          const dob = extractDobFromSaId(idNumber);
          const gender = extractGenderFromSaId(idNumber);
          setIdDob(
            dob
              ? dob.toLocaleDateString("en-ZA", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              : null
          );
          setIdGender(gender);
          // Age gate: must be 18+
          const under18 = isUnder18FromSaId(idNumber);
          if (under18 === true) {
            setIdAgeError("You must be at least 18 years old to register.");
          } else {
            setIdAgeError(null);
          }
        } else {
          setIdDob(null);
          setIdGender(null);
          setIdAgeError(null);
        }
      });
    } else {
      queueMicrotask(() => {
        setIdChecksumValid(null);
        setIdDob(null);
        setIdGender(null);
        setIdAgeError(null);
      });
    }
  }, [idNumber]);

  // GPS capture handler
  const handleRequestGps = useCallback(async () => {
    if (gpsStatus === "requesting") return;

    if (!navigator.geolocation) {
      setGpsFeatureAvailable(false);
      setGpsStatus("error");
      toast({ title: "GPS not supported in this browser", variant: "destructive" });
      return;
    }

    setGpsFeatureAvailable(true);
    setGpsApproved(false);
    setGpsMismatch(null);
    setGpsConfidence(null);
    setGpsProvince(null);
    setGpsCoords(null);
    setGpsStatus("requesting");

    try {
      const position = await requestDeviceGpsPosition();
      const { latitude, longitude, accuracy } = position.coords;
      setGpsCoords({ lat: latitude, lon: longitude, accuracy });
      setGpsStatus("success");

      try {
        const gpsBody: Record<string, unknown> = {
          latitude,
          longitude,
          accuracy,
          timestamp: position.timestamp,
        };
        // Pass declared values for GPS confirmation mode
        if (manualSubmitted && province) {
          gpsBody.declaredProvince = province;
          if (city) gpsBody.declaredCity = city;
        }
        const res = await fetch("/api/verification/location/gps", {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(gpsBody),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.persisted === false) {
            setGpsStatus("idle");
            setGpsApproved(false);
            toast({
              title: "GPS check not saved",
              description:
                data.warning ||
                "Your saved address remains in place. GPS confirmation is optional, so you can continue or try again.",
              variant: "default",
            });
            return;
          }
          if (!manualSubmitted) {
            setProvince(data.resolvedProvince ?? "");
            setCity(data.resolvedCity ?? "");
          }
          setGpsConfidence(data.confidence);
          setGpsProvince(data.resolvedProvince ?? null);
          setGpsMismatch(data.mismatch ?? null);
          setGpsApproved(Boolean(data.verified));
          await syncVerificationStatus();

          const gpsMismatchDescription = data.mismatch?.province
            ? `GPS detected a different province${data.resolvedProvince ? ` (${data.resolvedProvince})` : ""}. Your saved address stays in place, but it was not GPS-verified.`
            : data.mismatch?.city
              ? "GPS detected a different city. Your saved address stays in place, but it was not GPS-verified."
              : "Your saved address was kept, but GPS could not verify it for automatic approval.";

          toast({
            title: data.verified ? "Address verified by GPS" : "GPS check recorded",
            description: data.verified
              ? "GPS matched the province and city you selected."
              : gpsMismatchDescription,
            variant: data.verified ? "success" : "default",
          });
        } else if (res.status === 404) {
          setGpsFeatureAvailable(false);
          setGpsStatus("idle");
          setGpsApproved(false);
          toast({
            title: "GPS verification unavailable",
            description: "GPS verification is temporarily unavailable. Please try again later.",
            variant: "destructive",
          });
        } else {
          const data = (await res.json().catch(() => ({}))) as VerificationApiResponse;
          if (applyEmailConfirmationBlocker(data)) {
            setGpsStatus("idle");
            setGpsApproved(false);
            toast({
              title: "Confirm your email first",
              description: EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION,
              variant: "destructive",
            });
            return;
          }
          const optionalGpsPersistenceFailure =
            manualSubmitted &&
            (res.status >= 500 || data.error === "Failed to save location verification");

          if (optionalGpsPersistenceFailure) {
            setGpsStatus("idle");
            setGpsApproved(false);
            toast({
              title: "GPS check not saved",
              description:
                "Your saved address remains in place. GPS confirmation is optional, so you can continue or try again.",
              variant: "default",
            });
            return;
          }

          setGpsStatus("error");
          setGpsApproved(false);
          toast({
            title: "GPS could not verify this location",
            description:
              data.error ||
              "Please allow location access, then request your current location again.",
            variant: "destructive",
          });
        }
      } catch (err) {
        setGpsApproved(false);
        setGpsMismatch(null);
        setGpsStatus("error");
        toast({
          title: "GPS verification failed",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    } catch (err) {
      setGpsApproved(false);
      setGpsMismatch(null);
      const permissionDenied = isGeolocationPermissionDenied(err);
      setGpsStatus(permissionDenied ? "denied" : "error");
      toast({
        title: permissionDenied ? "GPS permission denied" : "GPS error",
        description: "Your saved address stays in place. GPS confirmation is optional.",
        variant: "destructive",
      });
    }
  }, [
    applyEmailConfirmationBlocker,
    gpsStatus,
    toast,
    manualSubmitted,
    province,
    city,
    syncVerificationStatus,
  ]);

  // GPS is no longer auto-triggered — it's optional confirmation after manual selection

  const idPreviewUrl = useMemo(
    () => (idFile && idFile.type.startsWith("image/") ? URL.createObjectURL(idFile) : null),
    [idFile]
  );

  const selfiePreviewUrl = useMemo(
    () =>
      selfieFile && selfieFile.type.startsWith("image/") ? URL.createObjectURL(selfieFile) : null,
    [selfieFile]
  );

  useEffect(() => {
    return () => {
      if (idPreviewUrl) URL.revokeObjectURL(idPreviewUrl);
    };
  }, [idPreviewUrl]);

  useEffect(() => {
    return () => {
      if (selfiePreviewUrl) URL.revokeObjectURL(selfiePreviewUrl);
    };
  }, [selfiePreviewUrl]);

  useEffect(() => {
    if (otpRetryAfterSeconds <= 0) return;

    const timer = window.setInterval(() => {
      setOtpRetryAfterSeconds((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [otpRetryAfterSeconds]);

  useEffect(() => {
    if (otpExpirySeconds <= 0) return;

    const timer = window.setInterval(() => {
      setOtpExpirySeconds((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [otpExpirySeconds]);

  function markStepComplete(stepType: VerificationStepType) {
    setCompletedSteps((prev) => (prev.includes(stepType) ? prev : [...prev, stepType]));
  }

  function clearStepCompletion(stepType: VerificationStepType) {
    setCompletedSteps((prev) => prev.filter((entry) => entry !== stepType));
  }

  function handlePhoneChange(value: string) {
    setPhone(sanitizeSaPhoneInput(value));
    setOtp("");
    setOtpSent(false);
    setOtpRetryAfterSeconds(0);
    setOtpExpirySeconds(0);
    setOtpSupportMessage(null);
  }

  async function handleSendOtp() {
    if (!isPhoneValid) {
      toast({
        title: "Enter a valid SA mobile number",
        description: "Use a South African mobile number such as 071 234 5678.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ phone }),
      });
      const payload = (await res.json().catch(() => ({}))) as OtpSendResponse;
      const retryAfterSeconds = Number(res.headers.get("Retry-After") ?? payload.retryAfter ?? 0);

      if (!res.ok) {
        if (retryAfterSeconds > 0) {
          setOtpRetryAfterSeconds(retryAfterSeconds);
        }

        const supportMessage = buildOtpSupportMessage(payload, retryAfterSeconds, formattedPhone);
        setOtpSupportMessage(supportMessage);
        throw new Error(payload.error || supportMessage);
      }

      setOtpSent(true);
      setOtp("");
      setOtpRetryAfterSeconds(OTP_RESEND_COOLDOWN_SECONDS);
      setOtpExpirySeconds(OTP_EXPIRY_SECONDS);
      setOtpSupportMessage(buildOtpSupportMessage({}, OTP_RESEND_COOLDOWN_SECONDS, formattedPhone));
      toast({
        title: otpSent ? "Code resent" : "Code sent",
        description: `Check ${formattedPhone} for the 6-digit code. Delivery can take up to 60 seconds.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Failed to send code",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (!isOtpValid) {
      toast({
        title: "Enter the 6-digit code",
        description: "Use the code sent to your phone, then try again.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ phone, otp }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Invalid OTP");

      setPhoneVerified(true);
      setOtpSupportMessage(null);
      setOtpRetryAfterSeconds(0);
      setOtpExpirySeconds(0);
      markStepComplete("phone");
      await syncVerificationStatus();
      setStep("id_doc");
      toast({
        title: "Phone number verified",
        description: `${formattedPhone} is now linked to your verification profile.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Invalid OTP",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function goToSelfieStep() {
    if (verificationSubmissionBlocked) {
      toast({
        title: blockedSubmissionTitle,
        description: blockedSubmissionDescription,
        variant: "destructive",
      });
      return;
    }

    if (!/^\d{13}$/.test(idNumber)) {
      toast({ title: "Enter a valid 13-digit SA ID number", variant: "destructive" });
      return;
    }
    if (firstNameError || lastNameError) {
      toast({
        title: firstNameError ?? lastNameError ?? "Enter legal names",
        variant: "destructive",
      });
      return;
    }
    if (idFileError) {
      toast({ title: idFileError, variant: "destructive" });
      return;
    }
    setIsUploadingId(true);
    try {
      await uploadIdIfNeeded();
      await syncVerificationStatus();
      setStep("selfie");
    } catch (err) {
      const isEmailBlocker =
        err instanceof SubmissionError &&
        err.code === VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE;
      toast({
        title: isEmailBlocker ? "Confirm your email first" : "ID document upload failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingId(false);
    }
  }

  async function goToLocationStep() {
    if (verificationSubmissionBlocked) {
      toast({
        title: blockedSubmissionTitle,
        description: blockedSubmissionDescription,
        variant: "destructive",
      });
      return;
    }

    if (selfieFileError) {
      toast({ title: selfieFileError, variant: "destructive" });
      return;
    }
    setIsUploadingSelfie(true);
    try {
      await uploadSelfieIfNeeded();
      await syncVerificationStatus();
      setStep("location");
    } catch (err) {
      const isEmailBlocker =
        err instanceof SubmissionError &&
        err.code === VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE;
      toast({
        title: isEmailBlocker ? "Confirm your email first" : "Selfie upload failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingSelfie(false);
    }
  }

  /** Upload helper with 1 automatic retry after a 2-second delay. */
  async function uploadWithRetry(
    buildFormData: () => FormData,
    label: string
  ): Promise<Record<string, unknown>> {
    const attempt = async () => {
      const res = await fetch("/api/verification/upload", {
        method: "POST",
        headers: withCsrfHeaders(),
        body: buildFormData(),
      });
      const payload = (await res.json().catch(() => ({}))) as VerificationApiResponse;
      if (!res.ok) {
        if (applyEmailConfirmationBlocker(payload)) {
          throw new SubmissionError(
            VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
            VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE,
            payload.requestId
          );
        }
        // 409 = step already approved by admin between our pre-check and write.
        // Treat as success — the step is done, just not by us.
        if (res.status === 409 && payload.code === "step_already_approved") {
          toast({
            title: "Already approved",
            description: `Your ${label} was already approved while you were uploading. No action needed.`,
            variant: "success",
          });
          return payload;
        }
        if (res.status === 409 && payload.code === "duplicate_pending_artifact") {
          toast({
            title: "Already submitted",
            description: `Your ${label} is already pending review. You can continue without uploading it again.`,
            variant: "success",
          });
          return payload;
        }
        throw new SubmissionError(
          appendRequestId(
            mapUploadFailureMessage(
              label,
              payload.error || `Failed to upload ${label}`,
              payload.code
            ),
            payload.requestId
          ),
          payload.code,
          payload.requestId
        );
      }
      return payload;
    };

    try {
      return await attempt();
    } catch (error) {
      if (
        error instanceof SubmissionError &&
        (error.code === VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE ||
          error.code === "step_already_approved")
      ) {
        throw error;
      }

      // One automatic retry after 2 s for transient failures
      await new Promise((r) => setTimeout(r, 2000));
      return await attempt();
    }
  }

  async function uploadIdIfNeeded() {
    if (uploadReceipts.id_doc || persistedIdUploaded) return;
    if (!idFile) throw new Error("Please add your ID document.");

    await uploadWithRetry(() => {
      const fd = new FormData();
      fd.append("file", idFile);
      fd.append("docType", "id_document");
      fd.append("idNumber", idNumber);
      fd.append("firstName", normalizedFirstName);
      fd.append("lastName", normalizedLastName);
      fd.append("idDocumentType", "sa_id");
      fd.append("captureMethod", idCaptureMethod);
      return fd;
    }, "ID document");

    setUploadReceipts((prev) => ({
      ...prev,
      id_doc: {
        name: idFile.name,
        sizeBytes: idFile.size,
        uploadedAtIso: new Date().toISOString(),
      },
    }));
    markStepComplete("id_doc");
  }

  async function uploadSelfieIfNeeded() {
    if (uploadReceipts.selfie || persistedSelfieUploaded) return;
    if (!selfieFile) throw new Error("Please add your selfie.");

    await uploadWithRetry(() => {
      const fd = new FormData();
      fd.append("file", selfieFile);
      fd.append("docType", "selfie");
      fd.append("captureMethod", selfieCaptureMethod);
      return fd;
    }, "selfie");

    setUploadReceipts((prev) => ({
      ...prev,
      selfie: {
        name: selfieFile.name,
        sizeBytes: selfieFile.size,
        uploadedAtIso: new Date().toISOString(),
      },
    }));
    markStepComplete("selfie");
  }

  async function submitLocation() {
    if (persistedLocationSubmitted || manualSubmitted) {
      if (!completedSteps.includes("location")) {
        markStepComplete("location");
      }
      return;
    }

    throw new Error("Please select your province and city.");
  }

  async function handleManualLocationSubmit() {
    if (verificationSubmissionBlocked) {
      toast({
        title: blockedSubmissionTitle,
        description: blockedSubmissionDescription,
        variant: "destructive",
      });
      return;
    }

    if (!province || !city) {
      toast({ title: "Please select both province and city", variant: "destructive" });
      return;
    }
    setManualSubmitting(true);
    try {
      const res = await fetch("/api/verification/location/manual", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ province, city, town: locationTown || undefined }),
      });
      if (res.ok) {
        setManualSubmitted(true);
        setGpsApproved(false);
        setGpsStatus("idle");
        setGpsCoords(null);
        setGpsConfidence(null);
        setGpsProvince(null);
        setGpsMismatch(null);
        await syncVerificationStatus();
        toast({
          title: "Address saved",
          description:
            "Your selected address has been saved. Use GPS to confirm it matches your device location.",
          variant: "success",
        });
      } else {
        const data = (await res.json().catch(() => ({}))) as VerificationApiResponse;
        if (applyEmailConfirmationBlocker(data)) {
          toast({
            title: "Confirm your email first",
            description: EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION,
            variant: "destructive",
          });
          return;
        }
        toast({
          title: "Failed to save location",
          description: data.detail || data.error || "Please try again.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Location submission failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setManualSubmitting(false);
    }
  }

  async function handleFinalize() {
    if (verificationSubmissionBlocked) {
      toast({
        title: blockedSubmissionTitle,
        description: blockedSubmissionDescription,
        variant: "destructive",
      });
      return;
    }

    if (!isPhoneReady) {
      setStep("phone");
      toast({ title: "Verify your phone first", variant: "destructive" });
      return;
    }
    if (!isIdReady) {
      setStep("id_doc");
      toast({ title: "ID details are incomplete", variant: "destructive" });
      return;
    }
    if (!isSelfieReady) {
      setStep("selfie");
      toast({ title: "Selfie is required", variant: "destructive" });
      return;
    }
    if (!isLocationReady) {
      toast({
        title: "Save your address first",
        description: "Please select your province and city before submitting.",
        variant: "destructive",
      });
      return;
    }

    setIsFinalizing(true);
    try {
      await uploadIdIfNeeded();
      await uploadSelfieIfNeeded();
      await submitLocation();
      const statusSnapshot = await syncVerificationStatus();

      const locationStep = statusSnapshot?.steps.find((entry) => entry.step_type === "location");
      const _addressVerified = locationStep?.status === "approved";
      const verificationComplete = statusSnapshot?.accountStatus === "verified";

      toast({
        title: verificationComplete ? "Verification approved" : "Verification submitted",
        description: verificationComplete
          ? "Your account is verified."
          : "Everything was submitted to admin. Your application is pending review.",
        variant: "success",
      });
      setStep("complete");
    } catch (err) {
      const isEmailBlocker =
        err instanceof SubmissionError &&
        err.code === VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE;
      toast({
        title: isEmailBlocker ? "Confirm your email first" : "Submission failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsFinalizing(false);
    }
  }

  const accountVerified = accountVerificationStatus === "verified" && !reviewAttentionStep;

  const progressSteps = useMemo(() => {
    if (accountVerified) {
      return REVIEWABLE_STEP_ORDER.map((stepType) => ({
        type: stepType,
        status: "approved" as const,
      }));
    }

    if (verificationInAdminReview) {
      return REVIEWABLE_STEP_ORDER.map((stepType) => ({
        type: stepType,
        status: "pending" as const,
      }));
    }

    // Find the first step that is incomplete, rejected, or needs resubmission
    // Steps after this one should not appear "approved" even if the server says so,
    // because the earlier step blocks the flow.
    let firstIncompleteIdx = REVIEWABLE_STEP_ORDER.length;
    for (let i = 0; i < REVIEWABLE_STEP_ORDER.length; i++) {
      const s = serverStepMap.get(REVIEWABLE_STEP_ORDER[i]);
      if (!s || s.status === "rejected" || s.status === "needs_resubmission") {
        firstIncompleteIdx = i;
        break;
      }
    }

    const entries = REVIEWABLE_STEP_ORDER.flatMap((stepType, idx) => {
      const persisted = serverStepMap.get(stepType);

      // If this step is after an incomplete earlier step, cap its display
      if (idx > firstIncompleteIdx) {
        if (!persisted) return [];
        // Show persisted status but don't let it appear as "approved"
        // when an earlier step still blocks the flow
        if (persisted.status === "approved" || persisted.status === "pending") {
          return [{ type: stepType, status: "pending" as const }];
        }
        return [{ type: stepType, status: persisted.status }];
      }

      if (persisted) {
        return [{ type: stepType, status: persisted.status }];
      }
      if (completedSteps.includes(stepType)) {
        return [{ type: stepType, status: "approved" as const }];
      }
      if (step !== "complete" && step === stepType) {
        return [{ type: stepType, status: "pending" as const }];
      }
      return [];
    });

    if (!entries.length && step !== "complete") {
      return [{ type: step as VerificationStepType, status: "pending" as const }];
    }

    return entries;
  }, [accountVerified, completedSteps, serverStepMap, step, verificationInAdminReview]);

  const currentStepNumber = step === "complete" ? 4 : STEP_ORDER.indexOf(step) + 1;
  const currentStepStatus = step === "complete" ? null : serverStepMap.get(step);
  const idDocumentStatus = serverStepMap.get("id_doc")?.status;
  const selfieStatus = serverStepMap.get("selfie")?.status;
  const locationStatus = serverStepMap.get("location")?.status;

  return (
    <div className="flex min-h-screen flex-col bg-warm-50/30 dark:bg-background">
      <Header isAuthenticated />
      <main className="flex-1">
        <div className="container-page py-6">
          <div className="mx-auto w-full max-w-4xl space-y-6">
            <PageHeader
              title={
                accountVerified
                  ? "Verification Approved"
                  : verificationInAdminReview
                    ? "Verification Submitted"
                    : "Get Verified"
              }
              description={
                accountVerified
                  ? "Your account is verified. Keep these details current if anything changes."
                  : verificationInAdminReview
                    ? "Your application is pending admin review."
                    : "Complete each check once, then submit for final review."
              }
              breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Verification" }]}
            />

            <Card className="border-warm-200/70 dark:border-warm-700/70 bg-background/95">
              <CardContent className="space-y-3 p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Verification progress</p>
                  <Badge variant="secondary">
                    {accountVerified
                      ? "Approved"
                      : verificationInAdminReview
                        ? "Pending Review"
                        : step === "complete"
                          ? "Submitted"
                          : `Step ${currentStepNumber} of 4`}
                  </Badge>
                </div>
                <VerificationProgress steps={progressSteps} />
                <p className="text-xs text-muted-foreground">
                  {progressSteps.length} of 4 steps{" "}
                  {step === "complete" || allStepsResolved ? "submitted" : "captured"}
                </p>
              </CardContent>
            </Card>

            {reviewAttentionStep && (
              <Card className="border-warm-200/70 dark:border-warm-700/70 bg-background/95">
                <CardContent className="space-y-2 p-4 text-sm">
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
                    <p className="font-medium">
                      Action needed on {reviewAttentionStep.replace("_", " ")}.
                    </p>
                    <p className="mt-1 text-xs">
                      Review the notes on that step, replace the document if needed, and submit
                      again.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {!reviewAttentionStep && accountVerificationStatus === "verified" && (
              <Card className="border-warm-200/70 dark:border-warm-700/70 bg-background/95">
                <CardContent className="space-y-2 p-4 text-sm">
                  <div className="rounded-md border border-brand-green/30 bg-brand-green-50 p-3 text-brand-green-900">
                    Your verification is approved. You can still review the submitted details below.
                  </div>
                </CardContent>
              </Card>
            )}

            {!reviewAttentionStep &&
              accountVerificationStatus === "pending_review" &&
              allStepsResolved && (
                <Card className="border-warm-200/70 dark:border-warm-700/70 bg-background/95">
                  <CardContent className="space-y-2 p-4 text-sm">
                    <div className="rounded-md border border-brand-gold/30 bg-brand-gold-50 p-3 text-brand-gold-900">
                      Your verification is in admin review. We will notify you if anything needs to
                      be resubmitted.
                    </div>
                  </CardContent>
                </Card>
              )}

            {verificationSubmissionBlocked && (
              <Card className="border-amber-300/70 bg-amber-50/80 dark:border-amber-700/70 dark:bg-amber-950/20">
                <CardContent className="space-y-2 p-4 text-sm">
                  <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                    <p className="font-medium">
                      {verificationUnavailable
                        ? "Verification temporarily unavailable."
                        : verificationInAdminReview
                          ? "Verification pending admin review."
                          : "Confirm your email before submitting documents and location."}
                    </p>
                    <p className="mt-1 text-xs">
                      {verificationUnavailable
                        ? VERIFICATION_TEMPORARILY_UNAVAILABLE_DESCRIPTION
                        : verificationInAdminReview
                          ? blockedSubmissionDescription
                          : EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === "phone" && (
              <Card className="border-warm-200/70 dark:border-warm-700/70 bg-background/95">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base font-display">
                    <Phone className="h-5 w-5 text-brand-green" />
                    Step 1: Phone + OTP
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{STEP_COPY.phone}</p>

                  {currentStepStatus && (
                    <div
                      className={`rounded-md border p-3 text-sm ${getStatusBannerClasses(currentStepStatus.status)}`}
                    >
                      <p className="font-medium">{formatStatusLabel(currentStepStatus.status)}</p>
                      {currentStepStatus.reason_note && (
                        <p className="mt-1 text-xs">{currentStepStatus.reason_note}</p>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="phone">SA mobile number</Label>
                    <Input
                      id="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="071 234 5678"
                      value={phone}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      pattern="^(\\+27|0)[6-8][0-9]{8}$"
                      title="Enter a valid SA mobile number (e.g. 071 234 5678)"
                      disabled={phoneVerified || verificationUnavailable}
                    />
                  </div>

                  {!phoneVerified && (
                    <div className="space-y-2">
                      <Button
                        onClick={handleSendOtp}
                        disabled={
                          isLoading ||
                          !isPhoneValid ||
                          otpRetryAfterSeconds > 0 ||
                          verificationUnavailable
                        }
                        variant="trust-verified"
                        className="gap-2"
                      >
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowRight className="h-4 w-4" />
                        )}
                        {isLoading ? "Sending code..." : otpSent ? "Resend code" : "Send code"}
                      </Button>
                      {otpRetryAfterSeconds > 0 && (
                        <p className="text-xs text-muted-foreground">
                          You can resend a new code in {formatCountdown(otpRetryAfterSeconds)}.
                        </p>
                      )}
                      {otpSupportMessage && !otpSent && (
                        <div className="rounded-md border border-warm-200/70 bg-warm-50/80 p-3 text-xs text-muted-foreground dark:border-warm-700/70 dark:bg-warm-950/20">
                          {otpSupportMessage}
                        </div>
                      )}
                    </div>
                  )}

                  {otpSent && !phoneVerified && (
                    <div className="space-y-3 rounded-md border border-warm-200/70 dark:border-warm-700/70 p-3">
                      {otpExpirySeconds > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Enter the 6-digit code sent to {formattedPhone}. Code expires in{" "}
                          <span className="font-medium text-foreground">
                            {formatCountdown(otpExpirySeconds)}
                          </span>
                          .
                        </p>
                      ) : (
                        <p className="text-xs text-destructive font-medium">
                          Your code has expired. Please request a new one.
                        </p>
                      )}
                      {otpSupportMessage && (
                        <div className="rounded-md border border-warm-200/70 bg-warm-50/80 p-3 text-xs text-muted-foreground dark:border-warm-700/70 dark:bg-warm-950/20">
                          {otpSupportMessage}
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label htmlFor="otp">6-digit code</Label>
                        <Input
                          id="otp"
                          maxLength={6}
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                        />
                      </div>
                      <Button
                        onClick={handleVerifyOtp}
                        disabled={isLoading || !isOtpValid || otpExpirySeconds === 0}
                        variant="trust-verified"
                        className="gap-2"
                      >
                        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                        {isLoading ? "Verifying code..." : "Verify code"}
                      </Button>
                    </div>
                  )}

                  {phoneVerified && (
                    <div className="space-y-2">
                      <div className="rounded-md border border-brand-green/30 bg-brand-green-50 p-3 text-sm text-brand-green-900">
                        Phone number verified: {formattedPhone}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-11 text-sm text-muted-foreground sm:text-xs"
                        disabled={isLoading || isFinalizing}
                        onClick={() => {
                          setPhoneVerified(false);
                          setOtpSent(false);
                          setOtp("");
                          setOtpExpirySeconds(0);
                          setOtpRetryAfterSeconds(0);
                          setOtpSupportMessage(null);
                          clearStepCompletion("phone");
                        }}
                      >
                        Change phone number
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {step === "id_doc" && (
              <Card className="border-warm-200/70 dark:border-warm-700/70 bg-background/95">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base font-display">
                    <FileCheck className="h-5 w-5 text-brand-blue" />
                    Step 2: ID details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{STEP_COPY.id_doc}</p>

                  {currentStepStatus && (
                    <div
                      className={`rounded-md border p-3 text-sm ${getStatusBannerClasses(currentStepStatus.status)}`}
                    >
                      <p className="font-medium">{formatStatusLabel(currentStepStatus.status)}</p>
                      {currentStepStatus.reason_note && (
                        <p className="mt-1 text-xs">{currentStepStatus.reason_note}</p>
                      )}
                      {!currentStepStatus.reason_note && currentStepStatus.reason_code && (
                        <p className="mt-1 text-xs">
                          Reason: {formatReasonCode(currentStepStatus.reason_code)}
                        </p>
                      )}
                      {(currentStepStatus.status === "rejected" ||
                        currentStepStatus.status === "needs_resubmission") && (
                        <Link
                          href="/help/verification"
                          className="mt-1 inline-block text-xs underline"
                        >
                          Need help?
                        </Link>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="firstName">First name (as shown on ID)</Label>
                    <Input
                      id="firstName"
                      maxLength={100}
                      value={firstName}
                      disabled={verificationSubmissionBlocked}
                      onChange={(e) => {
                        setFirstName(e.target.value);
                        setUploadReceipts((prev) => ({ ...prev, id_doc: undefined }));
                        clearStepCompletion("id_doc");
                      }}
                    />
                    {firstNameError && <p className="inline-form-error">{firstNameError}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lastName">Surname (as shown on ID)</Label>
                    <Input
                      id="lastName"
                      maxLength={100}
                      value={lastName}
                      disabled={verificationSubmissionBlocked}
                      onChange={(e) => {
                        setLastName(e.target.value);
                        setUploadReceipts((prev) => ({ ...prev, id_doc: undefined }));
                        clearStepCompletion("id_doc");
                      }}
                    />
                    {lastNameError && <p className="inline-form-error">{lastNameError}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="idNumber">13-digit SA ID number</Label>
                    <Input
                      id="idNumber"
                      maxLength={13}
                      value={idNumber}
                      disabled={verificationSubmissionBlocked}
                      onChange={(e) => {
                        setIdNumber(e.target.value.replace(/\D/g, ""));
                        setUploadReceipts((prev) => ({ ...prev, id_doc: undefined }));
                        clearStepCompletion("id_doc");
                      }}
                    />
                    {idNumber.length === 13 && idChecksumValid !== null && (
                      <div
                        className={`rounded-md border p-3 text-xs ${
                          idChecksumValid
                            ? "border-brand-green/30 bg-brand-green-50 text-brand-green-900"
                            : "border-destructive/30 bg-destructive/5 text-destructive"
                        }`}
                      >
                        {idChecksumValid ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 font-medium">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              ID number valid
                            </div>
                            {idDob && <p>Date of birth: {idDob}</p>}
                            {idGender && <p>Gender: {idGender}</p>}
                            {idAgeError && (
                              <div className="flex items-center gap-1 text-red-600 font-medium">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                {idAgeError}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Invalid ID number — please check and re-enter
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>ID document photo</Label>
                    <CameraCapture
                      facingMode="environment"
                      telemetryContext="id_doc"
                      disabled={verificationSubmissionBlocked}
                      onCapture={(file) => {
                        setIdFile(file);
                        setIdCaptureMethod("camera");
                        setUploadReceipts((prev) => ({ ...prev, id_doc: undefined }));
                        clearStepCompletion("id_doc");
                      }}
                      onFallback={() => setIdCaptureMethod("file_upload")}
                    />
                    {idFileError && idFile && <p className="inline-form-error">{idFileError}</p>}
                  </div>

                  {idFile && (
                    <div className="rounded-md border border-warm-200/70 dark:border-warm-700/70 p-3 text-xs text-muted-foreground">
                      {idFile.name} ({formatFileSize(idFile.size)})
                    </div>
                  )}

                  {idPreviewUrl && idCaptureMethod === "file_upload" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={idPreviewUrl}
                      alt="ID preview"
                      className="max-h-80 w-full rounded-md border object-contain"
                    />
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setStep("phone")}
                      className="h-11 gap-1"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back
                    </Button>
                    <Button
                      onClick={goToSelfieStep}
                      disabled={!isIdReady || isUploadingId || verificationSubmissionBlocked}
                      variant="trust-verified"
                      className="h-11 gap-1"
                    >
                      {isUploadingId ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Uploading…
                        </>
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === "selfie" && (
              <Card className="border-warm-200/70 dark:border-warm-700/70 bg-background/95">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base font-display">
                    <Camera className="h-5 w-5 text-brand-gold" />
                    Step 3: Selfie
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{STEP_COPY.selfie}</p>

                  {currentStepStatus && (
                    <div
                      className={`rounded-md border p-3 text-sm ${getStatusBannerClasses(currentStepStatus.status)}`}
                    >
                      <p className="font-medium">{formatStatusLabel(currentStepStatus.status)}</p>
                      {currentStepStatus.reason_note && (
                        <p className="mt-1 text-xs">{currentStepStatus.reason_note}</p>
                      )}
                      {!currentStepStatus.reason_note && currentStepStatus.reason_code && (
                        <p className="mt-1 text-xs">
                          Reason: {formatReasonCode(currentStepStatus.reason_code)}
                        </p>
                      )}
                      {(currentStepStatus.status === "rejected" ||
                        currentStepStatus.status === "needs_resubmission") && (
                        <Link
                          href="/help/verification"
                          className="mt-1 inline-block text-xs underline"
                        >
                          Need help?
                        </Link>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Selfie image</Label>
                    <CameraCapture
                      facingMode="user"
                      telemetryContext="selfie"
                      disabled={verificationSubmissionBlocked}
                      onCapture={(file) => {
                        setSelfieFile(file);
                        setSelfieCaptureMethod("camera");
                        setUploadReceipts((prev) => ({ ...prev, selfie: undefined }));
                        clearStepCompletion("selfie");
                      }}
                      onFallback={() => setSelfieCaptureMethod("file_upload")}
                    />
                    {selfieFileError && selfieFile && (
                      <p className="inline-form-error">{selfieFileError}</p>
                    )}
                  </div>

                  {selfieFile && (
                    <div className="rounded-md border border-warm-200/70 dark:border-warm-700/70 p-3 text-xs text-muted-foreground">
                      {selfieFile.name} ({formatFileSize(selfieFile.size)})
                    </div>
                  )}

                  {selfiePreviewUrl && selfieCaptureMethod === "file_upload" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selfiePreviewUrl}
                      alt="Selfie preview"
                      className="max-h-80 w-full rounded-md border object-contain"
                    />
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setStep("id_doc")}
                      className="h-11 gap-1"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back
                    </Button>
                    <Button
                      onClick={goToLocationStep}
                      disabled={
                        !isSelfieReady || isUploadingSelfie || verificationSubmissionBlocked
                      }
                      variant="trust-verified"
                      className="h-11 gap-1"
                    >
                      {isUploadingSelfie ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Uploading…
                        </>
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === "location" && (
              <div className="grid gap-6 lg:grid-cols-5">
                <Card className="border-warm-200/70 dark:border-warm-700/70 bg-background/95 lg:col-span-3">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base font-display">
                      <MapPin className="h-5 w-5 text-brand-red" />
                      Step 4: Verify Your Address
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{STEP_COPY.location}</p>

                    {currentStepStatus && (
                      <div
                        className={`rounded-md border p-3 text-sm ${getStatusBannerClasses(currentStepStatus.status)}`}
                      >
                        <p className="font-medium">{formatStatusLabel(currentStepStatus.status)}</p>
                        {currentStepStatus.reason_note && (
                          <p className="mt-1 text-xs">{currentStepStatus.reason_note}</p>
                        )}
                        {!currentStepStatus.reason_note && currentStepStatus.reason_code && (
                          <p className="mt-1 text-xs">
                            Reason: {formatReasonCode(currentStepStatus.reason_code)}
                          </p>
                        )}
                        {(currentStepStatus.status === "rejected" ||
                          currentStepStatus.status === "needs_resubmission") && (
                          <Link
                            href="/help/verification"
                            className="mt-1 inline-block text-xs underline"
                          >
                            Need help?
                          </Link>
                        )}
                      </div>
                    )}

                    {/* Manual Province + City Selection */}
                    <div className="space-y-3 rounded-md border border-warm-200/70 p-4 dark:border-warm-700/70">
                      <h4 className="flex items-center gap-2 text-sm font-medium">
                        <MapPin className="h-4 w-4 text-brand-red" />
                        Select Your Location
                      </h4>

                      <LocationSelector
                        value={{ province, city, town: locationTown }}
                        onChange={(v) => {
                          setProvince(v.province);
                          setCity(v.city);
                          setLocationTown(v.town ?? "");
                          setGpsApproved(false);
                          setGpsStatus("idle");
                          setGpsCoords(null);
                          setGpsConfidence(null);
                          setGpsProvince(null);
                          setGpsMismatch(null);
                        }}
                        cityLabel="City"
                        showTown
                        suggestTownOptions={false}
                        showAddress={false}
                        disabled={manualSubmitting || verificationSubmissionBlocked}
                      />

                      <Button
                        onClick={handleManualLocationSubmit}
                        disabled={
                          !province || !city || manualSubmitting || verificationSubmissionBlocked
                        }
                        variant="default"
                        size="sm"
                        className="h-11 gap-2"
                      >
                        {manualSubmitting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MapPin className="h-4 w-4" />
                        )}
                        {locationSaved ? "Update Address" : "Save Address"}
                      </Button>

                      {locationSaved && locationSummary && (
                        <div className="rounded-md border border-warm-200/70 bg-warm-50/50 p-3 text-sm dark:border-warm-700/70 dark:bg-warm-950/20">
                          <div className="flex items-center gap-2 text-foreground">
                            <CheckCircle2 className="h-4 w-4 text-brand-green" />
                            <span className="font-medium">
                              {locationVerified ? "GPS-verified address" : "Saved address"}
                            </span>
                          </div>
                          <p className="mt-1 text-muted-foreground">{locationSummary}</p>
                          {!locationVerified && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Your selected address is saved. Use GPS to confirm it matches your
                              device location.
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* GPS Confirmation (Recommended) */}
                    {locationSaved && !locationVerified && (
                      <div className="space-y-3 rounded-md border border-dashed border-brand-blue/40 p-4 bg-brand-blue/5">
                        <h4 className="flex items-center gap-2 text-sm font-medium">
                          <Navigation className="h-4 w-4 text-brand-blue" />
                          Verify with GPS (Recommended)
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          Use GPS to confirm the province and city you selected match your device
                          location.
                        </p>

                        {gpsFeatureAvailable && gpsStatus === "idle" && (
                          <Button
                            onClick={handleRequestGps}
                            variant="outline"
                            className="h-11 gap-2"
                            size="sm"
                            disabled={verificationSubmissionBlocked}
                          >
                            <Navigation className="h-4 w-4" />
                            Verify Address with GPS
                          </Button>
                        )}

                        {gpsStatus === "requesting" && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Requesting GPS access…
                          </div>
                        )}

                        {(gpsStatus === "denied" || gpsStatus === "error") && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {gpsStatus === "denied"
                                ? "GPS permission denied. Your saved address remains saved, but not GPS-verified."
                                : "GPS unavailable. Your saved address remains saved, but not GPS-verified."}
                            </div>
                            <Button
                              onClick={() => {
                                setGpsStatus("idle");
                                setGpsApproved(false);
                                setGpsCoords(null);
                                setGpsConfidence(null);
                                setGpsProvince(null);
                                setGpsMismatch(null);
                              }}
                              variant="ghost"
                              size="sm"
                              className="h-11 gap-2 text-sm sm:text-xs"
                            >
                              <Navigation className="h-3.5 w-3.5" />
                              Try Again
                            </Button>
                          </div>
                        )}

                        {!gpsFeatureAvailable && (
                          <p className="text-xs text-muted-foreground">
                            GPS is not available on this device. Your saved address remains on file
                            without GPS confirmation.
                          </p>
                        )}
                      </div>
                    )}

                    {/* GPS Confirmation Result */}
                    {gpsStatus === "success" && gpsCoords && (
                      <div
                        className={`space-y-2 rounded-md border p-4 ${
                          locationVerified
                            ? "border-brand-green/30 bg-brand-green-50/30 dark:bg-brand-green-950/20"
                            : "border-amber-400/30 bg-amber-50/60 dark:bg-amber-950/20"
                        }`}
                      >
                        <div
                          className={`flex items-center gap-2 text-sm ${
                            locationVerified
                              ? "text-brand-green"
                              : "text-amber-700 dark:text-amber-300"
                          }`}
                        >
                          {locationVerified ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <Navigation className="h-4 w-4" />
                          )}
                          {locationVerified
                            ? `Address verified by GPS (accuracy: within ${Math.round(gpsCoords.accuracy)} metres)`
                            : `GPS checked the saved address (accuracy: within ${Math.round(gpsCoords.accuracy)} metres)`}
                        </div>
                        {gpsMismatch?.province && (
                          <div className="rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
                            GPS detected a different province ({gpsProvince}). Your saved address
                            was kept, but it was not GPS-verified.
                          </div>
                        )}
                        {gpsMismatch && !gpsMismatch.province && gpsMismatch.city && (
                          <div className="rounded-md border border-yellow-300/50 bg-yellow-50 px-3 py-2 text-xs text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400">
                            GPS detected a different city. Your saved address was kept without a GPS
                            verification tick.
                          </div>
                        )}
                        {!gpsMismatch && !locationVerified && (
                          <div className="text-xs text-amber-700 dark:text-amber-300">
                            GPS captured your location, but it did not match the province and city
                            you selected closely enough to add GPS verification.
                          </div>
                        )}
                        {locationVerified && (
                          <div className="text-xs text-brand-green">
                            GPS matches the province and city you selected.
                          </div>
                        )}
                        {gpsConfidence && (
                          <div className="text-xs text-muted-foreground">
                            Confidence:{" "}
                            <span className="font-medium capitalize">{gpsConfidence}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setStep("selfie")}
                        disabled={isFinalizing}
                        className="h-11 gap-1"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        Back
                      </Button>
                      <Button
                        onClick={handleFinalize}
                        disabled={!isLocationReady || isFinalizing || verificationSubmissionBlocked}
                        variant="trust-verified"
                        className="h-11 gap-2"
                      >
                        {isFinalizing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-4 w-4" />
                        )}
                        Submit Verification
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-warm-200/70 dark:border-warm-700/70 bg-background/95 lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base font-display">Final Review</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="rounded-md border border-warm-200/70 dark:border-warm-700/70 p-3">
                      <p className="font-medium">Phone</p>
                      {phoneVerified ? (
                        <div className="mt-1 flex items-center gap-1 text-brand-green">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Verified</span>
                        </div>
                      ) : (
                        <div className="mt-1 flex items-center gap-1 text-muted-foreground">
                          <Clock3 className="h-4 w-4" />
                          <span>Pending</span>
                        </div>
                      )}
                    </div>

                    <div className="rounded-md border border-warm-200/70 dark:border-warm-700/70 p-3">
                      <p className="font-medium">ID Document</p>
                      {uploadReceipts.id_doc ? (
                        <p className="mt-1 text-muted-foreground">
                          {idDocumentStatus ? `${formatStatusLabel(idDocumentStatus)} - ` : ""}
                          Uploaded at {formatUploadedTime(uploadReceipts.id_doc.uploadedAtIso)}
                        </p>
                      ) : (
                        <p className="mt-1 text-muted-foreground">
                          Not yet uploaded — go to the ID step above to upload your document
                        </p>
                      )}
                      {idChecksumValid && idDob && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          DOB: {idDob}
                          {idGender ? ` · ${idGender}` : ""}
                        </p>
                      )}
                    </div>

                    <div className="rounded-md border border-warm-200/70 dark:border-warm-700/70 p-3">
                      <p className="font-medium">Selfie</p>
                      {uploadReceipts.selfie ? (
                        <p className="mt-1 text-muted-foreground">
                          {selfieStatus ? `${formatStatusLabel(selfieStatus)} - ` : ""}
                          Uploaded at {formatUploadedTime(uploadReceipts.selfie.uploadedAtIso)}
                        </p>
                      ) : (
                        <p className="mt-1 text-muted-foreground">
                          Not yet uploaded — go to the Selfie step above to take your photo
                        </p>
                      )}
                    </div>

                    <div className="rounded-md border border-warm-200/70 dark:border-warm-700/70 p-3">
                      <p className="font-medium">Location</p>
                      {locationSaved && locationSummary ? (
                        <div className="mt-1 space-y-1">
                          <p className="text-muted-foreground">{locationSummary}</p>
                          <div className="flex items-center gap-1 text-xs">
                            <span className="text-brand-green flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              {locationVerified
                                ? "GPS verified"
                                : locationStatus
                                  ? formatStatusLabel(locationStatus)
                                  : "Address saved"}
                              {locationVerified && gpsConfidence ? ` (GPS: ${gpsConfidence})` : ""}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 flex items-center gap-1 text-muted-foreground">
                          <Clock3 className="h-4 w-4" />
                          <span>Not set</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {step === "complete" && (
              <Card
                className={
                  accountVerified
                    ? "border-brand-green/40 bg-brand-green-50/30 dark:bg-brand-green-950/30"
                    : "border-brand-gold/40 bg-brand-gold-50/40 dark:bg-brand-gold-950/20"
                }
              >
                <CardContent className="space-y-3 py-6 text-center">
                  <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-green-100 text-brand-green dark:bg-brand-green-900">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <h2 className="font-display text-xl font-bold">
                    {accountVerificationStatus === "verified"
                      ? "Verification Approved"
                      : "Verification Submitted"}
                  </h2>
                  <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                    {accountVerificationStatus === "verified"
                      ? "Your account is verified."
                      : "Everything was submitted to admin. Your application is pending review."}
                  </p>
                  <div className="mx-auto w-full max-w-lg space-y-2 text-left">
                    {REVIEWABLE_STEP_ORDER.map((stepType) => {
                      const statusEntry = serverStepMap.get(stepType);
                      const displayStatus = accountVerified
                        ? "approved"
                        : verificationInAdminReview
                          ? "pending"
                          : (statusEntry?.status ?? "pending");
                      return (
                        <div
                          key={stepType}
                          className="rounded-md border border-warm-200/70 dark:border-warm-700/70 bg-background/80 px-3 py-2 text-sm"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium capitalize">
                              {stepType.replace("_", " ")}
                            </span>
                            <Badge variant="outline">{formatStatusLabel(displayStatus)}</Badge>
                          </div>
                          {statusEntry?.reason_note && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {statusEntry.reason_note}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <Button variant="trust-verified" asChild className="h-11 gap-2">
                    <Link href={completionHref}>
                      {getCompletionCtaLabel(completionHref)}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
