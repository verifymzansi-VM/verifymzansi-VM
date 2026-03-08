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
  Upload,
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
import { getCitiesForProvince, getProvinceNames } from "@/lib/constants/sa-provinces";
import {
  validateSaIdChecksum,
  extractDobFromSaId,
  extractGenderFromSaId,
} from "@/lib/utils/sa-id-validation";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import type { VerificationStepType, LocationConfidence } from "@/types/enums";
import { GPS_REQUEST_TIMEOUT_MS, GPS_MAX_AGE_MS } from "@/lib/constants/verification";

type WizardStep = "phone" | "id_doc" | "selfie" | "location" | "complete";
type UploadReceipt = { name: string; sizeBytes: number; uploadedAtIso: string };

const STEP_ORDER: Exclude<WizardStep, "complete">[] = ["phone", "id_doc", "selfie", "location"];

const SA_PHONE_REGEX = /^(\+27|0)[6-8][0-9]{8}$/;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_DOC_TYPES = [...ALLOWED_IMAGE_TYPES, "application/pdf"];

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

export default function VerificationPage() {
  const [step, setStep] = useState<WizardStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [testOtpHint, setTestOtpHint] = useState<string | null>(null);

  const [idNumber, setIdNumber] = useState("");
  const [idFile, setIdFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");

  // Session-driven state
  const [_sessionId, setSessionId] = useState<string | null>(null);
  const [_sessionLoading, setSessionLoading] = useState(true);
  const [useV2Flow, setUseV2Flow] = useState(false);

  // GPS state
  const [gpsStatus, setGpsStatus] = useState<
    "idle" | "requesting" | "success" | "denied" | "error"
  >("idle");
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lon: number; accuracy: number } | null>(
    null
  );
  const [gpsConfidence, setGpsConfidence] = useState<LocationConfidence | null>(null);
  const [gpsProvince, setGpsProvince] = useState<string | null>(null);
  const [locationMode, setLocationMode] = useState<"gps" | "proof" | null>(null);
  const [gpsFeatureAvailable, setGpsFeatureAvailable] = useState(true);

  // Proof of address state
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofUploaded, setProofUploaded] = useState(false);

  // SA ID validation feedback
  const [idDob, setIdDob] = useState<string | null>(null);
  const [idGender, setIdGender] = useState<string | null>(null);
  const [idChecksumValid, setIdChecksumValid] = useState<boolean | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<VerificationStepType[]>([]);
  const [uploadReceipts, setUploadReceipts] = useState<{
    id_doc?: UploadReceipt;
    selfie?: UploadReceipt;
  }>({});

  const { toast } = useToast();
  const searchParams = useSearchParams();
  const provinces = getProvinceNames();
  const cities = province ? getCitiesForProvince(province) : [];
  const completionHref = useMemo(
    () => sanitizeReturnUrl(searchParams.get("returnUrl")),
    [searchParams]
  );

  const idFileError = validateFile(idFile, true);
  const selfieFileError = validateFile(selfieFile);
  const isPhoneValid = SA_PHONE_REGEX.test(phone);
  const isOtpValid = otp.length === 6;
  const isIdReady = /^\d{13}$/.test(idNumber) && !idFileError && idChecksumValid !== false;
  const isSelfieReady = !selfieFileError;
  const isLocationReady = useV2Flow
    ? Boolean(province && city) &&
      (locationMode === "gps" || locationMode === "proof" || !gpsFeatureAvailable)
    : Boolean(province && city);

  // Try to start a v2 session on mount
  useEffect(() => {
    let cancelled = false;
    async function initSession() {
      try {
        const res = await fetch("/api/verification/session/start", {
          method: "POST",
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setSessionId(data.sessionId);
            setUseV2Flow(true);
            // Restore completed steps from server
            if (data.completedSteps?.length > 0) {
              setCompletedSteps(data.completedSteps);
            }
            // If all steps are submitted (approved or pending review), show completion screen
            const allSubmitted =
              data.completedSteps?.length + (data.pendingSteps?.length ?? 0) >=
              (data.requiredSteps?.length ?? 4);
            if (allSubmitted && data.finalizedAt) {
              setStep("complete");
            }
            if (data.phoneVerifiedAt) {
              setPhoneVerified(true);
            }
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
        }
        // 404 means v2 not enabled — use legacy flow silently
      } catch {
        // Session start failed — fall back to legacy
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    }
    initSession();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SA ID number validation effect
  useEffect(() => {
    if (idNumber.length === 13 && /^\d{13}$/.test(idNumber)) {
      const valid = validateSaIdChecksum(idNumber);
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
      } else {
        setIdDob(null);
        setIdGender(null);
      }
    } else {
      setIdChecksumValid(null);
      setIdDob(null);
      setIdGender(null);
    }
  }, [idNumber]);

  // GPS capture handler
  const handleRequestGps = useCallback(async () => {
    if (!navigator.geolocation) {
      setGpsStatus("error");
      toast({ title: "GPS not supported in this browser", variant: "destructive" });
      return;
    }

    setGpsStatus("requesting");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setGpsCoords({ lat: latitude, lon: longitude, accuracy });
        setGpsStatus("success");

        // Submit GPS to server
        if (province && city) {
          try {
            const res = await fetch("/api/verification/location/gps", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                latitude,
                longitude,
                accuracy,
                timestamp: position.timestamp,
                province,
                city,
              }),
            });
            if (res.ok) {
              const data = await res.json();
              setGpsConfidence(data.confidence);
              setGpsProvince(data.gpsProvince);
              setLocationMode("gps");
              markStepComplete("location");
              toast({ title: "GPS location captured", variant: "success" });
            } else if (res.status === 404) {
              // GPS feature not enabled — fall back to legacy location
              setGpsFeatureAvailable(false);
              setGpsStatus("idle");
            } else {
              const data = await res.json().catch(() => ({}));
              if (res.status === 422) {
                // Accuracy too poor
                setGpsStatus("error");
                toast({
                  title: "GPS accuracy too low",
                  description: "Please upload proof of address instead.",
                  variant: "destructive",
                });
              } else {
                throw new Error(data.error || "Failed to verify GPS");
              }
            }
          } catch (err) {
            toast({
              title: "GPS verification failed",
              description: err instanceof Error ? err.message : "Please try proof of address.",
              variant: "destructive",
            });
          }
        }
      },
      (err) => {
        setGpsStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
        toast({
          title: err.code === err.PERMISSION_DENIED ? "GPS permission denied" : "GPS error",
          description: "You can upload proof of address instead.",
          variant: "destructive",
        });
      },
      {
        enableHighAccuracy: true,
        timeout: GPS_REQUEST_TIMEOUT_MS,
        maximumAge: GPS_MAX_AGE_MS,
      }
    );
  }, [province, city, toast]);

  // Proof of address upload handler
  const handleProofUpload = useCallback(async () => {
    if (!proofFile || !province || !city) return;

    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", proofFile);
      formData.append("province", province);
      formData.append("city", city);

      const res = await fetch("/api/verification/location/proof", {
        method: "POST",
        body: formData,
      });
      if (res.status === 404) {
        // Proof feature not enabled — fall back to legacy location
        setGpsFeatureAvailable(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to upload proof");
      setProofUploaded(true);
      setLocationMode("proof");
      markStepComplete("location");
      toast({ title: "Proof of address uploaded", variant: "success" });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [proofFile, province, city, toast]);

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

  function markStepComplete(stepType: VerificationStepType) {
    setCompletedSteps((prev) => (prev.includes(stepType) ? prev : [...prev, stepType]));
  }

  function clearStepCompletion(stepType: VerificationStepType) {
    setCompletedSteps((prev) => prev.filter((entry) => entry !== stepType));
  }

  async function handleSendOtp() {
    if (!isPhoneValid) {
      toast({ title: "Enter a valid SA mobile number", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    setDevOtpHint(null);
    setTestOtpHint(null);

    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload.detail ? ` (${payload.detail})` : "";
        throw new Error((payload.error || "Failed to send OTP") + detail);
      }

      const devOtp = typeof payload.devOtp === "string" ? payload.devOtp : null;
      if (devOtp && process.env.NODE_ENV === "development") {
        setOtp(devOtp);
        setDevOtpHint(devOtp);
      }

      // Test phone number bypass — works on live site for whitelisted numbers
      const testOtp = typeof payload.testOtp === "string" ? payload.testOtp : null;
      if (testOtp) {
        setOtp(testOtp);
        setTestOtpHint(testOtp);
      }

      setOtpSent(true);
      toast({ title: "OTP sent", variant: "success" });
    } catch (err) {
      toast({
        title: "Failed to send OTP",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (!isOtpValid) {
      toast({ title: "Enter the 6-digit OTP", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Invalid OTP");

      setPhoneVerified(true);
      markStepComplete("phone");
      setStep("id_doc");
      toast({ title: "Phone verified", variant: "success" });
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

  function goToSelfieStep() {
    if (!/^\d{13}$/.test(idNumber)) {
      toast({ title: "Enter a valid 13-digit SA ID number", variant: "destructive" });
      return;
    }
    if (idFileError) {
      toast({ title: idFileError, variant: "destructive" });
      return;
    }
    setStep("selfie");
  }

  function goToLocationStep() {
    if (selfieFileError) {
      toast({ title: selfieFileError, variant: "destructive" });
      return;
    }
    setStep("location");
  }

  /** Upload helper with 1 automatic retry after a 2-second delay. */
  async function uploadWithRetry(
    buildFormData: () => FormData,
    label: string
  ): Promise<Record<string, unknown>> {
    const attempt = async () => {
      const res = await fetch("/api/verification/upload", {
        method: "POST",
        body: buildFormData(),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `Failed to upload ${label}`);
      return payload;
    };

    try {
      return await attempt();
    } catch {
      // One automatic retry after 2 s for transient failures
      await new Promise((r) => setTimeout(r, 2000));
      return await attempt();
    }
  }

  async function uploadIdIfNeeded() {
    if (uploadReceipts.id_doc) return;
    if (!idFile) throw new Error("Please add your ID document.");

    await uploadWithRetry(() => {
      const fd = new FormData();
      fd.append("file", idFile);
      fd.append("docType", "id_document");
      fd.append("idNumber", idNumber);
      fd.append("idDocumentType", "sa_id");
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
    if (uploadReceipts.selfie) return;
    if (!selfieFile) throw new Error("Please add your selfie.");

    await uploadWithRetry(() => {
      const fd = new FormData();
      fd.append("file", selfieFile);
      fd.append("docType", "selfie");
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
    // If v2 flow with GPS or proof, location was already submitted via those handlers
    if (useV2Flow && (locationMode === "gps" || locationMode === "proof")) {
      if (!completedSteps.includes("location")) {
        markStepComplete("location");
      }
      return;
    }
    // Legacy flow (or v2 with GPS feature unavailable): submit province/city directly
    const res = await fetch("/api/verification/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ province, city }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || "Failed to save location");
    markStepComplete("location");
  }

  async function handleFinalize() {
    if (!phoneVerified) {
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
      toast({ title: "Select province and city", variant: "destructive" });
      return;
    }

    setIsFinalizing(true);
    try {
      await uploadIdIfNeeded();
      await uploadSelfieIfNeeded();
      await submitLocation();

      toast({
        title: "Verification submitted",
        description: "All checks were sent for review.",
        variant: "success",
      });
      setStep("complete");
    } catch (err) {
      toast({
        title: "Submission failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsFinalizing(false);
    }
  }

  const progressSteps = useMemo(() => {
    const approved = completedSteps.map((type) => ({ type, status: "approved" as const }));
    if (step === "complete") return approved;
    const current = step as VerificationStepType;
    if (approved.some((entry) => entry.type === current)) return approved;
    return [...approved, { type: current, status: "pending" as const }];
  }, [completedSteps, step]);

  const currentStepNumber = step === "complete" ? 4 : STEP_ORDER.indexOf(step) + 1;

  return (
    <div className="flex min-h-screen flex-col bg-warm-50/30 dark:bg-background">
      <Header isAuthenticated />
      <main className="flex-1">
        <div className="container-page py-6">
          <div className="mx-auto w-full max-w-4xl space-y-6">
            <PageHeader
              title="Get Verified"
              description="Complete all checks, then submit once for final review."
              breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Verification" }]}
            />

            <Card className="border-warm-200/70 dark:border-warm-700/70 bg-background/95">
              <CardContent className="space-y-3 p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Wizard 2.0 progress</p>
                  {step !== "complete" && (
                    <Badge variant="secondary">Step {currentStepNumber} of 4</Badge>
                  )}
                </div>
                <VerificationProgress steps={progressSteps} />
                <p className="text-xs text-muted-foreground">
                  {completedSteps.length} of 4 steps completed
                </p>
              </CardContent>
            </Card>

            {step === "phone" && (
              <Card className="border-warm-200/70 dark:border-warm-700/70 bg-background/95">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base font-display">
                    <Phone className="h-5 w-5 text-brand-green" />
                    Step 1: Phone + OTP
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">SA mobile number</Label>
                    <Input
                      id="phone"
                      placeholder="071 234 5678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={phoneVerified}
                    />
                  </div>

                  {!phoneVerified && (
                    <Button
                      onClick={handleSendOtp}
                      disabled={isLoading || !isPhoneValid}
                      variant="trust-verified"
                      className="gap-2"
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                      Send OTP
                    </Button>
                  )}

                  {otpSent && !phoneVerified && (
                    <div className="space-y-3 rounded-md border border-warm-200/70 dark:border-warm-700/70 p-3">
                      {process.env.NODE_ENV === "development" && devOtpHint && (
                        <p className="text-xs text-muted-foreground">
                          Dev OTP: <span className="font-mono font-semibold">{devOtpHint}</span>
                        </p>
                      )}
                      {testOtpHint && (
                        <p className="text-xs rounded bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 px-2 py-1 text-amber-800 dark:text-amber-200">
                          Test OTP: <span className="font-mono font-semibold">{testOtpHint}</span>
                        </p>
                      )}
                      <div className="space-y-2">
                        <Label htmlFor="otp">6-digit OTP</Label>
                        <Input
                          id="otp"
                          maxLength={6}
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                        />
                      </div>
                      <Button
                        onClick={handleVerifyOtp}
                        disabled={isLoading || !isOtpValid}
                        variant="trust-verified"
                      >
                        Verify OTP
                      </Button>
                    </div>
                  )}

                  {phoneVerified && (
                    <div className="rounded-md border border-brand-green/30 bg-brand-green-50 p-3 text-sm text-brand-green-900">
                      Phone verified: {phone}
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
                  <div className="space-y-2">
                    <Label htmlFor="idNumber">13-digit SA ID number</Label>
                    <Input
                      id="idNumber"
                      maxLength={13}
                      value={idNumber}
                      onChange={(e) => {
                        setIdNumber(e.target.value.replace(/\D/g, ""));
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
                    <Label htmlFor="idFile">ID file (image/PDF)</Label>
                    <Input
                      id="idFile"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,.pdf,application/pdf"
                      onChange={(e) => {
                        setIdFile(e.target.files?.[0] ?? null);
                        setUploadReceipts((prev) => ({ ...prev, id_doc: undefined }));
                        clearStepCompletion("id_doc");
                      }}
                    />
                    {idFileError && idFile && <p className="inline-form-error">{idFileError}</p>}
                  </div>

                  {idFile && (
                    <div className="rounded-md border border-warm-200/70 dark:border-warm-700/70 p-3 text-xs text-muted-foreground">
                      {idFile.name} ({formatFileSize(idFile.size)})
                    </div>
                  )}

                  {idPreviewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={idPreviewUrl}
                      alt="ID preview"
                      className="max-h-80 w-full rounded-md border object-contain"
                    />
                  )}

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep("phone")} className="gap-1">
                      <ArrowLeft className="h-4 w-4" />
                      Back
                    </Button>
                    <Button
                      onClick={goToSelfieStep}
                      disabled={!isIdReady}
                      variant="trust-verified"
                      className="gap-1"
                    >
                      Continue
                      <ArrowRight className="h-4 w-4" />
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
                  <div className="space-y-2">
                    <Label htmlFor="selfieFile">Selfie image</Label>
                    <Input
                      id="selfieFile"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="user"
                      onChange={(e) => {
                        setSelfieFile(e.target.files?.[0] ?? null);
                        setUploadReceipts((prev) => ({ ...prev, selfie: undefined }));
                        clearStepCompletion("selfie");
                      }}
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

                  {selfiePreviewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selfiePreviewUrl}
                      alt="Selfie preview"
                      className="max-h-80 w-full rounded-md border object-contain"
                    />
                  )}

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep("id_doc")} className="gap-1">
                      <ArrowLeft className="h-4 w-4" />
                      Back
                    </Button>
                    <Button
                      onClick={goToLocationStep}
                      disabled={!isSelfieReady}
                      variant="trust-verified"
                      className="gap-1"
                    >
                      Continue
                      <ArrowRight className="h-4 w-4" />
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
                      Step 4: Location + Final Submit
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Province & City selectors */}
                    <div className="space-y-2">
                      <Label htmlFor="province">Province</Label>
                      <select
                        id="province"
                        title="Select province"
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={province}
                        onChange={(e) => {
                          setProvince(e.target.value);
                          setCity("");
                          setLocationMode(null);
                          setGpsStatus("idle");
                          setGpsCoords(null);
                          setGpsConfidence(null);
                          setProofUploaded(false);
                          clearStepCompletion("location");
                        }}
                      >
                        <option value="">Select province</option>
                        {provinces.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </div>

                    {province && (
                      <div className="space-y-2">
                        <Label htmlFor="city">City</Label>
                        <select
                          id="city"
                          title="Select city"
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={city}
                          onChange={(e) => {
                            setCity(e.target.value);
                            setLocationMode(null);
                            setGpsStatus("idle");
                            setProofUploaded(false);
                            clearStepCompletion("location");
                          }}
                        >
                          <option value="">Select city</option>
                          {cities.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* GPS location capture (v2 flow) */}
                    {useV2Flow && gpsFeatureAvailable && province && city && (
                      <div className="space-y-3 rounded-md border border-warm-200/70 dark:border-warm-700/70 p-4">
                        <h4 className="flex items-center gap-2 text-sm font-medium">
                          <Navigation className="h-4 w-4 text-brand-blue" />
                          GPS Location Verification
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          Allow GPS to verify your province. Fastest method.
                        </p>

                        {gpsStatus === "idle" && (
                          <Button
                            onClick={handleRequestGps}
                            variant="outline"
                            className="gap-2"
                            size="sm"
                          >
                            <Navigation className="h-4 w-4" />
                            Capture GPS Location
                          </Button>
                        )}

                        {gpsStatus === "requesting" && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Requesting GPS access…
                          </div>
                        )}

                        {gpsStatus === "success" && gpsCoords && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm text-brand-green">
                              <CheckCircle2 className="h-4 w-4" />
                              GPS captured (accuracy: {Math.round(gpsCoords.accuracy)}m)
                            </div>
                            {gpsConfidence && (
                              <div
                                className={`rounded-md border px-3 py-2 text-xs ${
                                  gpsConfidence === "high"
                                    ? "border-brand-green/30 bg-brand-green-50 text-brand-green-900"
                                    : gpsConfidence === "medium"
                                      ? "border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950 text-yellow-900 dark:text-yellow-100"
                                      : "border-destructive/30 bg-destructive/5 text-destructive"
                                }`}
                              >
                                Location confidence:{" "}
                                <span className="font-medium capitalize">{gpsConfidence}</span>
                                {gpsProvince && gpsProvince !== province && (
                                  <span className="ml-1">(GPS detected: {gpsProvince})</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {(gpsStatus === "denied" || gpsStatus === "error") && (
                          <div className="flex items-center gap-2 text-sm text-destructive">
                            <AlertTriangle className="h-4 w-4" />
                            {gpsStatus === "denied"
                              ? "GPS permission was denied."
                              : "Could not get GPS position."}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Proof of address fallback (v2 flow) */}
                    {useV2Flow &&
                      gpsFeatureAvailable &&
                      province &&
                      city &&
                      (gpsStatus === "denied" ||
                        gpsStatus === "error" ||
                        locationMode === "proof") && (
                        <div className="space-y-3 rounded-md border border-warm-200/70 dark:border-warm-700/70 p-4">
                          <h4 className="flex items-center gap-2 text-sm font-medium">
                            <Upload className="h-4 w-4 text-brand-gold" />
                            Proof of Address (Alternative)
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            Upload a utility bill, bank statement, or government letter with your
                            address.
                          </p>
                          <Input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,.pdf,application/pdf"
                            onChange={(e) => {
                              setProofFile(e.target.files?.[0] ?? null);
                              setProofUploaded(false);
                              setLocationMode(null);
                              clearStepCompletion("location");
                            }}
                          />
                          {proofFile && !proofUploaded && (
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground">
                                {proofFile.name} ({formatFileSize(proofFile.size)})
                              </p>
                              <Button
                                onClick={handleProofUpload}
                                variant="outline"
                                size="sm"
                                disabled={isLoading}
                                className="gap-2"
                              >
                                {isLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Upload className="h-4 w-4" />
                                )}
                                Upload Proof
                              </Button>
                            </div>
                          )}
                          {proofUploaded && (
                            <div className="flex items-center gap-2 text-sm text-brand-green">
                              <CheckCircle2 className="h-4 w-4" />
                              Proof of address uploaded — pending admin review
                            </div>
                          )}
                        </div>
                      )}

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setStep("selfie")}
                        disabled={isFinalizing}
                        className="gap-1"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        Back
                      </Button>
                      <Button
                        onClick={handleFinalize}
                        disabled={!isLocationReady || isFinalizing}
                        variant="trust-verified"
                        className="gap-2"
                      >
                        {isFinalizing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-4 w-4" />
                        )}
                        Final Submit
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
                          Uploaded at {formatUploadedTime(uploadReceipts.id_doc.uploadedAtIso)}
                        </p>
                      ) : (
                        <p className="mt-1 text-muted-foreground">Uploads on final submit</p>
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
                          Uploaded at {formatUploadedTime(uploadReceipts.selfie.uploadedAtIso)}
                        </p>
                      ) : (
                        <p className="mt-1 text-muted-foreground">Uploads on final submit</p>
                      )}
                    </div>

                    <div className="rounded-md border border-warm-200/70 dark:border-warm-700/70 p-3">
                      <p className="font-medium">Location</p>
                      {locationMode === "gps" ? (
                        <div className="mt-1 flex items-center gap-1 text-brand-green">
                          <Navigation className="h-4 w-4" />
                          <span>GPS verified{gpsConfidence ? ` (${gpsConfidence})` : ""}</span>
                        </div>
                      ) : locationMode === "proof" ? (
                        <div className="mt-1 flex items-center gap-1 text-brand-gold">
                          <Upload className="h-4 w-4" />
                          <span>Proof uploaded — pending review</span>
                        </div>
                      ) : province && city ? (
                        <p className="mt-1 text-muted-foreground">
                          {city}, {province}
                        </p>
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
              <Card className="border-brand-green/40 bg-brand-green-50/30 dark:bg-brand-green-950/30">
                <CardContent className="space-y-3 py-6 text-center">
                  <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-green-100 text-brand-green dark:bg-brand-green-900">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <h2 className="font-display text-xl font-bold">Verification Submitted</h2>
                  <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                    Your details are under review.
                  </p>
                  <Button variant="trust-verified" asChild className="gap-2">
                    <Link href={completionHref}>
                      {completionHref === "/dashboard" ? "Go to Dashboard" : "Return to Posting"}
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
