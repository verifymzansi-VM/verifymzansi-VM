"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Camera, FileText, MapPin, TreePalm } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MediaUpload } from "@/components/ui/media-upload";
import { UploadProgressPanel, type UploadSlotStatus } from "@/components/ui/upload-progress-panel";
import {
  PlanGate,
  usePlanMaxPhotos,
  usePlanMaxVideos,
  usePlanVideoAllowed,
} from "@/components/billing/plan-gate";
import { LocationSelector, type LocationValue } from "@/components/ui/location-selector";
import { type BusinessCategory, type PromotionType } from "@/types/enums";
import { cn } from "@/lib/utils";
import {
  PostFormFooter,
  PostFormScaffold,
  type PostFormStep,
} from "@/components/post/post-form-scaffold";
import {
  normalizeCreatePostError,
  normalizeCreatePostRuntimeError,
} from "@/app/post/_lib/create-post-errors";
import {
  getPromotionMediaUploadErrorState,
  uploadPromotionVideoFiles,
  uploadRequiredPromotionMedia,
} from "@/app/post/_lib/promotion-media-upload";
import { prewarmVideosForFastUpload } from "@/app/post/_lib/video-fast-upload";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePostDraftAutosave } from "@/hooks/use-post-draft-autosave";
import { validatePromotionForm } from "@/lib/forms/promotion-form";
import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import { getDefaultEventDates } from "@/lib/post-drafts/defaults";
import { PromotionDetailContent } from "@/components/listings/promotion-detail-content";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { checkUploadServiceReachable } from "@/lib/utils/upload-preflight";
import { readMediaDimensions } from "@/lib/utils/media-metadata";
import type { PromotionDraftData } from "@/lib/post-drafts/storage";
const SELECT_CLASS =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm";

const STEPS: PostFormStep[] = [
  { label: "Details", icon: FileText, description: "Type, title, and campaign summary" },
  { label: "Pricing & Reach", icon: MapPin, description: "Price, location, dates, and contact" },
  { label: "Media & Review", icon: Camera, description: "Photos, video, and final review" },
];

const FIELD_IDS: Record<string, string> = {
  title: "title",
  description: "description",
  price_zar: "price",
  province: "province",
  city: "city",
  location_town: "town",
  location_address: "address",
  contact_methods: "promotion-contact-methods",
  start_date: "start_date",
  end_date: "end_date",
  images: "promotion-images",
  videos: "promotion-videos",
  video_thumbnail: "promotion-video-thumbnail",
};

/** Human-readable labels for each form field key, used in the error alert. */
const PROMOTION_FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  price_zar: "Price",
  province: "Province",
  city: "City",
  location_town: "Town / suburb",
  location_address: "Address",
  contact_methods: "Contact methods",
  start_date: "Start date",
  end_date: "End date",
  images: "Photos",
  videos: "Videos",
};

function getStepForFieldKey(key: string): number {
  if (key === "images" || key === "videos") {
    return 2;
  }

  if (
    key === "price_zar" ||
    key === "province" ||
    key === "city" ||
    key === "location_town" ||
    key === "location_address" ||
    key === "contact_methods" ||
    key === "start_date" ||
    key === "end_date"
  ) {
    return 1;
  }

  return 0;
}

function getStepForServerErrors(errors: Record<string, string>): number {
  const keys = Object.keys(errors);
  if (keys.length === 0) {
    return 0;
  }

  return keys.reduce((targetStep, key) => Math.min(targetStep, getStepForFieldKey(key)), 2);
}

export default function CreatePromotionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Camera className="h-8 w-8 animate-pulse text-muted-foreground" />
        </div>
      }
    >
      <CreatePromotionContent />
    </Suspense>
  );
}

function CreatePromotionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user, profile, isLoading } = useAuth();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const [uploadStatuses, setUploadStatuses] = useState<Record<string, UploadSlotStatus>>({
    photos: "idle",
    videos: "idle",
    saving: "idle",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitSucceeded, setSubmitSucceeded] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [promotionType, setPromotionType] = useState<PromotionType>("event");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [categoryKey, setCategoryKey] = useState<BusinessCategory | "">("");
  const [priceZar, setPriceZar] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [locationTown, setLocationTown] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [contactMethods, setContactMethods] = useState<string[]>(["call"]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [videoThumbnailFile, setVideoThumbnailFile] = useState<File[]>([]);
  const [focalPoint, setFocalPoint] = useState({ x: 0.5, y: 0.5 });
  const rawBusinessId = searchParams.get("business_id") || "";
  const [businessId, setBusinessId] = useState(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawBusinessId)
      ? rawBusinessId
      : ""
  );
  const [myBusinesses, setMyBusinesses] = useState<{ id: string; business_name: string }[]>([]);
  const {
    save: saveDraft,
    restore: restoreDraft,
    discard: discardDraft,
  } = usePostDraftAutosave<PromotionDraftData>("promotion", user?.id, !isLoading);
  const locationValue: LocationValue = {
    province,
    city,
    town: locationTown,
    address: locationAddress,
  };
  const maxPhotos = usePlanMaxPhotos("PROMOTIONS_EVENTS");
  const maxVideos = usePlanMaxVideos("PROMOTIONS_EVENTS");
  const videoAllowed = usePlanVideoAllowed("PROMOTIONS_EVENTS");

  useEffect(() => {
    void ensureCsrfTokenReady();
  }, []);

  // Stable blob URLs for photo previews — revoked on change
  const photoPreviewUrls = useMemo(
    () => photoFiles.map((file) => URL.createObjectURL(file)),
    [photoFiles]
  );
  const previewVideoUrls = useMemo(
    () => videoFiles.map((file) => URL.createObjectURL(file)),
    [videoFiles]
  );
  const videoThumbnailUrl = useMemo(
    () => (videoThumbnailFile.length > 0 ? URL.createObjectURL(videoThumbnailFile[0]) : null),
    [videoThumbnailFile]
  );
  useEffect(
    () => () => {
      photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [photoPreviewUrls]
  );
  useEffect(
    () => () => {
      previewVideoUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [previewVideoUrls]
  );
  useEffect(
    () => () => {
      if (videoThumbnailUrl) URL.revokeObjectURL(videoThumbnailUrl);
    },
    [videoThumbnailUrl]
  );

  useEffect(() => {
    async function loadBusinesses() {
      try {
        const res = await fetch("/api/businesses?mine=true&limit=50");
        if (!res.ok) return;
        const data = await res.json();
        setMyBusinesses(data.businesses ?? []);
      } catch {
        // Non-critical.
      }
    }
    queueMicrotask(() => {
      void loadBusinesses();
    });
  }, []);

  useEffect(() => {
    if (!profile) return;

    queueMicrotask(() => {
      if (!province && profile.location_province) {
        setProvince(profile.location_province);
      }

      if (!city && profile.location_city && (!province || province === profile.location_province)) {
        setCity(profile.location_city);
      }
    });
  }, [profile, province, city]);

  useEffect(() => {
    if (!user?.id || isLoading || submitSucceeded) return;

    const restored = restoreDraft();
    if (!restored) return;

    const restoredData = restored.data;
    queueMicrotask(() => {
      setStep(Math.min(Math.max(restored.step ?? 0, 0), STEPS.length - 1));
      setPromotionType("event");
      setTitle(restoredData.title ?? "");
      setDescription(restoredData.description ?? "");
      setCategory(restoredData.category ?? "");
      setCategoryKey((restoredData.categoryKey as BusinessCategory | "") ?? "");
      setPriceZar(restoredData.priceZar ?? "");
      setNegotiable(Boolean(restoredData.negotiable));
      setProvince(restoredData.province ?? "");
      setCity(restoredData.city ?? "");
      setLocationTown(restoredData.locationTown ?? "");
      setLocationAddress(restoredData.locationAddress ?? "");
      setContactMethods(
        Array.isArray(restoredData.contactMethods) && restoredData.contactMethods.length > 0
          ? restoredData.contactMethods
          : ["call"]
      );
      setStartDate(restoredData.startDate ?? "");
      setEndDate(restoredData.endDate ?? "");
      setBusinessId(restoredData.businessId ?? (searchParams.get("business_id") || ""));
      setLastSavedAt(restored.savedAt ?? null);
      toast({
        title: "Draft restored",
        description: "You can continue from where you left off.",
        variant: "success",
      });
    });
  }, [user?.id, isLoading, submitSucceeded, restoreDraft, searchParams, toast]);

  useEffect(() => {
    const defaults = getDefaultEventDates(startDate, endDate);
    queueMicrotask(() => {
      if (!startDate) {
        setStartDate(defaults.startDate);
      }

      if (!endDate) {
        setEndDate(defaults.endDate);
      }
    });
  }, [startDate, endDate]);

  useEffect(() => {
    if (!user?.id || isLoading || isSubmitting || submitSucceeded) return;

    saveDraft(step, {
      promotionType,
      title,
      description,
      category,
      categoryKey,
      priceZar,
      negotiable,
      province,
      city,
      locationTown,
      locationAddress,
      contactMethods,
      startDate,
      endDate,
      businessId,
    });
    queueMicrotask(() => {
      setLastSavedAt(Date.now());
    });
  }, [
    user?.id,
    isLoading,
    isSubmitting,
    submitSucceeded,
    saveDraft,
    step,
    promotionType,
    title,
    description,
    category,
    categoryKey,
    priceZar,
    negotiable,
    province,
    city,
    locationTown,
    locationAddress,
    contactMethods,
    startDate,
    endDate,
    businessId,
  ]);

  function clearErrors(...keys: string[]) {
    setFormError(null);
    if (keys.length === 0) {
      setFieldErrors({});
      return;
    }
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  function focusFirstError(errors: Record<string, string>, targetStep = step) {
    const orderByStep = [
      ["title", "description"],
      ["province", "city", "contact_methods"],
      ["images", "videos"],
    ][targetStep];
    const firstKey = orderByStep?.find((key) => errors[key]) ?? Object.keys(errors)[0];
    if (!firstKey) return;
    const targetId = FIELD_IDS[firstKey];
    if (!targetId) return;
    requestAnimationFrame(() => {
      const element = document.getElementById(targetId);
      element?.focus();
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function toggleContact(method: string) {
    setContactMethods((current) =>
      current.includes(method) ? current.filter((item) => item !== method) : [...current, method]
    );
    clearErrors("contact_methods");
  }

  function validateStep(targetStep: number) {
    const errors: Record<string, string> = {};
    const promotionValidationErrors = validatePromotionForm({
      priceZar,
      startDate,
      endDate,
      contactMethods,
    });
    if (targetStep === 0) {
      if (!title.trim()) errors.title = "Enter an event title.";
      else if (title.trim().length < 5) errors.title = "Title must be at least 5 characters.";
      else if (title.trim().length > 120) errors.title = "Title must be 120 characters or fewer.";
      if (!description.trim()) {
        errors.description = "Enter event details.";
      } else if (description.trim().length < 20) {
        errors.description = "Description must be at least 20 characters.";
      } else if (description.trim().length > 5000) {
        errors.description = "Description must be 5000 characters or fewer.";
      }
    }
    if (targetStep === 1) {
      if (!province) errors.province = "Select a province.";
      if (!city) errors.city = "Select a city.";
      if (province.trim().length > 50) {
        errors.province = "Province must be 50 characters or fewer.";
      }
      if (city.trim().length > 80) {
        errors.city = "City must be 80 characters or fewer.";
      }
      if (locationTown.trim().length > 120) {
        errors.location_town = "Town / suburb must be 120 characters or fewer.";
      }
      if (locationAddress.trim().length > 300) {
        errors.location_address = "Address must be 300 characters or fewer.";
      }
      Object.assign(errors, promotionValidationErrors);
    }
    if (targetStep === 2) {
      if (photoFiles.length === 0 && videoFiles.length === 0) {
        errors.images = "Upload at least one photo or video.";
      }
      if (photoFiles.length > maxPhotos) {
        errors.images = `You can upload up to ${maxPhotos} photos on this plan.`;
      }
      if (!videoAllowed && videoFiles.length > 0) {
        errors.videos = "Video upload is not available on your current plan.";
      } else if (videoFiles.length > maxVideos) {
        errors.videos = `You can upload up to ${maxVideos} videos on this plan.`;
      }
    }
    return errors;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const stepErrors = [0, 1, 2].map((index) => validateStep(index));
    const firstInvalidStep = stepErrors.findIndex((errors) => Object.keys(errors).length > 0);
    if (firstInvalidStep !== -1) {
      setStep(firstInvalidStep);
      setFieldErrors(stepErrors[firstInvalidStep]);
      const count = Object.keys(stepErrors[firstInvalidStep]).length;
      setFormError(
        `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${firstInvalidStep + 1} \u2014 ${STEPS[firstInvalidStep].label}.`
      );
      focusFirstError(stepErrors[firstInvalidStep], firstInvalidStep);
      return;
    }

    clearErrors();
    setIsSubmitting(true);
    setSubmitProgress("Checking upload service...");
    setUploadStatuses({
      photos: photoFiles.length > 0 ? "uploading" : "skipped",
      videos: videoFiles.length > 0 ? "uploading" : "skipped",
      saving: "idle",
    });

    try {
      const csrfToken = await ensureCsrfTokenReady();
      if (!csrfToken) {
        setFormError("Security check failed. Please refresh the page and try again.");
        return;
      }

      // Best-effort preflight only; do not make submit wait through slow-network
      // retries before the real upload starts.
      void checkUploadServiceReachable().catch(() => undefined);
      setSubmitProgress("Uploading media...");

      const primaryMediaFile = videoFiles[0] ?? photoFiles[0] ?? null;
      const mediaDimensionsPromise = primaryMediaFile
        ? readMediaDimensions(primaryMediaFile)
        : Promise.resolve(null);

      const [imageUrls, videoUrls, uploadedVideoThumbnailUrl] = await Promise.all([
        uploadRequiredPromotionMedia({
          files: photoFiles,
          area: "promotion",
          field: "images",
        }).then((urls) => {
          if (photoFiles.length > 0) {
            setUploadStatuses((current) => ({ ...current, photos: "done" }));
          }
          return urls;
        }),
        uploadPromotionVideoFiles({
          files: videoFiles,
          area: "promotion",
        }).then((urls) => {
          if (videoFiles.length > 0) {
            setUploadStatuses((current) => ({ ...current, videos: "done" }));
          }
          return urls;
        }),
        uploadRequiredPromotionMedia({
          files: videoThumbnailFile,
          area: "promotion",
          field: "video_thumbnail",
        }).then((urls) => urls[0]),
      ]);

      setSubmitProgress("Saving promotion...");
      setUploadStatuses((c) => ({ ...c, saving: "uploading" }));
      const mediaDimensions = await mediaDimensionsPromise;

      const body = {
        title: title.trim(),
        description: description.trim(),
        promotion_type: promotionType,
        category: category || undefined,
        category_key: categoryKey || undefined,
        price_zar: priceZar ? parseFloat(priceZar) : undefined,
        negotiable,
        province,
        city,
        location_town: locationTown || undefined,
        location_address: locationAddress || undefined,
        contact_methods: contactMethods,
        images: imageUrls,
        videos: videoUrls,
        video_thumbnail: uploadedVideoThumbnailUrl,
        media_width: mediaDimensions?.width,
        media_height: mediaDimensions?.height,
        focal_x: focalPoint.x,
        focal_y: focalPoint.y,
        start_date: startDate ? new Date(startDate).toISOString() : undefined,
        end_date: endDate ? new Date(endDate).toISOString() : undefined,
        business_id: businessId || undefined,
      };

      const res = await fetch("/api/promotions", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        // Phone-gate: server returns redirectUrl for phone verification
        if (
          res.status === 403 &&
          payload &&
          typeof payload === "object" &&
          typeof (payload as Record<string, unknown>).redirectUrl === "string"
        ) {
          router.push((payload as Record<string, unknown>).redirectUrl as string);
          return;
        }

        // Plan-limit: show a descriptive upgrade message
        if (
          res.status === 403 &&
          payload &&
          typeof payload === "object" &&
          typeof (payload as Record<string, unknown>).reason === "string"
        ) {
          setFormError((payload as Record<string, unknown>).reason as string);
          return;
        }

        // Plan/media safety-net: map server-side media limits to field errors
        // so users see the exact field that needs adjustment.
        if (
          res.status === 422 &&
          payload &&
          typeof payload === "object" &&
          typeof (payload as Record<string, unknown>).error === "string"
        ) {
          const message = ((payload as Record<string, unknown>).error as string).trim();
          const lower = message.toLowerCase();
          if (lower.includes("photo")) {
            const errors = { images: message };
            setStep(2);
            setFieldErrors(errors);
            setFormError(`Please fix 1 field on Step 3 - ${STEPS[2].label}.`);
            focusFirstError(errors, 2);
            return;
          }
          if (lower.includes("video")) {
            const errors = { videos: message };
            setStep(2);
            setFieldErrors(errors);
            setFormError(`Please fix 1 field on Step 3 - ${STEPS[2].label}.`);
            focusFirstError(errors, 2);
            return;
          }
        }

        const normalized = normalizeCreatePostError(
          payload,
          "Failed to create tourism and events listing."
        );
        const targetStep = getStepForServerErrors(normalized.fieldErrors);
        const count = Object.keys(normalized.fieldErrors).length;
        if (count > 0) {
          setStep(targetStep);
        }
        setFieldErrors(normalized.fieldErrors);
        setFormError(
          count > 0
            ? `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${targetStep + 1} \u2014 ${STEPS[targetStep].label}.`
            : normalized.formError
        );
        if (count > 0) {
          focusFirstError(normalized.fieldErrors, targetStep);
        }
        return;
      }

      toast({ title: "Promotion submitted for review.", variant: "success" });
      setSubmitSucceeded(true);
      setUploadStatuses((c) => ({ ...c, saving: "done" }));
      discardDraft();
      router.push("/dashboard/listings?area=PROMOTIONS_EVENTS&created=promotion");
    } catch (error: unknown) {
      const uploadFailure = getPromotionMediaUploadErrorState(error);
      if (uploadFailure) {
        setStep(2);
        setFieldErrors((current) => ({ ...current, ...uploadFailure.fieldErrors }));
        setFormError(uploadFailure.formError);
        const fieldKey = Object.keys(uploadFailure.fieldErrors)[0];
        if (fieldKey) {
          const targetId = FIELD_IDS[fieldKey];
          const target = targetId ? document.getElementById(targetId) : null;
          if (target instanceof HTMLElement) {
            target.focus();
          }
        }
        return;
      }

      setFormError(normalizeCreatePostRuntimeError(error, "Something went wrong."));
    } finally {
      setIsSubmitting(false);
      setSubmitProgress(null);
      setUploadStatuses({ photos: "idle", videos: "idle", saving: "idle" });
    }
  }

  function handleDiscardDraft() {
    discardDraft();
    setStep(0);
    setPromotionType("event");
    setTitle("");
    setDescription("");
    setCategory("");
    setCategoryKey("");
    setPriceZar("");
    setNegotiable(false);
    setProvince(profile?.location_province ?? "");
    setCity(profile?.location_city ?? "");
    setLocationTown("");
    setLocationAddress("");
    setContactMethods(["call"]);
    setStartDate("");
    setEndDate("");
    setBusinessId(searchParams.get("business_id") || "");
    setPhotoFiles([]);
    setVideoFiles([]);
    setVideoThumbnailFile([]);
    setFocalPoint({ x: 0.5, y: 0.5 });
    setFieldErrors({});
    setFormError(null);
    setLastSavedAt(null);
    toast({
      title: "Draft discarded",
      description: "You can start a fresh promotion now.",
      variant: "success",
    });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <main className="flex-1">
        <div className="container-page py-6">
          <PlanGate area="PROMOTIONS_EVENTS">
            <form noValidate onSubmit={handleSubmit}>
              <PostFormScaffold
                title="Create an Event"
                description="Add the event details, tell people where it happens, and submit it for review."
                breadcrumbs={[
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "Create Post", href: "/post/create" },
                  { label: "Tourism & Events" },
                ]}
                badgeLabel="Tourism & Events"
                badgeClassName="bg-teal-600 text-white"
                guideDescription="Add the event details, tell people where it happens, and submit it for review."
                steps={STEPS}
                currentStep={step}
                error={formError}
                fieldErrors={fieldErrors}
                fieldLabels={PROMOTION_FIELD_LABELS}
                errorStepLabel={
                  formError ? `Step ${step + 1} \u2014 ${STEPS[step].label}` : undefined
                }
                stepHasErrors={STEPS.map((_, i) => Object.keys(validateStep(i)).length > 0)}
                onRetry={
                  formError && !isSubmitting
                    ? () => handleSubmit(new Event("submit") as unknown as React.FormEvent)
                    : undefined
                }
                footer={
                  <>
                    {user?.id && !isSubmitting && (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                        <p>
                          {lastSavedAt
                            ? `Draft saved locally at ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                            : "Changes are saved locally while you fill this form."}
                        </p>
                        <button
                          type="button"
                          onClick={handleDiscardDraft}
                          className="font-medium text-amber-700 hover:underline"
                        >
                          Discard draft
                        </button>
                      </div>
                    )}

                    <UploadProgressPanel
                      visible={isSubmitting}
                      slots={[
                        {
                          key: "photos",
                          label: "Uploading photos...",
                          doneLabel: "Photos uploaded",
                          status: photoFiles.length > 0 ? uploadStatuses.photos : "skipped",
                        },
                        {
                          key: "videos",
                          label: "Uploading video...",
                          doneLabel: "Video uploaded",
                          status: videoFiles.length > 0 ? uploadStatuses.videos : "skipped",
                        },
                        {
                          key: "saving",
                          label: "Saving promotion...",
                          doneLabel: "Promotion saved",
                          status: uploadStatuses.saving,
                        },
                      ]}
                    />

                    <PostFormFooter
                      currentStep={step}
                      totalSteps={STEPS.length}
                      onBack={() => {
                        clearErrors();
                        const prev = Math.max(step - 1, 0);
                        setStep(prev);
                        const firstFieldByStep = ["promotion_type", "price", "promotion-images"];
                        requestAnimationFrame(() => {
                          document
                            .getElementById("post-form-top")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                          const el = document.getElementById(firstFieldByStep[prev]);
                          el?.focus({ preventScroll: true });
                        });
                      }}
                      onNext={() => {
                        // Validate all steps up to and including the current step
                        for (let i = 0; i <= step; i++) {
                          const errors = validateStep(i);
                          if (Object.keys(errors).length > 0) {
                            if (i !== step) setStep(i);
                            setFieldErrors((current) => ({ ...current, ...errors }));
                            const count = Object.keys(errors).length;
                            setFormError(
                              `Please fix ${count} field${count > 1 ? "s" : ""} on Step ${i + 1} \u2014 ${STEPS[i].label}.`
                            );
                            focusFirstError(errors, i);
                            return;
                          }
                        }
                        clearErrors();
                        const next = Math.min(step + 1, STEPS.length - 1);
                        setStep(next);
                        const firstFieldByStep = ["promotion_type", "price", "promotion-images"];
                        requestAnimationFrame(() => {
                          document
                            .getElementById("post-form-top")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                          const el = document.getElementById(firstFieldByStep[next]);
                          el?.focus({ preventScroll: true });
                        });
                      }}
                      submitDisabled={isSubmitting}
                      isSubmitting={isSubmitting}
                      submittingLabel={submitProgress || "Submitting..."}
                    />
                  </>
                }
              >
                {step === 0 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    <p className="text-xs text-muted-foreground">Fields marked * are required.</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="title">Event Title *</Label>
                        <span className="text-xs text-muted-foreground">{title.length}/120</span>
                      </div>
                      <Input
                        id="title"
                        value={title}
                        onChange={(event) => {
                          setTitle(event.target.value);
                          clearErrors("title");
                        }}
                        placeholder="e.g. Saturday Night Market in Soweto"
                        maxLength={120}
                        aria-required="true"
                        aria-invalid={!!fieldErrors.title}
                        aria-describedby={fieldErrors.title ? "promotion-title-error" : undefined}
                        className={cn(fieldErrors.title && "border-destructive")}
                      />
                      {fieldErrors.title && (
                        <p id="promotion-title-error" className="inline-form-error">
                          {fieldErrors.title}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="description">Event Details *</Label>
                        <span className="text-xs text-muted-foreground">
                          {description.length}/5000
                        </span>
                      </div>
                      <Textarea
                        id="description"
                        value={description}
                        onChange={(event) => {
                          setDescription(event.target.value);
                          clearErrors("description");
                        }}
                        rows={5}
                        maxLength={5000}
                        placeholder="Tell people what the event is, who it is for, and what they should expect."
                        aria-required="true"
                        aria-invalid={!!fieldErrors.description}
                        aria-describedby={
                          fieldErrors.description ? "promotion-description-error" : undefined
                        }
                        className={cn(fieldErrors.description && "border-destructive")}
                      />
                      {fieldErrors.description && (
                        <p id="promotion-description-error" className="inline-form-error">
                          {fieldErrors.description}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category_key">Category</Label>
                      <select
                        id="category_key"
                        aria-label="Canonical category"
                        className={SELECT_CLASS}
                        value={categoryKey}
                        onChange={(event) =>
                          setCategoryKey(event.target.value as BusinessCategory | "")
                        }
                      >
                        <option value="">General & Other</option>
                        {BUSINESS_CATEGORIES.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">Category (optional)</Label>
                      <Input
                        id="category"
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                        placeholder={"e.g. Live Music, Community Event"}
                        maxLength={100}
                      />
                    </div>

                    {myBusinesses.length > 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="business_id" className="flex items-center gap-1.5">
                          <Building2 className="h-4 w-4 text-brand-blue" />
                          Link to Business (optional)
                        </Label>
                        <select
                          id="business_id"
                          aria-label="Link to Business"
                          className={SELECT_CLASS}
                          value={businessId}
                          onChange={(event) => setBusinessId(event.target.value)}
                        >
                          <option value="">No linked business</option>
                          {myBusinesses.map((business) => (
                            <option key={business.id} value={business.id}>
                              {business.business_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    <p className="text-xs text-muted-foreground">Fields marked * are required.</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="price">Ticket / Entry Price (optional)</Label>
                        <Input
                          id="price"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={priceZar}
                          onChange={(event) => {
                            setPriceZar(event.target.value);
                            clearErrors("price_zar");
                          }}
                          placeholder="0.00"
                          className={cn(fieldErrors.price_zar && "border-destructive")}
                        />
                        {fieldErrors.price_zar && (
                          <p className="inline-form-error">{fieldErrors.price_zar}</p>
                        )}
                      </div>
                      <div className="flex items-end pb-2">
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={negotiable}
                            onChange={(event) => setNegotiable(event.target.checked)}
                            className="rounded"
                          />
                          Entry price is negotiable
                        </label>
                      </div>
                    </div>

                    <LocationSelector
                      value={locationValue}
                      onChange={(v) => {
                        setProvince(v.province);
                        setCity(v.city);
                        setLocationTown(v.town ?? "");
                        setLocationAddress(v.address ?? "");
                        clearErrors("province", "city", "location_town", "location_address");
                      }}
                      showTown
                      showAddress
                      errors={fieldErrors}
                    />

                    <div
                      id="promotion-contact-methods"
                      tabIndex={-1}
                      className="space-y-3 rounded-lg"
                    >
                      <Label htmlFor="promotion-contact-methods">Contact Methods *</Label>
                      <div className="flex flex-wrap gap-3">
                        {(["call", "whatsapp", "form"] as const).map((method) => (
                          <label
                            key={method}
                            className="flex cursor-pointer items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={contactMethods.includes(method)}
                              onChange={() => toggleContact(method)}
                              className="rounded"
                            />
                            {method === "call"
                              ? "Phone Call"
                              : method === "whatsapp"
                                ? "WhatsApp"
                                : "Contact Form"}
                          </label>
                        ))}
                      </div>
                      {fieldErrors.contact_methods && (
                        <p className="inline-form-error">{fieldErrors.contact_methods}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="start_date">Start Date</Label>
                        <Input
                          id="start_date"
                          type="date"
                          value={startDate}
                          onChange={(event) => {
                            setStartDate(event.target.value);
                            clearErrors("start_date", "end_date");
                          }}
                          className={cn(fieldErrors.start_date && "border-destructive")}
                        />
                        {fieldErrors.start_date && (
                          <p className="inline-form-error">{fieldErrors.start_date}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="end_date">End Date</Label>
                        <Input
                          id="end_date"
                          type="date"
                          value={endDate}
                          onChange={(event) => {
                            setEndDate(event.target.value);
                            clearErrors("end_date");
                          }}
                          className={cn(fieldErrors.end_date && "border-destructive")}
                        />
                        {fieldErrors.end_date && (
                          <p className="inline-form-error">{fieldErrors.end_date}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5 animate-in fade-in-0 duration-300">
                    <p className="text-xs text-muted-foreground">Fields marked * are required.</p>
                    <div id="promotion-images" tabIndex={-1} className="space-y-2 rounded-lg">
                      <MediaUpload
                        label={`Photos (max ${maxPhotos})`}
                        maxFiles={maxPhotos}
                        files={photoFiles}
                        onChange={(files) => {
                          setPhotoFiles(files);
                          clearErrors("images");
                        }}
                        accept="image/*"
                      />
                      <p className="text-xs text-muted-foreground">
                        Your first photo becomes the promotion&apos;s cover image in cards and
                        feeds.
                      </p>
                      {fieldErrors.images && (
                        <p className="inline-form-error">{fieldErrors.images}</p>
                      )}
                    </div>

                    <div id="promotion-videos" tabIndex={-1} className="space-y-2 rounded-lg">
                      <MediaUpload
                        label={`Videos (max ${maxVideos}, optional)${!videoAllowed ? " — Upgrade to unlock" : ""}`}
                        maxFiles={Math.max(maxVideos, 1)}
                        files={videoFiles}
                        onChange={(files) => {
                          setVideoFiles(files);
                          prewarmVideosForFastUpload(files);
                          if (files.length === 0) setVideoThumbnailFile([]);
                          clearErrors("videos");
                        }}
                        accept="video/*"
                        disabled={!videoAllowed}
                      />
                      {fieldErrors.videos && (
                        <p className="inline-form-error">{fieldErrors.videos}</p>
                      )}
                    </div>

                    {videoFiles.length > 0 && (
                      <div
                        id="promotion-video-thumbnail"
                        tabIndex={-1}
                        className="space-y-2 rounded-lg"
                      >
                        <MediaUpload
                          label="Video thumbnail (optional)"
                          maxFiles={1}
                          files={videoThumbnailFile}
                          onChange={(files) => {
                            setVideoThumbnailFile(files);
                            clearErrors("video_thumbnail");
                          }}
                          accept="image/*"
                        />
                        {fieldErrors.video_thumbnail && (
                          <p className="inline-form-error">{fieldErrors.video_thumbnail}</p>
                        )}
                      </div>
                    )}

                    <div className="rounded-xl border border-dashed border-brand-green/30 bg-brand-green/5 p-4 text-sm">
                      <div className="mb-3 flex items-center gap-2 font-medium text-muted-foreground">
                        <TreePalm className="h-4 w-4" />
                        Preview
                      </div>

                      <PromotionDetailContent
                        promotion={{
                          id: "preview-promotion",
                          owner_id: "preview-seller",
                          business_id: businessId || null,
                          title: title || "Your promotion title",
                          description:
                            description || "Your promotion description will appear here.",
                          promotion_type: promotionType,
                          category: category || null,
                          category_key: categoryKey || null,
                          photos: photoPreviewUrls,
                          videos: previewVideoUrls,
                          video_thumbnail: videoThumbnailUrl,
                          price_cents: priceZar
                            ? Math.round(parseFloat(priceZar || "0") * 100)
                            : null,
                          price_negotiable: negotiable,
                          location_province: province,
                          location_city: city,
                          location_town: locationTown || null,
                          location_address: locationAddress || null,
                          contact_methods: contactMethods,
                          start_date: startDate || null,
                          end_date: endDate || null,
                          boost_until: null,
                          featured_until: null,
                          view_count: null,
                          created_at: new Date().toISOString(),
                        }}
                        advertiserProfile={{
                          display_name: "You",
                          account_verification_status: null,
                          phone: null,
                          masked_phone_public: null,
                        }}
                        linkedBusiness={
                          businessId
                            ? (() => {
                                const linkedBusiness = myBusinesses.find(
                                  (item) => item.id === businessId
                                );
                                return linkedBusiness
                                  ? {
                                      id: linkedBusiness.id,
                                      business_name: linkedBusiness.business_name,
                                      logo_url: null,
                                    }
                                  : null;
                              })()
                            : null
                        }
                        showContactActions={false}
                        showContactSummary
                        trackView={false}
                        layoutMode="review"
                      />
                    </div>
                  </div>
                )}
              </PostFormScaffold>
            </form>
          </PlanGate>
        </div>
      </main>

      <Footer />
    </div>
  );
}
