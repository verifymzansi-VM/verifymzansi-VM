"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileImage,
  IdCard,
  Loader2,
  MailCheck,
  MapPin,
  MessageSquareText,
  Navigation,
  ScanFace,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import {
  VerificationProgress,
  type VerificationReviewState,
} from "@/components/trust/verification-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
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
  VerificationStatus,
  AccountVerificationStatus,
} from "@/types/enums";
import {
  VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE,
  VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
  isVerificationEmailConfirmationRequired,
} from "@/lib/constants/verification-email-confirmation";
import { LocationSelector } from "@/components/ui/location-selector";
import { CameraCapture } from "@/components/ui/camera-capture";
import { isValidSaPhone, sanitizeSaPhoneInput } from "@/lib/utils/phone";
import {
  FieldGroupHeading,
  HelpLinkCard,
  OverallStatusPill,
  PrivacyPanel,
  StatusCallout,
  StepActions,
  StepCard,
  WhatHappensNextPanel,
  type CalloutTone,
  type OverallVerificationState,
} from "./verification-ui";

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
};

const REVIEWABLE_STEP_ORDER: VerificationStepType[] = ["phone", "id_doc", "selfie", "location"];
const STEP_STATUS_PRIORITY: Record<VerificationStatus, number> = {
  rejected: 4,
  needs_resubmission: 3,
  approved: 2,
  pending: 1,
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

type VerificationApiResponse = {
  success?: boolean;
  preview?: boolean;
  persisted?: boolean;
  warning?: string;
  verified?: boolean;
  stepStatus?: VerificationStatus;
  confidence?: string;
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

/** One short reassurance line per step. */
const STEP_WHY: Record<Exclude<WizardStep, "complete">, string> = {
  phone: "We'll SMS you a 6-digit code to confirm it's you.",
  id_doc: "Encrypted, and never shown publicly.",
  selfie: "Matched to your ID photo. Only our review team sees it.",
  location: "Province and city only, never your street address.",
};

/** Human labels for step rows (never show raw enum keys like "id_doc"). */
const STEP_DISPLAY_LABELS: Record<VerificationStepType, string> = {
  phone: "Phone",
  id_doc: "ID document",
  selfie: "Selfie",
  location: "Location",
};

const SA_MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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
  location_mismatch: "Confirm your province and city manually, then save your location.",
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
      return "Pending review";
    case "rejected":
      return "Not accepted";
    case "needs_resubmission":
      return "Needs resubmission";
    default:
      return status;
  }
}

function getStepLabel(stepType: VerificationStepType): string {
  switch (stepType) {
    case "id_doc":
      return "ID document";
    case "selfie":
      return "selfie";
    case "location":
      return "location";
    case "phone":
      return "phone";
    default:
      return stepType;
  }
}

function getFallbackRejectionReason(stepType: VerificationStepType): string {
  switch (stepType) {
    case "id_doc":
      return "Your ID document was not accepted. Upload a clear photo showing the full document and all details.";
    case "selfie":
      return "Your selfie was not accepted. Retake a clear live selfie with your face fully visible.";
    case "location":
      return "Your location could not be verified. Confirm your province and city, then save your location again.";
    case "phone":
      return "Your phone verification was not accepted. Please verify your number again.";
    default:
      return "This verification step was not accepted. Please submit it again.";
  }
}

function getStepStatusDetail(entry: StepStatusEntry | null | undefined): string | null {
  if (!entry) return null;
  if (entry.reason_note) return entry.reason_note;
  if (entry.reason_code) return `Reason: ${formatReasonCode(entry.reason_code)}`;
  if (entry.status === "rejected" || entry.status === "needs_resubmission") {
    return getFallbackRejectionReason(entry.step_type);
  }
  return null;
}

function getStatusTone(status: VerificationStatus): CalloutTone {
  switch (status) {
    case "approved":
      return "success";
    case "pending":
      return "pending";
    case "rejected":
    case "needs_resubmission":
      return "attention";
    default:
      return "neutral";
  }
}

const STATUS_CHIP_CLASSES: Record<VerificationStatus, string> = {
  approved:
    "bg-brand-green-50 text-brand-green-800 ring-brand-green-600/20 dark:bg-brand-green-500/10 dark:text-brand-green-200 dark:ring-brand-green-400/25",
  pending:
    "bg-brand-gold-50 text-brand-gold-900 ring-brand-gold-400/40 dark:bg-brand-gold-400/10 dark:text-brand-gold-100 dark:ring-brand-gold-400/25",
  rejected:
    "bg-brand-red-50 text-brand-red-800 ring-brand-red-600/20 dark:bg-brand-red-500/10 dark:text-brand-red-200 dark:ring-brand-red-400/25",
  needs_resubmission:
    "bg-brand-red-50 text-brand-red-800 ring-brand-red-600/20 dark:bg-brand-red-500/10 dark:text-brand-red-200 dark:ring-brand-red-400/25",
};

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

function areAllReviewStepsSubmitted(statusSteps: StepStatusEntry[]) {
  const stepStatusMap = buildStepStatusMap(statusSteps);

  return REVIEWABLE_STEP_ORDER.every((stepType) => {
    const status = stepStatusMap.get(stepType);
    return status === "approved" || (stepType !== "location" && status === "pending");
  });
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

  if (
    phoneDone &&
    stepStatusMap.get("location") === "pending" &&
    (["id_doc", "selfie"] as const).every((stepType) =>
      ["approved", "pending"].includes(stepStatusMap.get(stepType) ?? "")
    )
  ) {
    return "location";
  }

  if (phoneDone && allSubmitted) {
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

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/** HH:mm in South African time, identical on every device (no Intl/locale APIs). */
function formatUploadedTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const sast = new Date(date.getTime() + SAST_OFFSET_MS);
  const hours = String(sast.getUTCHours()).padStart(2, "0");
  const minutes = String(sast.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Date of birth from the ID digits (a UTC-midnight Date), read in UTC so it never shifts a day. */
function formatDateOfBirth(date: Date): string {
  return `${date.getUTCDate()} ${SA_MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
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
    return "Go to dashboard";
  }

  if (completionHref.startsWith("/post/")) {
    return "Return to posting";
  }

  return "Continue where you left off";
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
  // Name errors wait until the member has left the field, so a fresh form is not shouting.
  const [nameFieldsTouched, setNameFieldsTouched] = useState({ first: false, last: false });
  const [idFile, setIdFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [idCaptureMethod, setIdCaptureMethod] = useState<"camera" | "file_upload">("camera");
  const [selfieCaptureMethod, setSelfieCaptureMethod] = useState<"camera" | "file_upload">(
    "camera"
  );
  const [selfieLivenessPassed, setSelfieLivenessPassed] = useState(false);
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");

  // Session-driven state
  const [_sessionId, setSessionId] = useState<string | null>(null);
  const [_sessionLoading, setSessionLoading] = useState(true);
  const [_useV2Flow, setUseV2Flow] = useState(false);
  const [serverSteps, setServerSteps] = useState<StepStatusEntry[]>([]);
  const [accountVerificationStatus, setAccountVerificationStatus] =
    useState<AccountVerificationStatus | null>(null);

  const [detectingLocation, setDetectingLocation] = useState(false);
  const [locationDetectionMessage, setLocationDetectionMessage] = useState("");

  // Manual location state
  const [manualSubmitted, setManualSubmitted] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);

  // SA ID validation feedback
  const [idDob, setIdDob] = useState<string | null>(null);
  const [idGender, setIdGender] = useState<string | null>(null);
  const [idChecksumValid, setIdChecksumValid] = useState<boolean | null>(null);
  const [idAgeError, setIdAgeError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
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
  const showFirstNameError = Boolean(
    firstNameError && (nameFieldsTouched.first || normalizedFirstName.length > 0)
  );
  const showLastNameError = Boolean(
    lastNameError && (nameFieldsTouched.last || normalizedLastName.length > 0)
  );
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
  const persistedLocationSubmitted = ["approved"].includes(
    serverStepMap.get("location")?.status ?? ""
  );
  const persistedLocationStep = serverStepMap.get("location");
  const locationSaved = persistedLocationSubmitted || manualSubmitted;
  const locationVerified = persistedLocationStep?.status === "approved" || manualSubmitted;
  const hasSelectedLocation = Boolean(province && city);
  const locationSummary = formatLocationSummary("", city, province);
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
  const locationSubmissionLocked = locationSaved && !reviewAttentionStep;
  const verificationInAdminReview =
    !reviewAttentionStep &&
    accountVerificationStatus === "pending_review" &&
    allStepsResolved &&
    serverStepMap.get("location")?.status !== "pending";
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
      const res = await fetch("/api/verification/status", { cache: "no-store" });
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
        setManualSubmitted(nextLocationStep.status === "approved");
      }

      const approvedSteps = nextSteps
        .filter((entry) => entry.status === "approved" || entry.status === "pending")
        .map((entry) => entry.step_type);
      const attentionStepTypes = new Set(
        nextSteps
          .filter((entry) => entry.status === "rejected" || entry.status === "needs_resubmission")
          .map((entry) => entry.step_type)
      );
      setCompletedSteps((previousSteps) =>
        Array.from(
          new Set([
            ...previousSteps.filter((stepType) => !attentionStepTypes.has(stepType)),
            ...approvedSteps,
          ])
        )
      );
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
        locationSubmittedAt?: string | null;
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
            Boolean(sessionData?.finalizedAt) &&
            ((sessionData?.completedSteps?.length ?? 0) +
              (sessionData?.pendingSteps?.length ?? 0) >=
              (sessionData?.requiredSteps?.length ?? 4) ||
              Boolean(sessionData?.locationSubmittedAt));

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
          setIdDob(dob ? formatDateOfBirth(dob) : null);
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

  async function handleDetectLocation() {
    if (detectingLocation) return;
    setDetectingLocation(true);
    setLocationDetectionMessage("");
    try {
      const response = await fetch("/api/verification/location/detect", {
        method: "POST",
        headers: withCsrfHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (applyEmailConfirmationBlocker(data)) return;
      if (response.ok && data.province && data.city) {
        setProvince(data.province);
        setCity(data.city);
        setLocationDetectionMessage(
          "Location suggested. Check your province and city before submitting."
        );
      } else {
        setLocationDetectionMessage(
          "We could not detect your province and city. Select them below to continue."
        );
      }
    } catch {
      setLocationDetectionMessage(
        "Location detection is unavailable. Select your province and city below."
      );
    } finally {
      setDetectingLocation(false);
    }
  }

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
      const statusSnapshot = await syncVerificationStatus();
      if (statusSnapshot?.steps && areAllReviewStepsSubmitted(statusSnapshot.steps)) {
        setStep("complete");
        toast({
          title: "Verification submitted",
          description: "Your selfie has been submitted. Your verification is pending admin review.",
          variant: "success",
        });
        return;
      }

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
      if (selfieCaptureMethod === "camera" && selfieLivenessPassed) {
        fd.append("livenessPassed", "true");
      }
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

  async function handleManualLocationSubmit() {
    if (locationSubmissionLocked) {
      toast({
        title: "Location already submitted",
        description: "Your province and city have already been approved.",
        variant: "default",
      });
      return;
    }

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
        body: JSON.stringify({ province, city }),
      });
      const data = (await res.json().catch(() => ({}))) as VerificationApiResponse;

      if (res.ok) {
        await syncVerificationStatus();
        setManualSubmitted(true);
        toast({
          title: "Location approved",
          description:
            "Your province and city are saved and automatically approved. No admin review is needed for your location.",
          variant: "success",
        });
        setStep("complete");
      } else {
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

  const accountVerified = accountVerificationStatus === "verified" && !reviewAttentionStep;

  const progressSteps = useMemo(() => {
    if (accountVerified) {
      return REVIEWABLE_STEP_ORDER.map((stepType) => ({
        type: stepType,
        status: "approved" as const,
      }));
    }

    const entries = REVIEWABLE_STEP_ORDER.flatMap((stepType) => {
      const persisted = serverStepMap.get(stepType);

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
  }, [accountVerified, completedSteps, serverStepMap, step]);

  const currentStepStatus = step === "complete" ? null : serverStepMap.get(step);
  const idDocumentStatus = serverStepMap.get("id_doc")?.status;
  const selfieStatus = serverStepMap.get("selfie")?.status;
  const currentStepStatusDetail = getStepStatusDetail(currentStepStatus);

  const doneStepCount = accountVerified
    ? REVIEWABLE_STEP_ORDER.length
    : REVIEWABLE_STEP_ORDER.filter((stepType) => {
        const status = serverStepMap.get(stepType)?.status;
        return status === "approved" || status === "pending" || completedSteps.includes(stepType);
      }).length;
  const overallState: OverallVerificationState = accountVerified
    ? "verified"
    : reviewAttentionStep
      ? "attention"
      : verificationInAdminReview || step === "complete"
        ? "pending"
        : step !== "phone" || otpSent || completedSteps.length > 0 || serverSteps.length > 0
          ? "in_progress"
          : "not_started";
  const reviewState: VerificationReviewState =
    overallState === "verified"
      ? "approved"
      : overallState === "attention"
        ? "attention"
        : overallState === "pending"
          ? "pending"
          : "not_started";
  // A verified account has nothing left to submit, so an unavailable
  // verification service is not worth alarming them about.
  const showBlockedNotice =
    verificationSubmissionBlocked && !verificationInAdminReview && !accountVerified;
  const heroTitle = accountVerified
    ? "You're verified"
    : step === "complete" || verificationInAdminReview
      ? "Your details are with our review team"
      : "Get verified";
  const heroDescription = accountVerified
    ? "Keep your details current if anything changes."
    : step === "complete" || verificationInAdminReview
      ? "We'll let you know if anything needs fixing."
      : reviewAttentionStep
        ? "One check needs another look."
        : "Four quick checks. Your details stay private.";
  const breadcrumbs = [{ label: "Dashboard", href: "/dashboard" }, { label: "Verification" }];
  const inAdminReviewMessage =
    "Your identity documents are in admin review. Your location needs no admin approval.";

  const renderStepStatusNotice = (showHelp: boolean) =>
    step === "location" && currentStepStatus?.status === "pending" ? (
      <StatusCallout tone="neutral" title="Confirm your location">
        Select your province and city, then submit for immediate location approval.
      </StatusCallout>
    ) : currentStepStatus ? (
      <StatusCallout
        tone={getStatusTone(currentStepStatus.status)}
        title={formatStatusLabel(currentStepStatus.status)}
      >
        {currentStepStatusDetail && <p>{currentStepStatusDetail}</p>}
        {showHelp &&
          (currentStepStatus.status === "rejected" ||
            currentStepStatus.status === "needs_resubmission") && (
            <Link
              href="/help/verification"
              prefetch={false}
              className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
            >
              Need help?
            </Link>
          )}
      </StatusCallout>
    ) : null;

  if (_sessionLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header isAuthenticated />
        <main id="main-content" className="flex-1">
          <div className="container-page py-5 sm:py-8">
            <div className="mx-auto w-full max-w-5xl space-y-5" aria-busy="true">
              <section className="hero-panel p-5 sm:p-7">
                <Breadcrumbs items={breadcrumbs} />
                <h1 className="mt-4 font-display text-[1.75rem] font-bold leading-[1.1] tracking-tight sm:text-[2.25rem]">
                  Checking verification status
                </h1>
                <p
                  role="status"
                  className="mt-2 flex items-center gap-2 text-sm leading-6 text-muted-foreground sm:text-base"
                >
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin text-brand-green-700 motion-reduce:animate-none dark:text-brand-green-300"
                    aria-hidden="true"
                  />
                  Loading your latest verification status...
                </p>
                <div className="mt-6 grid grid-cols-5 gap-2" aria-hidden="true">
                  {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="flex flex-col items-center gap-2">
                      <Skeleton className="h-9 w-9 rounded-full" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  ))}
                </div>
              </section>
              <div
                className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6"
                aria-hidden="true"
              >
                <div className="surface-card space-y-4 p-5 sm:p-6">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-12 w-12 rounded-2xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-6 w-48" />
                    </div>
                  </div>
                  <Skeleton className="h-14 w-full rounded-xl" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                  <Skeleton className="h-12 w-40 rounded-xl" />
                </div>
                <div className="surface-card hidden space-y-3 p-5 lg:block">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header isAuthenticated />
      <main id="main-content" className="flex-1">
        <div className="container-page py-5 sm:py-8">
          <div className="mx-auto w-full max-w-5xl space-y-5 sm:space-y-6">
            <section aria-labelledby="verification-title" className="hero-panel">
              <div
                aria-hidden="true"
                className="mzansi-pattern pointer-events-none absolute inset-0 opacity-[0.035] [mask-image:linear-gradient(to_left,black,transparent_65%)] dark:opacity-[0.05] dark:invert"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-brand-green-400/15 blur-3xl dark:bg-brand-green-500/15"
              />
              <div className="relative p-5 sm:p-7">
                <Breadcrumbs items={breadcrumbs} />
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <h1
                      id="verification-title"
                      className="font-display text-[1.75rem] font-bold leading-[1.1] tracking-tight text-foreground sm:text-[2.25rem]"
                    >
                      {heroTitle}
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                      {heroDescription}
                    </p>
                  </div>
                  <OverallStatusPill state={overallState} className="shrink-0 self-start" />
                </div>

                <div className="mt-5 rounded-2xl border border-border/60 bg-card/70 p-3 pb-4 sm:mt-6 sm:p-5">
                  <div className="mb-4 flex items-baseline justify-between gap-3 px-1">
                    <p className="text-sm font-semibold text-foreground">Your progress</p>
                    <p className="text-xs text-muted-foreground">
                      {doneStepCount} of 4 steps{" "}
                      {step === "complete" || allStepsResolved ? "submitted" : "done"}
                    </p>
                  </div>
                  <VerificationProgress
                    steps={progressSteps}
                    currentStep={step === "complete" ? null : step}
                    reviewState={reviewState}
                  />
                </div>
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
              <div className="min-w-0 space-y-5">
                {reviewAttentionStep && (
                  <StatusCallout
                    tone="attention"
                    title={`Action needed on ${getStepLabel(reviewAttentionStep)}.`}
                  >
                    {/* The open step repeats the reviewer's note, so only show it here
                        when the member is looking at a different step. */}
                    {step !== reviewAttentionStep &&
                      getStepStatusDetail(serverStepMap.get(reviewAttentionStep)) && (
                        <p>{getStepStatusDetail(serverStepMap.get(reviewAttentionStep))}</p>
                      )}
                    <p>
                      Review the notes on that step, replace the document if needed, and submit
                      again.
                    </p>
                  </StatusCallout>
                )}

                {!reviewAttentionStep &&
                  accountVerificationStatus === "verified" &&
                  step !== "complete" && (
                    <StatusCallout tone="success">
                      <p>
                        Your verification is approved. You can still review the submitted details
                        below.
                      </p>
                    </StatusCallout>
                  )}

                {/* On the complete screen the submitted card carries this message,
                    so it is only shown here while a step is still open. */}
                {verificationInAdminReview && step !== "complete" && (
                  <StatusCallout tone="pending">
                    <p>{inAdminReviewMessage}</p>
                  </StatusCallout>
                )}

                {showBlockedNotice && (
                  <StatusCallout
                    tone="pending"
                    icon={verificationUnavailable ? AlertTriangle : MailCheck}
                    title={
                      verificationUnavailable
                        ? "Verification temporarily unavailable."
                        : "Confirm your email before submitting documents and location."
                    }
                  >
                    <p>
                      {verificationUnavailable
                        ? VERIFICATION_TEMPORARILY_UNAVAILABLE_DESCRIPTION
                        : EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION}
                    </p>
                  </StatusCallout>
                )}

                {step === "phone" && (
                  <StepCard
                    id="verification-step-phone"
                    stepNumber={1}
                    title="Phone + OTP"
                    icon={Smartphone}
                    why={STEP_WHY.phone}
                  >
                    {renderStepStatusNotice(false)}

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
                        className="h-12 text-base sm:h-12 sm:text-base"
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
                          variant={otpSent ? "outline" : "trust-verified"}
                          size="lg"
                          className="w-full sm:w-auto"
                        >
                          {isLoading ? (
                            <Loader2
                              className="h-4 w-4 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                          ) : (
                            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                          )}
                          {isLoading ? "Sending code..." : otpSent ? "Resend code" : "Send code"}
                        </Button>
                        {otpRetryAfterSeconds > 0 && (
                          <p className="text-xs text-muted-foreground" aria-live="polite">
                            You can resend a new code in {formatCountdown(otpRetryAfterSeconds)}.
                          </p>
                        )}
                        {otpSupportMessage && !otpSent && (
                          <p className="rounded-xl bg-muted/70 px-3.5 py-3 text-xs leading-5 text-muted-foreground">
                            {otpSupportMessage}
                          </p>
                        )}
                      </div>
                    )}

                    {otpSent && !phoneVerified && (
                      <div className="space-y-4 rounded-2xl border border-border bg-muted/40 p-4 sm:p-5">
                        {otpExpirySeconds > 0 ? (
                          <p className="text-sm leading-6 text-muted-foreground">
                            Enter the 6-digit code sent to {formattedPhone}. Code expires in{" "}
                            <span className="font-semibold tabular-nums text-foreground">
                              {formatCountdown(otpExpirySeconds)}
                            </span>
                            .
                          </p>
                        ) : (
                          <p className="text-sm font-semibold text-destructive" role="alert">
                            Your code has expired. Please request a new one.
                          </p>
                        )}
                        {otpSupportMessage && (
                          <p className="rounded-xl bg-card px-3.5 py-3 text-xs leading-5 text-muted-foreground">
                            {otpSupportMessage}
                          </p>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor="otp">6-digit code</Label>
                          <Input
                            id="otp"
                            maxLength={6}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            value={otp}
                            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                            className="h-14 max-w-xs text-center font-display text-2xl font-semibold tracking-[0.4em] sm:h-14 sm:text-2xl"
                          />
                        </div>
                        <Button
                          onClick={handleVerifyOtp}
                          disabled={isLoading || !isOtpValid || otpExpirySeconds === 0}
                          variant="trust-verified"
                          size="lg"
                          className="w-full sm:w-auto"
                        >
                          {isLoading && (
                            <Loader2
                              className="h-4 w-4 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                          )}
                          {isLoading ? "Verifying code..." : "Verify code"}
                        </Button>
                      </div>
                    )}

                    {phoneVerified && (
                      <>
                        <StatusCallout tone="success">
                          <p className="font-semibold">Phone number verified: {formattedPhone}</p>
                        </StatusCallout>
                        <StepActions>
                          <Button
                            variant="ghost"
                            className="h-11"
                            disabled={isLoading}
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
                          <Button
                            variant="trust-verified"
                            size="lg"
                            className="w-full sm:w-auto"
                            onClick={() => setStep("id_doc")}
                          >
                            Next: ID details
                          </Button>
                        </StepActions>
                      </>
                    )}
                  </StepCard>
                )}

                {step === "id_doc" && (
                  <StepCard
                    id="verification-step-id"
                    stepNumber={2}
                    title="ID details"
                    icon={IdCard}
                    why={STEP_WHY.id_doc}
                  >
                    {renderStepStatusNotice(true)}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="firstName">First name (as shown on ID)</Label>
                        <Input
                          id="firstName"
                          maxLength={100}
                          autoComplete="given-name"
                          value={firstName}
                          disabled={verificationSubmissionBlocked}
                          aria-invalid={showFirstNameError || undefined}
                          aria-describedby={showFirstNameError ? "firstName-error" : undefined}
                          onBlur={() => setNameFieldsTouched((prev) => ({ ...prev, first: true }))}
                          onChange={(e) => {
                            setFirstName(e.target.value);
                            setUploadReceipts((prev) => ({ ...prev, id_doc: undefined }));
                            clearStepCompletion("id_doc");
                          }}
                          className="h-12 sm:h-12"
                        />
                        {showFirstNameError && (
                          <p id="firstName-error" className="inline-form-error">
                            {firstNameError}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="lastName">Surname (as shown on ID)</Label>
                        <Input
                          id="lastName"
                          maxLength={100}
                          autoComplete="family-name"
                          value={lastName}
                          disabled={verificationSubmissionBlocked}
                          aria-invalid={showLastNameError || undefined}
                          aria-describedby={showLastNameError ? "lastName-error" : undefined}
                          onBlur={() => setNameFieldsTouched((prev) => ({ ...prev, last: true }))}
                          onChange={(e) => {
                            setLastName(e.target.value);
                            setUploadReceipts((prev) => ({ ...prev, id_doc: undefined }));
                            clearStepCompletion("id_doc");
                          }}
                          className="h-12 sm:h-12"
                        />
                        {showLastNameError && (
                          <p id="lastName-error" className="inline-form-error">
                            {lastNameError}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="idNumber">13-digit SA ID number</Label>
                      <Input
                        id="idNumber"
                        maxLength={13}
                        inputMode="numeric"
                        autoComplete="off"
                        value={idNumber}
                        disabled={verificationSubmissionBlocked}
                        aria-invalid={idChecksumValid === false || Boolean(idAgeError) || undefined}
                        aria-describedby={
                          idNumber.length === 13 && idChecksumValid !== null
                            ? "idNumber-feedback"
                            : undefined
                        }
                        onChange={(e) => {
                          setIdNumber(e.target.value.replace(/\D/g, ""));
                          setUploadReceipts((prev) => ({ ...prev, id_doc: undefined }));
                          clearStepCompletion("id_doc");
                        }}
                        className="h-12 font-medium tabular-nums tracking-wide sm:h-12"
                      />
                      {idNumber.length === 13 && idChecksumValid !== null && (
                        <div
                          id="idNumber-feedback"
                          className={cn(
                            "rounded-xl border px-3.5 py-3 text-sm",
                            idChecksumValid && !idAgeError
                              ? "border-brand-green-600/20 bg-brand-green-50 text-brand-green-900 dark:border-brand-green-400/20 dark:bg-brand-green-500/10 dark:text-brand-green-100"
                              : "border-brand-red-600/20 bg-brand-red-50 text-brand-red-800 dark:border-brand-red-400/25 dark:bg-brand-red-500/10 dark:text-brand-red-100"
                          )}
                        >
                          {idChecksumValid ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 font-semibold">
                                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                                ID number valid
                              </div>
                              {(idDob || idGender) && (
                                <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                                  {idDob && (
                                    <div className="flex gap-1">
                                      <dt>Date of birth:</dt>
                                      <dd className="font-medium">{idDob}</dd>
                                    </div>
                                  )}
                                  {idGender && (
                                    <div className="flex gap-1">
                                      <dt>Gender:</dt>
                                      <dd className="font-medium">{idGender}</dd>
                                    </div>
                                  )}
                                </dl>
                              )}
                              {idAgeError && (
                                <div className="flex items-center gap-1.5 pt-1 font-semibold text-brand-red-700 dark:text-brand-red-300">
                                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                                  {idAgeError}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 font-medium">
                              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                              Invalid ID number — please check and re-enter
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <FieldGroupHeading title="Photo of your ID" />
                      <CameraCapture
                        facingMode="environment"
                        telemetryContext="id_doc"
                        documentGuide
                        onReset={() => {
                          setIdFile(null);
                          setUploadReceipts((prev) => ({ ...prev, id_doc: undefined }));
                          clearStepCompletion("id_doc");
                        }}
                        disabled={verificationSubmissionBlocked}
                        onCapture={(file) => {
                          setIdFile(file);
                          setIdCaptureMethod("camera");
                          setUploadReceipts((prev) => ({ ...prev, id_doc: undefined }));
                          clearStepCompletion("id_doc");
                        }}
                        onFallback={() => setIdCaptureMethod("file_upload")}
                      />
                      {idFileError && idFile && (
                        <p className="inline-form-error" role="alert">
                          {idFileError}
                        </p>
                      )}
                    </div>

                    {idFile && <SelectedFileRow name={idFile.name} sizeBytes={idFile.size} />}

                    {idPreviewUrl && idCaptureMethod === "file_upload" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={idPreviewUrl}
                        alt="ID preview"
                        className="max-h-80 w-full rounded-2xl border border-border bg-muted object-contain"
                      />
                    )}

                    <StepActions>
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => setStep("phone")}
                        className="w-full sm:w-auto"
                      >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        Back
                      </Button>
                      <Button
                        onClick={goToSelfieStep}
                        disabled={!isIdReady || isUploadingId || verificationSubmissionBlocked}
                        variant="trust-verified"
                        size="lg"
                        className="w-full sm:w-auto sm:min-w-40"
                      >
                        {isUploadingId ? (
                          <>
                            <Loader2
                              className="h-4 w-4 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                            Uploading…
                          </>
                        ) : (
                          "Continue"
                        )}
                      </Button>
                    </StepActions>
                  </StepCard>
                )}

                {step === "selfie" && (
                  <StepCard
                    id="verification-step-selfie"
                    stepNumber={3}
                    title="Selfie check"
                    icon={ScanFace}
                    why={STEP_WHY.selfie}
                  >
                    {renderStepStatusNotice(true)}

                    <div className="space-y-3">
                      <FieldGroupHeading title="Live selfie" />
                      <CameraCapture
                        facingMode="user"
                        telemetryContext="selfie"
                        disabled={verificationSubmissionBlocked}
                        requireLiveness
                        onReset={() => {
                          setSelfieFile(null);
                          setSelfieLivenessPassed(false);
                          setUploadReceipts((prev) => ({ ...prev, selfie: undefined }));
                          clearStepCompletion("selfie");
                        }}
                        onCapture={(file, meta) => {
                          setSelfieFile(file);
                          setSelfieCaptureMethod("camera");
                          setSelfieLivenessPassed(meta?.livenessPassed ?? false);
                          setUploadReceipts((prev) => ({ ...prev, selfie: undefined }));
                          clearStepCompletion("selfie");
                        }}
                        onFallback={() => {
                          setSelfieCaptureMethod("file_upload");
                          setSelfieLivenessPassed(false);
                        }}
                      />
                      {selfieFileError && selfieFile && (
                        <p className="inline-form-error" role="alert">
                          {selfieFileError}
                        </p>
                      )}
                    </div>

                    {selfieFile && (
                      <SelectedFileRow name={selfieFile.name} sizeBytes={selfieFile.size} />
                    )}

                    {selfiePreviewUrl && selfieCaptureMethod === "file_upload" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selfiePreviewUrl}
                        alt="Selfie preview"
                        className="max-h-80 w-full rounded-2xl border border-border bg-muted object-contain"
                      />
                    )}

                    <StepActions>
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => setStep("id_doc")}
                        className="w-full sm:w-auto"
                      >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        Back
                      </Button>
                      <Button
                        onClick={goToLocationStep}
                        disabled={
                          !isSelfieReady || isUploadingSelfie || verificationSubmissionBlocked
                        }
                        variant="trust-verified"
                        size="lg"
                        className="w-full sm:w-auto sm:min-w-40"
                      >
                        {isUploadingSelfie ? (
                          <>
                            <Loader2
                              className="h-4 w-4 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                            Uploading…
                          </>
                        ) : (
                          "Continue"
                        )}
                      </Button>
                    </StepActions>
                  </StepCard>
                )}

                {step === "location" && (
                  <StepCard
                    id="verification-step-location"
                    stepNumber={4}
                    title="Confirm your province and city"
                    icon={MapPin}
                    why={STEP_WHY.location}
                  >
                    {renderStepStatusNotice(true)}

                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Confirm your province and city. Your location is approved immediately when
                        you submit. No street address or proof of residence is required. If your
                        city is not listed, select the nearest listed city in your province.
                      </p>
                      {!locationSubmissionLocked && (
                        <>
                          <Button
                            onClick={handleDetectLocation}
                            variant="outline"
                            disabled={
                              detectingLocation || manualSubmitting || verificationSubmissionBlocked
                            }
                          >
                            {detectingLocation ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Navigation className="h-4 w-4" aria-hidden="true" />
                            )}
                            {detectingLocation
                              ? "Detecting location..."
                              : "Detect province and city"}
                          </Button>
                          <p className="text-sm text-muted-foreground" role="status">
                            {locationDetectionMessage ||
                              "Detection is approximate. You can also select your location manually."}
                          </p>
                          <LocationSelector
                            value={{ province, city }}
                            onChange={(value) => {
                              setProvince(value.province);
                              setCity(value.city);
                            }}
                            cityLabel="City"
                            showTown={false}
                            showAddress={false}
                            disabled={
                              detectingLocation || manualSubmitting || verificationSubmissionBlocked
                            }
                          />
                        </>
                      )}
                      {locationSaved && locationSummary && (
                        <StatusCallout tone="success" title="Location approved">
                          {locationSummary}
                        </StatusCallout>
                      )}
                    </div>

                    <StepActions>
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => setStep("selfie")}
                        disabled={manualSubmitting}
                        className="w-full sm:w-auto"
                      >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        Back
                      </Button>
                      {!locationSubmissionLocked && (
                        <Button
                          onClick={handleManualLocationSubmit}
                          disabled={
                            !province ||
                            !city ||
                            detectingLocation ||
                            manualSubmitting ||
                            verificationSubmissionBlocked
                          }
                          variant="trust-verified"
                          size="lg"
                          className="w-full sm:w-auto"
                        >
                          {manualSubmitting ? (
                            <Loader2
                              className="h-4 w-4 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                          ) : (
                            <MapPin className="h-4 w-4" aria-hidden="true" />
                          )}
                          Save location & finish
                        </Button>
                      )}
                    </StepActions>
                  </StepCard>
                )}

                {step === "complete" && (
                  <section
                    aria-labelledby="verification-complete-title"
                    className="surface-card overflow-hidden"
                  >
                    <div
                      className={cn(
                        "bg-gradient-to-b to-transparent px-5 pb-6 pt-8 text-center sm:px-8",
                        accountVerified
                          ? "from-brand-green-50 dark:from-brand-green-500/10"
                          : "from-brand-gold-50 dark:from-brand-gold-400/10"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mx-auto flex h-14 w-14 items-center justify-center rounded-2xl",
                          accountVerified
                            ? "bg-brand-green-600 text-white dark:bg-brand-green-500 dark:text-brand-green-950"
                            : "bg-brand-gold-400 text-brand-gold-950"
                        )}
                      >
                        {accountVerified ? (
                          <ShieldCheck className="h-7 w-7" />
                        ) : (
                          <Clock3 className="h-7 w-7" />
                        )}
                      </span>
                      <h2
                        id="verification-complete-title"
                        className="mt-4 font-display text-2xl font-bold tracking-tight text-foreground"
                      >
                        {accountVerificationStatus === "verified"
                          ? "Verification approved"
                          : "Verification submitted"}
                      </h2>
                      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
                        {accountVerificationStatus === "verified"
                          ? "Your account is verified."
                          : "Your location is approved. Your identity documents are pending review."}
                      </p>
                      {verificationInAdminReview && (
                        <StatusCallout tone="pending" className="mx-auto mt-5 max-w-lg text-left">
                          <p>{inAdminReviewMessage}</p>
                        </StatusCallout>
                      )}
                    </div>

                    <ul className="divide-y divide-border/70 border-t border-border/70">
                      {REVIEWABLE_STEP_ORDER.map((stepType) => {
                        const statusEntry = serverStepMap.get(stepType);
                        const displayStatus: VerificationStatus = accountVerified
                          ? "approved"
                          : (stepType === "phone" && isPhoneReady) ||
                              (stepType === "location" && manualSubmitted)
                            ? "approved"
                            : (statusEntry?.status ?? "pending");
                        const detail = getStepStatusDetail(statusEntry);
                        return (
                          <li key={stepType} className="px-5 py-3.5 sm:px-8">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-semibold text-foreground">
                                {STEP_DISPLAY_LABELS[stepType]}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
                                  STATUS_CHIP_CLASSES[displayStatus]
                                )}
                              >
                                {formatStatusLabel(displayStatus)}
                              </span>
                            </div>
                            {detail && (
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {detail}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    <div className="border-t border-border/70 px-5 py-5 sm:px-8">
                      <Button
                        variant="trust-verified"
                        size="lg"
                        asChild
                        className="w-full sm:w-auto"
                      >
                        <Link href={completionHref}>{getCompletionCtaLabel(completionHref)}</Link>
                      </Button>
                    </div>
                  </section>
                )}
              </div>

              <aside aria-label="About verification" className="space-y-4 lg:sticky lg:top-32">
                {step === "location" ? (
                  <section
                    aria-labelledby="verification-review-title"
                    className="surface-card p-4 sm:p-5"
                  >
                    <h2
                      id="verification-review-title"
                      className="font-body text-base font-bold text-foreground"
                    >
                      Review before saving
                    </h2>
                    <ul className="mt-3 divide-y divide-border/70 text-sm">
                      <ReviewRow
                        label="Phone"
                        done={phoneVerified}
                        value={phoneVerified ? "Verified" : "Pending"}
                      />
                      <ReviewRow
                        label="ID document"
                        done={Boolean(uploadReceipts.id_doc)}
                        value={
                          uploadReceipts.id_doc
                            ? `${idDocumentStatus ? `${formatStatusLabel(idDocumentStatus)} - ` : ""}Uploaded at ${formatUploadedTime(uploadReceipts.id_doc.uploadedAtIso)}`
                            : "Not yet uploaded — go back to the ID step to add your document"
                        }
                        detail={
                          idChecksumValid && idDob
                            ? `Date of birth: ${idDob}${idGender ? `, ${idGender}` : ""}`
                            : null
                        }
                      />
                      <ReviewRow
                        label="Selfie"
                        done={Boolean(uploadReceipts.selfie)}
                        value={
                          uploadReceipts.selfie
                            ? `${selfieStatus ? `${formatStatusLabel(selfieStatus)} - ` : ""}Uploaded at ${formatUploadedTime(uploadReceipts.selfie.uploadedAtIso)}`
                            : "Not yet uploaded — go back to the selfie step to take your photo"
                        }
                      />
                      <ReviewRow
                        label="Location"
                        done={Boolean((locationSaved && locationSummary) || hasSelectedLocation)}
                        value={locationSummary || "Not set"}
                        detail={
                          locationSaved
                            ? "Location approved"
                            : hasSelectedLocation
                              ? "Selected - not saved yet"
                              : null
                        }
                        detailTone={
                          locationVerified || (locationSaved && locationSummary) ? "good" : "muted"
                        }
                      />
                    </ul>
                  </section>
                ) : (
                  step !== "complete" && <WhatHappensNextPanel />
                )}
                {step === "complete" && accountVerified && <WhatHappensNextPanel verified />}
                <PrivacyPanel />
                <HelpLinkCard />
              </aside>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function SelectedFileRow({ name, sizeBytes }: { name: string; sizeBytes: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm">
      <FileImage className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(sizeBytes)}</span>
    </div>
  );
}

function ReviewRow({
  label,
  done,
  value,
  detail,
  detailTone = "muted",
}: {
  label: string;
  done: boolean;
  value: string;
  detail?: string | null;
  detailTone?: "good" | "muted";
}) {
  return (
    <li className="flex items-start gap-3 py-3 first:pt-1 last:pb-0">
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          done
            ? "bg-brand-green-600 text-white dark:bg-brand-green-500 dark:text-brand-green-950"
            : "bg-muted text-muted-foreground"
        )}
      >
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{value}</p>
        {detail && (
          <p
            className={cn(
              "mt-0.5 text-xs leading-5",
              detailTone === "good"
                ? "font-medium text-brand-green-700 dark:text-brand-green-300"
                : "text-muted-foreground"
            )}
          >
            {detail}
          </p>
        )}
      </div>
    </li>
  );
}
